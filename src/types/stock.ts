// 前端（靜態網站）使用的型別。資料來自每日排程產生的 rankings.json，
// 故型別在此自足定義，不依賴執行期的 provider 程式碼。

export interface StockRow {
  symbol: string; // 股票代碼
  name: string; // 股票名稱
  price: number; // 價格
  changePercent: number; // 漲跌幅 (%)
  dollarVolume: number; // 成交金額 = 均價 × 成交量
  marketCap: number; // 市值
  sector: string; // 原始 SIC 產業（後備用）
  theme: string; // AI 題材/族群（無 AI 時退為 SIC 格式化字串）
  isNew: boolean; // 是否首次進前 50（對比前一交易日）
  rankChange: number | null; // 前一名次 − 本次名次（正=上升；新進為 null）
  streak: number; // 連續在榜天數（含當日；新進為 1）
}

/** 一個「發動題材」族群。 */
export interface ThemeSummaryItem {
  theme: string;
  reason: string;
  symbols: string[];
  count: number;
  avgChange: number;
}

export type RankingSource = "polygon" | "fmp" | "mock";

export interface RankingsResponse {
  rows: StockRow[];
  asOf: string;
  source: RankingSource;
  /** AI 題材分析來源；none 表示未啟用。 */
  aiSource: "gemini" | "none";
  themeSummary: ThemeSummaryItem[];
  notice?: string;
}

/** 可排序的欄位鍵。 */
export type SortKey = keyof Pick<
  StockRow,
  "symbol" | "name" | "price" | "changePercent" | "dollarVolume" | "marketCap" | "theme" | "streak"
>;

export type SortDir = "asc" | "desc";

/** 文字欄位（預設升冪）；其餘為數字欄位（預設降冪）。 */
export const TEXT_COLUMNS: ReadonlySet<SortKey> = new Set(["symbol", "name", "theme"]);
