import type { DataProvider, RankingResult, StockRow } from "./types";
import { flush, getMeta, setMeta, type TickerMeta } from "../cache/tickerCache";

const BASE = "https://api.polygon.io";

/** 每次排行請求最多補抓的「未快取」明細數，避免觸發 5次/分鐘 限制。 */
const MAX_DETAIL_FETCHES_PER_CALL = 6;

interface GroupedBar {
  T: string; // ticker
  v: number; // volume
  vw?: number; // volume weighted avg price
  o: number; // open
  c: number; // close
  h: number;
  l: number;
}

interface GroupedResponse {
  status?: string;
  resultsCount?: number;
  results?: GroupedBar[];
}

interface TickerDetailsResponse {
  results?: {
    name?: string;
    type?: string;
    market_cap?: number;
    sic_description?: string;
    share_class_shares_outstanding?: number;
    weighted_shares_outstanding?: number;
  };
}

// ---- 滑動視窗速率限制：嚴格遵守每 60 秒最多 5 次請求 ----
const RATE_LIMIT = 5;
const WINDOW_MS = 60_000;
const callTimes: number[] = [];
let chain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 透過序列化佇列取得一個「可發送請求」的許可，遵守 5/min。 */
function acquireSlot(): Promise<void> {
  const run = async () => {
    const now = Date.now();
    while (callTimes.length && now - callTimes[0] > WINDOW_MS) callTimes.shift();
    if (callTimes.length >= RATE_LIMIT) {
      const waitMs = WINDOW_MS - (now - callTimes[0]) + 100;
      await sleep(waitMs);
    }
    callTimes.push(Date.now());
  };
  chain = chain.then(run, run);
  return chain;
}

async function polyFetch<T>(url: string): Promise<T> {
  let attempt = 0;
  // 速率限制（401/429）時退避重試。
  while (true) {
    await acquireSlot();
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status === 401) && attempt < 2) {
      attempt += 1;
      await sleep(15_000);
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`Polygon 請求失敗 (${res.status}): ${body.slice(0, 200)}`);
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class PolygonProvider implements DataProvider {
  // 以日期為 key 的 grouped 結果快取（已完成交易日的 EOD 資料不變）。
  private groupedCache = new Map<string, Map<string, GroupedBar>>();
  // 已解析的「最新／前一」交易日，30 分鐘重算一次。
  private resolvedDates: { latest: string; prev: string; ts: number } | null = null;

  constructor(private readonly apiKey: string) {}

  async getTopByDollarVolume(limit: number): Promise<RankingResult> {
    const { latest, prev } = await this.resolveTradingDates();
    const latestMap = await this.getGrouped(latest);
    const prevMap = prev ? await this.getGrouped(prev) : new Map<string, GroupedBar>();

    // 依成交金額（vw × volume）排序取前 N。
    const ranked = Array.from(latestMap.values())
      .map((bar) => {
        const avgPrice = bar.vw && bar.vw > 0 ? bar.vw : bar.c;
        return { bar, dollarVolume: avgPrice * bar.v };
      })
      .filter((r) => r.bar.c > 0 && r.bar.v > 0 && r.dollarVolume > 0)
      .sort((a, b) => b.dollarVolume - a.dollarVolume)
      .slice(0, limit);

    // 補抓未快取的明細（名稱/市值/產業），但限制數量以遵守速率限制。
    const metas = await this.enrichMetas(ranked.map((r) => r.bar.T));
    await flush();

    const rows: StockRow[] = ranked.map((r) => {
      const t = r.bar.T;
      const meta = metas.get(t);
      const prevClose = prevMap.get(t)?.c;
      const changePercent =
        prevClose && prevClose > 0
          ? ((r.bar.c - prevClose) / prevClose) * 100
          : ((r.bar.c - r.bar.o) / r.bar.o) * 100; // 無前一日資料時，退為當日 open→close。

      // 市值優先用「股數 × 最新收盤」（較即時），否則用 Polygon 提供的 market_cap。
      const marketCap =
        meta?.sharesOutstanding && meta.sharesOutstanding > 0
          ? meta.sharesOutstanding * r.bar.c
          : meta?.marketCap ?? 0;

      return {
        symbol: t,
        name: meta?.name ?? t,
        price: r.bar.c,
        changePercent,
        dollarVolume: r.dollarVolume,
        marketCap,
        sector: meta?.sector ?? "—",
      };
    });

    return { rows, asOf: new Date(`${latest}T20:00:00Z`).toISOString() };
  }

  /** 找出最新與前一個有資料的交易日（跳過週末，快取 30 分鐘）。 */
  private async resolveTradingDates(): Promise<{ latest: string; prev: string }> {
    if (this.resolvedDates && Date.now() - this.resolvedDates.ts < 30 * 60_000) {
      return this.resolvedDates;
    }
    const found: string[] = [];
    // 從「昨天」開始往回找：免費方案在收盤前不提供當日資料（會回 403）。
    const cursor = new Date();
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    for (let i = 0; i < 12 && found.length < 2; i++) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) {
        const ds = fmtDate(cursor);
        const map = await this.getGrouped(ds);
        if (map.size > 0) found.push(ds);
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    if (found.length === 0) {
      throw new Error("Polygon 找不到近期可用的交易日資料");
    }
    const resolved = { latest: found[0], prev: found[1] ?? "", ts: Date.now() };
    this.resolvedDates = resolved;
    return resolved;
  }

  /** 取得某交易日的 grouped 資料（以 ticker 為 key），含記憶體快取。 */
  private async getGrouped(date: string): Promise<Map<string, GroupedBar>> {
    const cached = this.groupedCache.get(date);
    if (cached) return cached;
    const url = `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${this.apiKey}`;
    const map = new Map<string, GroupedBar>();
    try {
      const data = await polyFetch<GroupedResponse>(url);
      for (const bar of data.results ?? []) map.set(bar.T, bar);
    } catch (err) {
      // 當日資料尚未開放（收盤前）會回 403；視為「無資料」讓呼叫端往前一天找。
      if (!(err instanceof Error && err.message.includes("(403)"))) throw err;
    }
    this.groupedCache.set(date, map);
    return map;
  }

  /** 從磁碟快取取明細，未命中者限量向 API 補抓。 */
  private async enrichMetas(tickers: string[]): Promise<Map<string, TickerMeta>> {
    const result = new Map<string, TickerMeta>();
    const misses: string[] = [];
    for (const t of tickers) {
      const m = await getMeta(t);
      if (m) result.set(t, m);
      else misses.push(t);
    }
    const toFetch = misses.slice(0, MAX_DETAIL_FETCHES_PER_CALL);
    for (const t of toFetch) {
      try {
        const meta = await this.fetchDetails(t);
        await setMeta(meta);
        result.set(t, meta);
      } catch {
        // 明細補抓失敗不影響排行主體；該列名稱/市值/產業暫時留白。
      }
    }
    return result;
  }

  private async fetchDetails(ticker: string): Promise<TickerMeta> {
    const url = `${BASE}/v3/reference/tickers/${encodeURIComponent(ticker)}?apiKey=${this.apiKey}`;
    const data = await polyFetch<TickerDetailsResponse>(url);
    const r = data.results ?? {};
    return {
      ticker,
      name: r.name ?? ticker,
      type: r.type ?? "",
      marketCap: r.market_cap ?? null,
      sharesOutstanding:
        r.share_class_shares_outstanding ?? r.weighted_shares_outstanding ?? null,
      sector: r.sic_description ?? null,
      fetchedAt: Date.now(),
    };
  }
}
