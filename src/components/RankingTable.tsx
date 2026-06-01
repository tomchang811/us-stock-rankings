"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SortableHeader from "./SortableHeader";
import StatusBar from "./StatusBar";
import {
  changeColorClass,
  formatMoney,
  formatPercent,
  formatPrice,
  formatSector,
} from "@/lib/format";
import {
  TEXT_COLUMNS,
  type RankingsResponse,
  type RankingSource,
  type SortDir,
  type SortKey,
  type StockRow,
} from "@/types/stock";

// 靜態網站：資料來自每日排程產生的 rankings.json（相對路徑以相容 basePath）。
const DATA_URL = "rankings.json";

interface ColumnDef {
  key: SortKey;
  label: string;
  align: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "股票名稱", align: "left" },
  { key: "symbol", label: "代碼", align: "left" },
  { key: "price", label: "價格", align: "right" },
  { key: "changePercent", label: "漲跌幅", align: "right" },
  { key: "dollarVolume", label: "成交金額", align: "right" },
  { key: "marketCap", label: "市值", align: "right" },
  { key: "sector", label: "產業別", align: "left" },
];

function compare(a: StockRow, b: StockRow, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  let result: number;
  if (typeof av === "number" && typeof bv === "number") {
    result = av - bv;
  } else {
    result = String(av).localeCompare(String(bv));
  }
  return dir === "asc" ? result : -result;
}

export default function RankingTable() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [source, setSource] = useState<RankingSource | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("dollarVolume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`讀取資料失敗 ${res.status}`);
      const data = (await res.json()) as RankingsResponse;
      setRows(data.rows);
      setAsOf(data.asOf);
      setSource(data.source);
      setNotice(data.notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  // 開啟頁面立即載入。資料每日由排程更新，故不需輪詢；保留手動重新整理。
  useEffect(() => {
    void load();
  }, [load]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      // 切到新欄位：文字欄預設升冪、數字欄預設降冪。
      setSortDir(TEXT_COLUMNS.has(key) ? "asc" : "desc");
      return key;
    });
  }, []);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);

  const showSkeleton = loading && rows.length === 0;

  return (
    <div>
      <StatusBar
        asOf={asOf}
        source={source}
        notice={notice}
        loading={loading}
        onRefresh={() => void load()}
      />

      {error && rows.length === 0 ? (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-8 text-center text-rose-300">
          載入失敗：{error}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-rose-700 px-3 py-1.5 text-sm hover:bg-rose-900/40"
            >
              重試
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800 shadow-xl">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-slate-900/95 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 backdrop-blur"
                >
                  #
                </th>
                {COLUMNS.map((c) => (
                  <SortableHeader
                    key={c.key}
                    label={c.label}
                    sortKey={c.key}
                    activeKey={sortKey}
                    dir={sortDir}
                    align={c.align}
                    onSort={handleSort}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {showSkeleton
                ? Array.from({ length: 12 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-800/60">
                      <td className="px-3 py-3" colSpan={COLUMNS.length + 1}>
                        <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
                      </td>
                    </tr>
                  ))
                : sortedRows.map((row, i) => (
                    <tr
                      key={row.symbol}
                      className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40"
                    >
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-500">
                        {i + 1}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-slate-100">
                        {row.name}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-slate-200">
                        {row.symbol}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-200">
                        {formatPrice(row.price)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-medium ${changeColorClass(
                          row.changePercent,
                        )}`}
                      >
                        {formatPercent(row.changePercent)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-300">
                        {formatMoney(row.dollarVolume)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {formatMoney(row.marketCap)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400">{formatSector(row.sector)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {!showSkeleton && !error && sortedRows.length === 0 && (
        <div className="rounded-lg border border-slate-800 p-8 text-center text-slate-500">
          目前沒有資料。
        </div>
      )}
    </div>
  );
}
