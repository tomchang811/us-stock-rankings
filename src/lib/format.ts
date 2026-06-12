/**
 * 漲跌著色慣例。
 * 預設採美股慣例：漲 = 綠、跌 = 紅。
 * 若要改成台股慣例（漲 = 紅、跌 = 綠），把此值改為 "tw"。
 */
export const COLOR_CONVENTION: "us" | "tw" = "us";

/** 將大額金額格式化為 $1.23T / $45.6B / $789.0M / $12.3K。 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/** 將價格格式化為帶兩位小數的美元。 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 將漲跌幅格式化為 +1.23% / -0.45%。 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** 依漲跌方向與著色慣例回傳對應的 Tailwind 文字顏色 class。 */
export function changeColorClass(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "text-slate-400";
  const up = value > 0;
  if (COLOR_CONVENTION === "tw") {
    return up ? "text-rose-400" : "text-emerald-400";
  }
  return up ? "text-emerald-400" : "text-rose-400";
}

/**
 * 將產業別字串轉為較易讀的標題大小寫。
 * Polygon 的 sic_description 為全大寫（例："SEMICONDUCTORS & RELATED DEVICES"）。
 */
export function formatSector(sector: string): string {
  if (!sector || sector === "—") return "—";
  if (sector !== sector.toUpperCase()) return sector; // 非全大寫則原樣保留
  return sector
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, "&");
}

/**
 * 將 asOf（= 美股某交易日 20:00 UTC 收盤）顯示為「交易日期（星期）」。
 * 不可用本地時間換算：20:00 UTC 在台北是隔日 04:00，會讓日期 +1 造成「時間很怪」。
 * 故直接取 ISO 的日期部分當作美股交易日。
 */
export function formatTradingDate(iso: string): string {
  const d = iso.slice(0, 10); // YYYY-MM-DD（即美股交易日）
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(y, m - 1, day).getDay()];
  return `${d}（${wd}）`;
}

/** 將 ISO 時間戳格式化為使用者本地時間的可讀字串。 */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
