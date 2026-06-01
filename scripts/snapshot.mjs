// 產生靜態網站的資料快照：抓取最新交易日全美股成交值前 50 名（含名稱/市值/產業別），
// 寫入 public/rankings.json。供 GitHub Action 每日收盤後執行，或本機手動執行。
//
// 用法： node scripts/snapshot.mjs
// 需在 .env.local（本機）或環境變數 POLYGON_API_KEY（CI）設定金鑰。

import { promises as fs } from "node:fs";
import path from "node:path";

const TOP_N = 50;
const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "polygon-tickers.json");
const OUT_FILE = path.join(ROOT, "public", "rankings.json");
const META_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 名稱/市值/產業 7 天重抓

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

async function readEnvKey() {
  if (process.env.POLYGON_API_KEY) return process.env.POLYGON_API_KEY.trim();
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const m = raw.match(/^POLYGON_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  } catch {}
  return null;
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

async function main() {
  const key = await readEnvKey();
  if (!key) {
    console.error("未找到 POLYGON_API_KEY（本機請設於 .env.local；CI 請設為 Secret）");
    process.exit(1);
  }

  console.log("尋找最近交易日並抓取 grouped 資料…");
  const days = await findTradingDays(key);
  if (days.length === 0) throw new Error("找不到近期可用的交易日資料");
  const latest = days[0];
  const prevMap = new Map();
  if (days[1]) for (const b of days[1].results) prevMap.set(b.T, b);
  console.log(`最新交易日：${latest.date}（${latest.results.length} 檔）`);

  const ranked = latest.results
    .map((b) => ({ b, dv: (b.vw && b.vw > 0 ? b.vw : b.c) * b.v }))
    .filter((r) => r.b.c > 0 && r.b.v > 0 && r.dv > 0)
    .sort((a, b) => b.dv - a.dv)
    .slice(0, TOP_N);

  // 載入既有明細快取（重複執行可省去 API 呼叫）。
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {}
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const rows = [];
  for (const { b, dv } of ranked) {
    const t = b.T;
    let meta = cache[t];
    if (!meta || Date.now() - meta.fetchedAt > META_TTL_MS) {
      try {
        const data = await getJson(details(key, t));
        const r = data.results ?? {};
        meta = {
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
        console.log(`  補抓 ${t} → ${meta.name}`);
      } catch (e) {
        meta = cache[t] ?? { name: t, marketCap: null, sharesOutstanding: null, sector: null };
        console.warn(`  ${t} 明細補抓失敗：${e.message}`);
      }
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
    rows.push({
      symbol: t,
      name: meta.name ?? t,
      price: b.c,
      changePercent,
      dollarVolume: dv,
      marketCap,
      sector: meta.sector ?? "—",
    });
  }

  const out = {
    rows,
    asOf: new Date(`${latest.date}T20:00:00Z`).toISOString(),
    source: "polygon",
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`完成：寫出 ${rows.length} 列 → public/rankings.json（交易日 ${latest.date}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
