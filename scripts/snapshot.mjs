// 產生靜態網站的資料快照：抓取最新交易日全美股成交值前 50 名「個股」（排除 ETF），
// 補上名稱/市值/SIC，並用 Gemini 分析題材/族群；標示新進榜與排名躍升。
// 寫入 public/rankings.json。供 GitHub Action 每日收盤後執行，或本機手動執行。
//
// 用法： node scripts/snapshot.mjs
// 環境變數 / .env.local：POLYGON_API_KEY（必要）、GEMINI_API_KEY（選用，缺少則題材退回 SIC）

import { promises as fs } from "node:fs";
import path from "node:path";

const TOP_N = 50; // 最終輸出的個股數
const OVER_RANK = 90; // 過量排名上限（濾掉 ETF 後仍要湊滿 50）
const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "polygon-tickers.json");
const OUT_FILE = path.join(ROOT, "public", "rankings.json");
const META_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 名稱/市值/SIC 7 天重抓
const THEME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 題材標籤 30 天重抓
const RANK_JUMP_THRESHOLD = 10; // 排名躍升標示門檻

// Polygon ticker type 中屬於「基金/ETF」者一律排除（只保留個股與 ADR/普通股）。
const FUND_TYPES = new Set(["ETF", "ETN", "ETV", "ETS", "FUND", "SP"]);

// 前一份快照（線上）來源，用於計算 isNew / rankChange；可用 env 覆寫。
const PREV_RANKINGS_URL =
  process.env.PREV_RANKINGS_URL ||
  "https://tomchang811.github.io/us-stock-rankings/rankings.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (d) => d.toISOString().slice(0, 10);

// 滑動視窗速率限制：每 60 秒最多 5 次（Polygon 免費方案）。
const callTimes = [];
async function rateSlot() {
  const now = Date.now();
  while (callTimes.length && now - callTimes[0] > 60_000) callTimes.shift();
  if (callTimes.length >= 5) await sleep(60_000 - (now - callTimes[0]) + 200);
  callTimes.push(Date.now());
}

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    await rateSlot();
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 403) return { resultsCount: 0, results: [] }; // 當日資料未開放
    if ((res.status === 401 || res.status === 429) && attempt < 3) {
      await sleep(15_000);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url.replace(/apiKey=[^&]+/, "apiKey=***")}`);
  }
}

/** 從環境變數或 .env.local 讀取指定金鑰。 */
async function readKey(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const m = raw.match(new RegExp(`^${name}\\s*=\\s*(.+)\\s*$`, "m"));
    if (m) return m[1].trim();
  } catch {}
  return null;
}

/** 將全大寫的 SIC 字串轉為較易讀的標題大小寫（與 src/lib/format.ts formatSector 等價）。 */
function formatSector(sector) {
  if (!sector || sector === "—") return "—";
  if (sector !== sector.toUpperCase()) return sector;
  return sector
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, "&");
}

const grouped = (key, ds) =>
  `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${ds}?adjusted=true&apiKey=${key}`;
const details = (key, t) =>
  `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(t)}?apiKey=${key}`;

/** 從昨天往回找最近兩個有資料的交易日（最新用於排行，前一日用於漲跌幅）。 */
async function findTradingDays(key) {
  const days = [];
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < 14 && days.length < 2; i++) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const ds = fmtDate(cursor);
      const data = await getJson(grouped(key, ds));
      if ((data.resultsCount ?? 0) > 0) days.push({ date: ds, results: data.results });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days;
}

/** 取得線上前一份快照：symbol→名次(1-based)、symbol→該列資料、資料交易日。 */
async function fetchPrev() {
  try {
    const res = await fetch(PREV_RANKINGS_URL);
    if (!res.ok) return null;
    const data = await res.json();
    const ranks = new Map();
    const rows = new Map();
    (data.rows ?? []).forEach((r, i) => {
      ranks.set(r.symbol, i + 1);
      rows.set(r.symbol, r);
    });
    const date = typeof data.asOf === "string" ? data.asOf.slice(0, 10) : null;
    return { ranks, rows, date };
  } catch {
    return null;
  }
}

const GEMINI_MODEL = "gemini-2.5-flash";

/** 呼叫 Gemini generateContent，對 429/500/503 退避重試，回傳解析後的回應物件。 */
async function callGemini(apiKey, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if ([429, 500, 503].includes(res.status) && attempt < 4) {
      const wait = 5_000 * (attempt + 1);
      console.warn(`  Gemini HTTP ${res.status}，${wait / 1000}s 後重試（第 ${attempt + 1} 次）…`);
      await sleep(wait);
      continue;
    }
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** 串接候選回應的所有 text part。 */
function candidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text || "").join("").trim();
}

/** 用 Gemini 分析每檔題材標籤 + 當日發動題材摘要。回傳 null 表示未啟用/失敗。 */
async function enrichWithGemini(stocks, apiKey) {
  const lines = stocks
    .map((s) => `${s.symbol} | ${s.name} | ${s.sector} | ${s.changePercent.toFixed(2)}%`)
    .join("\n");

  const prompt = `你是美股題材分析師。以下是某交易日「成交值前 50 名個股」（格式：代碼 | 名稱 | SIC產業 | 當日漲跌幅）：
${lines}

請完成兩件事，全部用繁體中文：
1. tickers：為每一檔指定「一個」精簡且具體的題材/族群標籤（例如：AI 晶片、記憶體、HBM、核電/SMR、量子運算、減肥藥 GLP-1、雲端軟體 SaaS、資安、比特幣/加密、太空、國防、電力基礎建設、電動車、生技製藥…）。同一族群的股票請用「完全一致」的標籤字串。避免過於籠統（不要只寫「科技」「半導體」）。
2. summary：找出當日「發動」的題材族群——以「上漲（漲跌幅為正）」的股票為主，依族群的強度（成員數與漲幅）由強到弱排序，最多 6 組。每組給 theme（題材名，需與 tickers 用詞一致）、reason（一句話說明該題材近期為何受資金關注，用你既有的知識）、symbols（屬於該族群且當日上漲的代碼陣列）。

只輸出 JSON。`;

  const schema = {
    type: "object",
    properties: {
      tickers: {
        type: "array",
        items: {
          type: "object",
          properties: { symbol: { type: "string" }, theme: { type: "string" } },
          required: ["symbol", "theme"],
        },
      },
      summary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            theme: { type: "string" },
            reason: { type: "string" },
            symbols: { type: "array", items: { type: "string" } },
          },
          required: ["theme", "reason", "symbols"],
        },
      },
    },
    required: ["tickers", "summary"],
  };

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.3 },
  };
  const data = await callGemini(apiKey, body);
  const text = candidateText(data);
  if (!text) throw new Error("Gemini 回應為空");
  const parsed = JSON.parse(text);

  const themesByTicker = new Map();
  for (const it of parsed.tickers ?? []) {
    if (it.symbol && it.theme) themesByTicker.set(it.symbol, it.theme);
  }
  return { themesByTicker, summary: parsed.summary ?? [] };
}

/**
 * 用 Gemini + Google 搜尋，為「新進榜」個股說明近期催化劑（發生了什麼）。
 * 回傳 Map<symbol, reason>。grounding 與結構化輸出不相容，故用容錯 JSON 解析。
 */
async function explainNewEntrants(newStocks, apiKey) {
  const lines = newStocks
    .map((s) => `${s.symbol} | ${s.name} | ${s.theme} | ${s.changePercent.toFixed(2)}%`)
    .join("\n");
  const prompt = `以下是今天「首次進入美股成交值前 50」的個股（代碼 | 名稱 | 題材 | 當日漲跌幅）：
${lines}

請用 Google 搜尋它們「最近幾天」的相關新聞，逐檔說明：這檔股票為何會突然放量、衝進成交值前 50？請指出「具體催化劑」（例如財報/財測、新產品或大訂單、分析師調升、併購、法說會、題材輪動、突發事件等）。每檔一句話、繁體中文、務實具體；若查無明確消息，請說「近期無明確個股消息，可能受族群輪動帶動」。
只輸出 JSON 陣列，格式：[{"symbol":"代碼","reason":"一句話原因"}]，不要任何其他文字或 markdown。`;

  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  const data = await callGemini(apiKey, body);
  const text = candidateText(data);
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s < 0 || e <= s) throw new Error("新進榜回應無 JSON 陣列");
  const arr = JSON.parse(text.slice(s, e + 1));
  const map = new Map();
  for (const it of arr) if (it.symbol && it.reason) map.set(it.symbol, it.reason);
  return map;
}

async function main() {
  const polygonKey = await readKey("POLYGON_API_KEY");
  if (!polygonKey) {
    console.error("未找到 POLYGON_API_KEY（本機請設於 .env.local；CI 請設為 Secret）");
    process.exit(1);
  }
  const geminiKey = await readKey("GEMINI_API_KEY");

  console.log("尋找最近交易日並抓取 grouped 資料…");
  const days = await findTradingDays(polygonKey);
  if (days.length === 0) throw new Error("找不到近期可用的交易日資料");
  const latest = days[0];
  const prevMap = new Map();
  if (days[1]) for (const b of days[1].results) prevMap.set(b.T, b);
  console.log(`最新交易日：${latest.date}（${latest.results.length} 檔）`);

  const ranked = latest.results
    .map((b) => ({ b, dv: (b.vw && b.vw > 0 ? b.vw : b.c) * b.v }))
    .filter((r) => r.b.c > 0 && r.b.v > 0 && r.dv > 0)
    .sort((a, b) => b.dv - a.dv)
    .slice(0, OVER_RANK);

  // 載入既有明細快取（重複執行可省去 API 呼叫）。
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {}
  await fs.mkdir(CACHE_DIR, { recursive: true });

  // 逐檔補明細，濾掉 ETF/基金，湊滿 TOP_N 檔個股後停止。
  const picked = [];
  for (const { b, dv } of ranked) {
    if (picked.length >= TOP_N) break;
    const t = b.T;
    let meta = cache[t];
    if (!meta || Date.now() - meta.fetchedAt > META_TTL_MS) {
      try {
        const data = await getJson(details(polygonKey, t));
        const r = data.results ?? {};
        meta = {
          ...(cache[t] ?? {}),
          ticker: t,
          name: r.name ?? t,
          type: r.type ?? "",
          marketCap: r.market_cap ?? null,
          sharesOutstanding:
            r.share_class_shares_outstanding ?? r.weighted_shares_outstanding ?? null,
          sector: r.sic_description ?? null,
          fetchedAt: Date.now(),
        };
        cache[t] = meta;
        await fs.writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
        console.log(`  補抓 ${t} → ${meta.name} (${meta.type})`);
      } catch (e) {
        meta = cache[t] ?? { ticker: t, name: t, type: "", marketCap: null, sharesOutstanding: null, sector: null };
        console.warn(`  ${t} 明細補抓失敗：${e.message}`);
      }
    }
    if (FUND_TYPES.has((meta.type ?? "").toUpperCase())) {
      console.log(`  跳過 ETF/基金：${t} (${meta.type})`);
      continue;
    }
    const prevClose = prevMap.get(t)?.c;
    const changePercent =
      prevClose && prevClose > 0
        ? ((b.c - prevClose) / prevClose) * 100
        : ((b.c - b.o) / b.o) * 100;
    const marketCap =
      meta.sharesOutstanding && meta.sharesOutstanding > 0
        ? meta.sharesOutstanding * b.c
        : meta.marketCap ?? 0;
    picked.push({ b, dv, meta, changePercent, marketCap });
  }

  // 取得前一份快照 → 計算 isNew / rankChange / streak（連續在榜天數）。
  const prev = await fetchPrev();
  // 同一交易日的重跑（例如改程式碼觸發部署）不重複累加 streak。
  const sameDay = prev?.date != null && prev.date === latest.date;
  console.log(
    prev
      ? `已取得前一份快照（${prev.ranks.size} 檔，交易日 ${prev.date}${sameDay ? "，同日重跑" : ""}）作對比`
      : "無前一份快照，新進榜/躍升/在榜天數本次以 1 起算",
  );

  // AI 題材分析（一次呼叫；缺金鑰或失敗則後備）。
  let aiSource = "none";
  let themesByTicker = new Map();
  let summaryRaw = [];
  if (geminiKey) {
    try {
      const aiInput = picked.map((p) => ({
        symbol: p.b.T,
        name: p.meta.name ?? p.b.T,
        sector: formatSector(p.meta.sector ?? "—"),
        changePercent: p.changePercent,
      }));
      const r = await enrichWithGemini(aiInput, geminiKey);
      themesByTicker = r.themesByTicker;
      summaryRaw = r.summary;
      aiSource = "gemini";
      // 將題材標籤寫入快取（後備用）。
      for (const p of picked) {
        const th = themesByTicker.get(p.b.T);
        if (th) {
          cache[p.b.T] = { ...cache[p.b.T], theme: th, themeFetchedAt: Date.now() };
        }
      }
      await fs.writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
      console.log(`Gemini 題材分析完成（${themesByTicker.size} 檔、${summaryRaw.length} 組題材）`);
    } catch (e) {
      console.warn(`Gemini 失敗，改用後備題材：${e.message}`);
    }
  } else {
    console.log("未設定 GEMINI_API_KEY，題材使用 SIC 後備");
  }

  const rows = picked.map((p, i) => {
    const t = p.b.T;
    const currentRank = i + 1;
    const prevRank = prev?.ranks.get(t);
    const inPrev = prev?.ranks.has(t) ?? false;
    // 題材：Gemini → 快取題材（未過期）→ SIC 格式化
    const cached = cache[t];
    const cachedTheme =
      cached?.theme && cached.themeFetchedAt && Date.now() - cached.themeFetchedAt < THEME_TTL_MS
        ? cached.theme
        : null;
    const theme = themesByTicker.get(t) || cachedTheme || formatSector(p.meta.sector ?? "—");

    // 連續在榜天數：在榜→前次 streak（+1，同日重跑不加）；不在榜或無前資料→1。
    let streak;
    if (!prev || !inPrev) {
      streak = 1;
    } else {
      const prevStreak = prev.rows.get(t)?.streak ?? 1;
      streak = sameDay ? prevStreak : prevStreak + 1;
    }

    return {
      symbol: t,
      name: p.meta.name ?? t,
      price: p.b.c,
      changePercent: p.changePercent,
      dollarVolume: p.dv,
      marketCap: p.marketCap,
      sector: p.meta.sector ?? "—",
      theme,
      isNew: prev ? !inPrev : false,
      rankChange: prevRank ? prevRank - currentRank : null,
      streak,
    };
  });

  // 摘要：以我方資料計算 count / avgChange（不信任模型算數），只保留有對應到的成員。
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const themeSummary = summaryRaw
    .map((s) => {
      const symbols = (s.symbols ?? []).filter((sym) => bySymbol.has(sym));
      const changes = symbols.map((sym) => bySymbol.get(sym).changePercent);
      const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
      return { theme: s.theme, reason: s.reason, symbols, count: symbols.length, avgChange };
    })
    .filter((s) => s.count > 0);

  // 新進榜雷達：對 isNew 的個股用 Gemini + Google 搜尋查近期催化劑。
  let newEntrants = rows
    .filter((r) => r.isNew)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      theme: r.theme,
      changePercent: r.changePercent,
      reason: "",
    }));
  if (geminiKey && newEntrants.length > 0) {
    try {
      const reasons = await explainNewEntrants(newEntrants, geminiKey);
      newEntrants = newEntrants.map((n) => ({ ...n, reason: reasons.get(n.symbol) ?? "" }));
      console.log(`新進榜 AI 說明完成（${reasons.size}/${newEntrants.length} 檔，含 Google 搜尋）`);
    } catch (e) {
      console.warn(`新進榜 AI 說明失敗：${e.message}`);
    }
  }

  const out = {
    rows,
    asOf: new Date(`${latest.date}T20:00:00Z`).toISOString(),
    source: "polygon",
    aiSource,
    themeSummary,
    newEntrants,
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  const newCount = rows.filter((r) => r.isNew).length;
  console.log(
    `完成：寫出 ${rows.length} 檔個股 → public/rankings.json（交易日 ${latest.date}，AI=${aiSource}，新進榜 ${newCount} 檔）`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
