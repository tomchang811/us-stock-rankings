// 預熱 Polygon 明細快取：抓取最新交易日成交值前 N 名的「名稱/市值/產業」，
// 寫入 .cache/polygon-tickers.json，讓 App 首次開啟即顯示完整資料。
//
// 用法： node scripts/prewarm.mjs [N]   （N 預設 60）
// 需在 .env.local 設定 POLYGON_API_KEY。

import { promises as fs } from "node:fs";
import path from "node:path";

const N = Number(process.argv[2] ?? 60);
const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "polygon-tickers.json");
const CALL_SPACING_MS = 12_500; // ≈ 4.8 次/分鐘，安全低於 5/min

async function readEnvKey() {
  if (process.env.POLYGON_API_KEY) return process.env.POLYGON_API_KEY.trim();
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const m = raw.match(/^POLYGON_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (d) => d.toISOString().slice(0, 10);

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    // 當日資料未開放會回 403：視為無資料。
    if (res.status === 403) return { resultsCount: 0, results: [] };
    if ((res.status === 401 || res.status === 429) && attempt < 3) {
      await sleep(15_000);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url.replace(/apiKey=[^&]+/, "apiKey=***")}`);
  }
}

async function latestTradingDay(key) {
  // 從「昨天」開始（免費方案收盤前不提供當日資料）。
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < 12; i++) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      const ds = fmtDate(cursor);
      const data = await getJson(
        `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${ds}?adjusted=true&apiKey=${key}`,
      );
      if ((data.resultsCount ?? 0) > 0) return { date: ds, results: data.results };
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  throw new Error("找不到近期交易日資料");
}

async function main() {
  const key = await readEnvKey();
  if (!key) {
    console.error("未找到 POLYGON_API_KEY（請設定於 .env.local）");
    process.exit(1);
  }

  console.log("取得最新交易日 grouped 資料…");
  const { date, results } = await latestTradingDay(key);
  console.log(`最新交易日：${date}，共 ${results.length} 檔`);

  const top = results
    .map((b) => ({ t: b.T, dv: (b.vw && b.vw > 0 ? b.vw : b.c) * b.v }))
    .filter((r) => r.dv > 0)
    .sort((a, b) => b.dv - a.dv)
    .slice(0, N)
    .map((r) => r.t);

  // 讀取既有快取
  let cache = {};
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {}

  await fs.mkdir(CACHE_DIR, { recursive: true });

  let fetched = 0;
  for (let i = 0; i < top.length; i++) {
    const ticker = top[i];
    if (cache[ticker]) continue; // 已有快取則略過
    try {
      const data = await getJson(
        `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${key}`,
      );
      const r = data.results ?? {};
      cache[ticker] = {
        ticker,
        name: r.name ?? ticker,
        type: r.type ?? "",
        marketCap: r.market_cap ?? null,
        sharesOutstanding:
          r.share_class_shares_outstanding ?? r.weighted_shares_outstanding ?? null,
        sector: r.sic_description ?? null,
        fetchedAt: Date.now(),
      };
      fetched++;
      await fs.writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
      console.log(`[${i + 1}/${top.length}] ${ticker} → ${cache[ticker].name}`);
    } catch (e) {
      console.warn(`[${i + 1}/${top.length}] ${ticker} 失敗：${e.message}`);
    }
    if (i < top.length - 1) await sleep(CALL_SPACING_MS);
  }

  console.log(`完成。新抓取 ${fetched} 檔，快取總數 ${Object.keys(cache).length}。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
