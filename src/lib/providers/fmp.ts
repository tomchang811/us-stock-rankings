import type { DataProvider, RankingResult, StockRow } from "./types";

const BASE = "https://financialmodelingprep.com/api/v3";

/** FMP stock-screener 端點回傳的單筆資料（取我們需要的欄位）。 */
interface FmpScreenerItem {
  symbol: string;
  companyName: string | null;
  price: number | null;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  volume: number | null;
  exchangeShortName: string | null;
  isActivelyTrading?: boolean;
}

/** FMP quote 批次端點回傳的單筆資料（取我們需要的欄位）。 */
interface FmpQuoteItem {
  symbol: string;
  name: string | null;
  price: number | null;
  changesPercentage: number | null;
  marketCap: number | null;
  volume: number | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FMP 請求失敗 (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  // FMP 在錯誤（例如金鑰無效、額度用盡）時會回傳 { "Error Message": ... }
  if (data && !Array.isArray(data) && typeof data === "object" && "Error Message" in data) {
    throw new Error(`FMP 錯誤：${(data as Record<string, unknown>)["Error Message"]}`);
  }
  return data as T;
}

/**
 * Financial Modeling Prep 資料供應商。
 *
 * 策略：先用 stock-screener 取得全市場（NYSE/NASDAQ/AMEX）每檔的價格與成交量，
 * 在伺服器端計算成交金額（price × volume）排序取前 N，再用 quote 批次端點
 * 補上最即時的漲跌幅與價格。
 */
export class FmpProvider implements DataProvider {
  constructor(private readonly apiKey: string) {}

  async getTopByDollarVolume(limit: number): Promise<RankingResult> {
    const screenerUrl =
      `${BASE}/stock-screener?exchange=nyse,nasdaq,amex` +
      `&isActivelyTrading=true&limit=10000&apikey=${this.apiKey}`;

    const items = await fetchJson<FmpScreenerItem[]>(screenerUrl);

    const ranked = items
      .map((it) => {
        const price = it.price ?? 0;
        const volume = it.volume ?? 0;
        return {
          item: it,
          price,
          volume,
          dollarVolume: price * volume,
        };
      })
      .filter((r) => r.price > 0 && r.volume > 0 && r.dollarVolume > 0)
      .sort((a, b) => b.dollarVolume - a.dollarVolume)
      .slice(0, limit);

    // 用 quote 批次端點補上最即時的漲跌幅（screener 不含 changesPercentage）。
    const symbols = ranked.map((r) => r.item.symbol);
    const quoteMap = await this.fetchQuotes(symbols);

    const rows: StockRow[] = ranked.map((r) => {
      const it = r.item;
      const q = quoteMap.get(it.symbol);
      const price = q?.price ?? r.price;
      const volume = q?.volume ?? r.volume;
      return {
        symbol: it.symbol,
        name: it.companyName ?? q?.name ?? it.symbol,
        price,
        changePercent: q?.changesPercentage ?? 0,
        // 以 quote 的最新價/量重新計算成交金額（若有），否則沿用 screener。
        dollarVolume: q?.price != null && q?.volume != null ? price * volume : r.dollarVolume,
        marketCap: it.marketCap ?? q?.marketCap ?? 0,
        sector: it.sector ?? it.industry ?? "—",
      };
    });

    return { rows, asOf: new Date().toISOString() };
  }

  private async fetchQuotes(symbols: string[]): Promise<Map<string, FmpQuoteItem>> {
    const map = new Map<string, FmpQuoteItem>();
    if (symbols.length === 0) return map;
    try {
      const url = `${BASE}/quote/${symbols.join(",")}?apikey=${this.apiKey}`;
      const quotes = await fetchJson<FmpQuoteItem[]>(url);
      for (const q of quotes) map.set(q.symbol, q);
    } catch {
      // quote 補強為加分項，失敗時不影響排行榜主體（漲跌幅退為 0）。
    }
    return map;
  }
}
