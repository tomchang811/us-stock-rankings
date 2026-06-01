import { FmpProvider } from "./providers/fmp";
import { MockProvider } from "./providers/mock";
import { PolygonProvider } from "./providers/polygon";
import type { DataProvider, StockRow } from "./providers/types";

export type RankingSource = "polygon" | "fmp" | "mock";

export interface RankingsResponse {
  rows: StockRow[];
  asOf: string;
  source: RankingSource;
  /** 取得資料時若發生錯誤而退回示範資料，這裡會帶訊息。 */
  notice?: string;
}

const TOP_N = 50;
const CACHE_SECONDS = Number(process.env.RANKINGS_CACHE_SECONDS ?? 60);

interface CacheEntry {
  data: RankingsResponse;
  ts: number;
}

// 模組層記憶體快取，避免短時間重複呼叫免費 API 觸發額度上限。
let cache: CacheEntry | null = null;

function selectProvider(): { provider: DataProvider; source: RankingSource } {
  const polygonKey = process.env.POLYGON_API_KEY?.trim();
  if (polygonKey) {
    return { provider: new PolygonProvider(polygonKey), source: "polygon" };
  }
  const fmpKey = process.env.FMP_API_KEY?.trim();
  if (fmpKey) {
    return { provider: new FmpProvider(fmpKey), source: "fmp" };
  }
  return { provider: new MockProvider(), source: "mock" };
}

/**
 * 取得成交值排行前 50 名，含 60 秒快取。
 * 若選用的供應商取資料失敗，會退回示範資料並附上 notice。
 */
export async function getRankings(): Promise<RankingsResponse> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_SECONDS * 1000) {
    return cache.data;
  }

  const { provider, source } = selectProvider();

  let data: RankingsResponse;
  try {
    const result = await provider.getTopByDollarVolume(TOP_N);
    data = { rows: result.rows, asOf: result.asOf, source };
  } catch (err) {
    // 真實供應商失敗時退回示範資料，確保畫面仍可用。
    const fallback = await new MockProvider().getTopByDollarVolume(TOP_N);
    data = {
      rows: fallback.rows,
      asOf: fallback.asOf,
      source: "mock",
      notice:
        source !== "mock"
          ? `無法取得即時資料，已改用示範資料：${err instanceof Error ? err.message : String(err)}`
          : undefined,
    };
  }

  cache = { data, ts: now };
  return data;
}
