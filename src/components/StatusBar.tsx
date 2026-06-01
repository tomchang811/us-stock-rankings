"use client";

import type { RankingSource } from "@/types/stock";
import { formatTime } from "@/lib/format";

interface Props {
  asOf: string | null;
  source: RankingSource | null;
  notice?: string;
  loading: boolean;
  onRefresh: () => void;
}

export default function StatusBar({ asOf, source, notice, loading, onRefresh }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
        <span>
          資料時間：
          <span className="ml-1 font-mono text-slate-200">
            {asOf ? formatTime(asOf) : "—"}
          </span>
        </span>
        {source === "mock" && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
            示範資料（未設定 API 金鑰）
          </span>
        )}
        {source === "polygon" && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            全市場資料 · Polygon（前一交易日收盤）
          </span>
        )}
        {source === "fmp" && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            即時資料 · FMP
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {loading && <span className="text-xs text-slate-500">更新中…</span>}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          重新整理
        </button>
      </div>

      {notice && (
        <p className="w-full rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {notice}
        </p>
      )}
    </div>
  );
}
