/** 排行榜中單一股票的標準化資料列。 */
export interface StockRow {
  /** 股票代碼，例如 AAPL */
  symbol: string;
  /** 股票名稱（公司名） */
  name: string;
  /** 最新價格 (USD) */
  price: number;
  /** 漲跌幅 (%)，例如 1.23 代表 +1.23% */
  changePercent: number;
  /** 成交金額（成交值）= price × volume (USD) */
  dollarVolume: number;
  /** 市值 (USD) */
  marketCap: number;
  /** 產業別 (sector / industry) */
  sector: string;
}

/** 排行榜查詢結果。 */
export interface RankingResult {
  rows: StockRow[];
  /** 資料時間戳 (ISO 字串) */
  asOf: string;
}

/** 資料供應商轉接層介面。可替換不同的資料來源實作。 */
export interface DataProvider {
  /** 取得依成交金額（成交值）由大到小排序的前 limit 名股票。 */
  getTopByDollarVolume(limit: number): Promise<RankingResult>;
}
