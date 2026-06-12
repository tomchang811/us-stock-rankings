"use client";

import type { RankingSource } from "@/types/stock";
import { formatTime, formatTradingDate } from "@/lib/format";

interface Props {
  asOf: string | null;
  generatedAt?: string | null;
  source: RankingSource | null;
  aiSource?: "gemini" | "none";
  notice?: string;
  loading: boolean;
  onRefresh: () => void;
}

export default function StatusBar({ asOf, generatedAt, source, aiSource, notice, loading, onRefresh }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
        <span>
          美股收盤：
          <span className="ml-1 font-mono text-slate-200">
            {asOf ? formatTradingDate(asOf) : "—"}
          </span>
        </span>
        {generatedAt && (
          <span>
            更新於：
            <span className="ml-1 font-mono text-slate-300">{formatTime(generatedAt)}</span>
            <span className="ml-1 text-xs text-slate-500">（台北）</span>
          </span>
        )}
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
        {aiSource === "gemini" && (
          <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
            題材分析 · Gemini
          </span>
        )}
        {aiSource === "none" && (
          <span className="rounded-full bg-slate-600/30 px-2.5 py-0.5 text-xs font-medium text-slate-400">
            AI 未啟用
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
