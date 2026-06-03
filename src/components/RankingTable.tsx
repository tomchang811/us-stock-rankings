"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SortableHeader from "./SortableHeader";
import StatusBar from "./StatusBar";
import ThemeSummary from "./ThemeSummary";
import NewEntrants from "./NewEntrants";
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
  type ThemeSummaryItem,
  type NewEntrant,
} from "@/types/stock";

// 靜態網站：資料來自每日排程產生的 rankings.json（相對路徑以相容 basePath）。
const DATA_URL = "rankings.json";
const RANK_JUMP_THRESHOLD = 10; // 排名躍升標示門檻

/** 依在榜天數給顏色：1 天(剛發動，灰) / 2–4 天 / ≥5 天(持續強勢，綠)。 */
function streakClass(streak: number): string {
  if (streak >= 5) return "text-emerald-300 font-semibold";
  if (streak >= 2) return "text-slate-300";
  return "text-slate-500";
}

interface ColumnDef {
  key: SortKey;
  label: string;
  align: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "symbol", label: "代碼", align: "left" },
  { key: "price", label: "價格", align: "right" },
  { key: "changePercent", label: "漲跌幅", align: "right" },
  { key: "streak", label: "在榜天數", align: "right" },
  { key: "dollarVolume", label: "成交金額", align: "right" },
  { key: "marketCap", label: "市值", align: "right" },
  { key: "theme", label: "題材/族群", align: "left" },
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
  const [aiSource, setAiSource] = useState<"gemini" | "none">("none");
  const [themeSummary, setThemeSummary] = useState<ThemeSummaryItem[]>([]);
  const [newEntrants, setNewEntrants] = useState<NewEntrant[]>([]);
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
      setAiSource(data.aiSource ?? "none");
      setThemeSummary(data.themeSummary ?? []);
      setNewEntrants(data.newEntrants ?? []);
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

  // 成交值名次（# 永遠代表成交金額排名，與排序方式無關）。
  const rankBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    [...rows]
      .sort((a, b) => b.dollarVolume - a.dollarVolume)
      .forEach((r, i) => m.set(r.symbol, i + 1));
    return m;
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);

  const showSkeleton = loading && rows.length === 0;

  return (
    <div>
      <StatusBar
        asOf={asOf}
        source={source}
        aiSource={aiSource}
        notice={notice}
        loading={loading}
        onRefresh={() => void load()}
      />

      {!showSkeleton && <NewEntrants items={newEntrants} />}
      {!showSkeleton && <ThemeSummary items={themeSummary} aiSource={aiSource} />}

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
                : sortedRows.map((row) => {
                    const rank = rankBySymbol.get(row.symbol) ?? 0;
                    const jumped =
                      row.rankChange != null && row.rankChange >= RANK_JUMP_THRESHOLD;
                    return (
                      <tr
                        key={row.symbol}
                        className={`border-b border-slate-800/60 transition-colors hover:bg-slate-800/40 ${
                          row.isNew ? "bg-amber-400/[0.07]" : ""
                        }`}
                      >
                        <td className="px-3 py-2.5 text-right align-top">
                          <div className="font-mono text-xs text-slate-500">{rank}</div>
                          {jumped && (
                            <div className="font-mono text-[10px] font-semibold text-emerald-400">
                              ▲{row.rankChange}
                            </div>
                          )}
                        </td>
                        <td
                          className="px-3 py-2.5 font-mono font-semibold text-slate-200"
                          title={row.name}
                        >
                          {row.isNew && (
                            <span className="mr-1.5 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 align-middle">
                              NEW
                            </span>
                          )}
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
                        <td className="px-3 py-2.5 text-right font-mono">
                          <span className={streakClass(row.streak)}>{row.streak}</span>
                          <span className="ml-0.5 text-[10px] text-slate-600">天</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-emerald-300">
                          {formatMoney(row.dollarVolume)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                          {formatMoney(row.marketCap)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {row.theme || formatSector(row.sector)}
                        </td>
                      </tr>
                    );
                  })}
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
