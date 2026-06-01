export type { StockRow, RankingResult } from "@/lib/providers/types";
export type { RankingsResponse, RankingSource } from "@/lib/rankings";

import type { StockRow } from "@/lib/providers/types";

/** 可排序的欄位鍵（對應 StockRow 的數值/文字欄位）。 */
export type SortKey = keyof Pick<
  StockRow,
  "symbol" | "name" | "price" | "changePercent" | "dollarVolume" | "marketCap" | "sector"
>;

export type SortDir = "asc" | "desc";

/** 文字欄位（預設升冪）；其餘為數字欄位（預設降冪）。 */
export const TEXT_COLUMNS: ReadonlySet<SortKey> = new Set(["symbol", "name", "sector"]);
