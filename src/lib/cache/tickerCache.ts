import { promises as fs } from "node:fs";
import path from "node:path";

/** 單一股票的參考資料（名稱／市值／產業別等變動緩慢的欄位）。 */
export interface TickerMeta {
  ticker: string;
  name: string;
  /** "CS"（普通股）、"ETF" 等 */
  type: string;
  /** 市值；ETF 等無市值者為 null */
  marketCap: number | null;
  sharesOutstanding: number | null;
  /** 產業別（Polygon 的 sic_description）；無者為 null */
  sector: string | null;
  /** 取得時間 (epoch ms)，用於 TTL 判斷 */
  fetchedAt: number;
}

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "polygon-tickers.json");

/** 參考資料 7 天過期重抓（市值/產業變動很慢）。 */
export const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let memory: Map<string, TickerMeta> | null = null;
let loadPromise: Promise<Map<string, TickerMeta>> | null = null;
let dirty = false;

async function loadFromDisk(): Promise<Map<string, TickerMeta>> {
  const map = new Map<string, TickerMeta>();
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const obj = JSON.parse(raw) as Record<string, TickerMeta>;
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
  } catch {
    // 檔案不存在或損壞 → 從空白開始。
  }
  return map;
}

async function ensureLoaded(): Promise<Map<string, TickerMeta>> {
  if (memory) return memory;
  if (!loadPromise) {
    loadPromise = loadFromDisk().then((m) => {
      memory = m;
      return m;
    });
  }
  return loadPromise;
}

/** 取得單一 ticker 的快取（未過期才回傳）。 */
export async function getMeta(ticker: string): Promise<TickerMeta | undefined> {
  const map = await ensureLoaded();
  const m = map.get(ticker);
  if (!m) return undefined;
  if (Date.now() - m.fetchedAt > META_TTL_MS) return undefined;
  return m;
}

/** 寫入單一 ticker 快取（記憶體即時生效，磁碟批次寫出）。 */
export async function setMeta(meta: TickerMeta): Promise<void> {
  const map = await ensureLoaded();
  map.set(meta.ticker, meta);
  dirty = true;
}

/** 將記憶體中的快取寫回磁碟（若有變動）。 */
export async function flush(): Promise<void> {
  if (!dirty || !memory) return;
  const obj: Record<string, TickerMeta> = {};
  for (const [k, v] of memory) obj[k] = v;
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(obj), "utf8");
  dirty = false;
}
