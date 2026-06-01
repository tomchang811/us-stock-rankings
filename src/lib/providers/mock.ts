import type { DataProvider, RankingResult, StockRow } from "./types";

/** 一批知名美股的基礎資料，用於在無 API 金鑰時產生示範排行榜。 */
const SEED: Array<Omit<StockRow, "price" | "changePercent" | "dollarVolume" | "marketCap"> & {
  basePrice: number;
  baseCap: number; // 市值基準 (USD)
  baseVol: number; // 成交量基準 (股)
}> = [
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Technology", basePrice: 122, baseCap: 3.0e12, baseVol: 3.2e8 },
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology", basePrice: 212, baseCap: 3.2e12, baseVol: 6.5e7 },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Consumer Cyclical", basePrice: 245, baseCap: 7.8e11, baseVol: 1.1e8 },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer Cyclical", basePrice: 198, baseCap: 2.1e12, baseVol: 4.5e7 },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology", basePrice: 448, baseCap: 3.3e12, baseVol: 2.2e7 },
  { symbol: "META", name: "Meta Platforms Inc.", sector: "Communication Services", basePrice: 503, baseCap: 1.3e12, baseVol: 1.6e7 },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology", basePrice: 162, baseCap: 2.6e11, baseVol: 5.2e7 },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Communication Services", basePrice: 178, baseCap: 2.2e12, baseVol: 2.8e7 },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Communication Services", basePrice: 685, baseCap: 2.9e11, baseVol: 4.0e6 },
  { symbol: "AVGO", name: "Broadcom Inc.", sector: "Technology", basePrice: 168, baseCap: 7.8e11, baseVol: 2.6e7 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financial Services", basePrice: 205, baseCap: 5.9e11, baseVol: 9.0e6 },
  { symbol: "BRK-B", name: "Berkshire Hathaway", sector: "Financial Services", basePrice: 432, baseCap: 9.3e11, baseVol: 3.5e6 },
  { symbol: "V", name: "Visa Inc.", sector: "Financial Services", basePrice: 268, baseCap: 5.2e11, baseVol: 6.0e6 },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", basePrice: 148, baseCap: 3.6e11, baseVol: 7.0e6 },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer Defensive", basePrice: 69, baseCap: 5.5e11, baseVol: 1.5e7 },
  { symbol: "XOM", name: "Exxon Mobil Corp.", sector: "Energy", basePrice: 113, baseCap: 4.9e11, baseVol: 1.4e7 },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Healthcare", basePrice: 488, baseCap: 4.5e11, baseVol: 3.2e6 },
  { symbol: "MA", name: "Mastercard Inc.", sector: "Financial Services", basePrice: 442, baseCap: 4.1e11, baseVol: 3.0e6 },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Defensive", basePrice: 166, baseCap: 3.9e11, baseVol: 6.0e6 },
  { symbol: "HD", name: "Home Depot Inc.", sector: "Consumer Cyclical", basePrice: 345, baseCap: 3.4e11, baseVol: 3.5e6 },
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer Defensive", basePrice: 845, baseCap: 3.7e11, baseVol: 2.1e6 },
  { symbol: "ORCL", name: "Oracle Corp.", sector: "Technology", basePrice: 142, baseCap: 3.9e11, baseVol: 8.0e6 },
  { symbol: "INTC", name: "Intel Corp.", sector: "Technology", basePrice: 32, baseCap: 1.4e11, baseVol: 4.8e7 },
  { symbol: "BAC", name: "Bank of America", sector: "Financial Services", basePrice: 40, baseCap: 3.1e11, baseVol: 3.6e7 },
  { symbol: "KO", name: "Coca-Cola Co.", sector: "Consumer Defensive", basePrice: 63, baseCap: 2.7e11, baseVol: 1.4e7 },
  { symbol: "PEP", name: "PepsiCo Inc.", sector: "Consumer Defensive", basePrice: 168, baseCap: 2.3e11, baseVol: 5.0e6 },
  { symbol: "CRM", name: "Salesforce Inc.", sector: "Technology", basePrice: 255, baseCap: 2.5e11, baseVol: 5.5e6 },
  { symbol: "ADBE", name: "Adobe Inc.", sector: "Technology", basePrice: 545, baseCap: 2.4e11, baseVol: 3.0e6 },
  { symbol: "DIS", name: "Walt Disney Co.", sector: "Communication Services", basePrice: 98, baseCap: 1.8e11, baseVol: 1.0e7 },
  { symbol: "QCOM", name: "Qualcomm Inc.", sector: "Technology", basePrice: 210, baseCap: 2.3e11, baseVol: 8.5e6 },
  { symbol: "CSCO", name: "Cisco Systems", sector: "Technology", basePrice: 47, baseCap: 1.9e11, baseVol: 1.6e7 },
  { symbol: "MU", name: "Micron Technology", sector: "Technology", basePrice: 135, baseCap: 1.5e11, baseVol: 2.0e7 },
  { symbol: "PFE", name: "Pfizer Inc.", sector: "Healthcare", basePrice: 28, baseCap: 1.6e11, baseVol: 3.0e7 },
  { symbol: "CVX", name: "Chevron Corp.", sector: "Energy", basePrice: 156, baseCap: 2.9e11, baseVol: 8.0e6 },
  { symbol: "ABBV", name: "AbbVie Inc.", sector: "Healthcare", basePrice: 178, baseCap: 3.1e11, baseVol: 5.0e6 },
  { symbol: "WFC", name: "Wells Fargo & Co.", sector: "Financial Services", basePrice: 60, baseCap: 2.0e11, baseVol: 1.5e7 },
  { symbol: "TMO", name: "Thermo Fisher Sci.", sector: "Healthcare", basePrice: 555, baseCap: 2.1e11, baseVol: 1.5e6 },
  { symbol: "MRK", name: "Merck & Co.", sector: "Healthcare", basePrice: 125, baseCap: 3.2e11, baseVol: 8.0e6 },
  { symbol: "ACN", name: "Accenture plc", sector: "Technology", basePrice: 312, baseCap: 1.9e11, baseVol: 2.0e6 },
  { symbol: "LIN", name: "Linde plc", sector: "Basic Materials", basePrice: 432, baseCap: 2.1e11, baseVol: 1.5e6 },
  { symbol: "TXN", name: "Texas Instruments", sector: "Technology", basePrice: 198, baseCap: 1.8e11, baseVol: 4.5e6 },
  { symbol: "PLTR", name: "Palantir Technologies", sector: "Technology", basePrice: 28, baseCap: 6.0e10, baseVol: 4.0e7 },
  { symbol: "SMCI", name: "Super Micro Computer", sector: "Technology", basePrice: 48, baseCap: 2.8e10, baseVol: 3.5e7 },
  { symbol: "BA", name: "Boeing Co.", sector: "Industrials", basePrice: 178, baseCap: 1.1e11, baseVol: 6.0e6 },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrials", basePrice: 168, baseCap: 1.8e11, baseVol: 4.0e6 },
  { symbol: "F", name: "Ford Motor Co.", sector: "Consumer Cyclical", basePrice: 12, baseCap: 4.8e10, baseVol: 5.5e7 },
  { symbol: "T", name: "AT&T Inc.", sector: "Communication Services", basePrice: 19, baseCap: 1.4e11, baseVol: 3.5e7 },
  { symbol: "C", name: "Citigroup Inc.", sector: "Financial Services", basePrice: 64, baseCap: 1.2e11, baseVol: 1.4e7 },
  { symbol: "GS", name: "Goldman Sachs", sector: "Financial Services", basePrice: 478, baseCap: 1.6e11, baseVol: 2.0e6 },
  { symbol: "UBER", name: "Uber Technologies", sector: "Technology", basePrice: 70, baseCap: 1.5e11, baseVol: 1.5e7 },
];

/** 以種子值產生 [-base, +base] 區間的擬真隨機抖動。 */
function jitter(magnitude: number): number {
  return (Math.random() * 2 - 1) * magnitude;
}

/**
 * 示範（假）資料供應商。在沒有設定 FMP_API_KEY 時使用，
 * 讓 UI 與排序功能可以完整運作與驗證。
 */
export class MockProvider implements DataProvider {
  async getTopByDollarVolume(limit: number): Promise<RankingResult> {
    const rows: StockRow[] = SEED.map((s) => {
      const price = +(s.basePrice * (1 + jitter(0.03))).toFixed(2);
      const changePercent = +jitter(4).toFixed(2);
      const volume = Math.round(s.baseVol * (1 + jitter(0.25)));
      const marketCap = Math.round((s.baseCap / s.basePrice) * price);
      return {
        symbol: s.symbol,
        name: s.name,
        price,
        changePercent,
        dollarVolume: price * volume,
        marketCap,
        sector: s.sector,
      };
    });

    rows.sort((a, b) => b.dollarVolume - a.dollarVolume);

    return { rows: rows.slice(0, limit), asOf: new Date().toISOString() };
  }
}
