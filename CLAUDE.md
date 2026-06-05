# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static website (Next.js static export) showing the **US market's top 50 stocks by dollar volume**, with AI-derived theme/族群 labels, a "今日市場焦點" briefing panel (成交重點 + 重大事件，已發生／即將到來), a "發動題材" panel, a "新進榜雷達" (new-entrants) panel, NEW badges, rank-jump (▲N) markers, and a consecutive-days-on-board (streak) column. UI text is Traditional Chinese.

Live: https://usstocktop50.github.io/us-stock-rankings/ · Deploy details in [DEPLOY.md](DEPLOY.md) · Diagrams in [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
npm run dev      # local dev server (reads the committed public/rankings.json)
npm run build    # static export to out/  — ALSO the main typecheck/verify (no test suite)
npm run lint     # next lint
node scripts/snapshot.mjs    # regenerate public/rankings.json (the data pipeline)
node scripts/prewarm.mjs 60  # pre-fill .cache ticker metadata for top N (optional)
```

- There is **no test framework**. Verify changes with `npm run build` (typecheck + export) plus running `snapshot.mjs` and inspecting the JSON.
- `snapshot.mjs` reads `POLYGON_API_KEY` (required) and `GEMINI_API_KEY` (optional) from `.env.local` or env. Without `GEMINI_API_KEY` it still runs (theme falls back to SIC, `aiSource:"none"`).
- Requires Node ≥ 18.18 (Next 15). This machine runs Node via the system install; older v17 will not work.

## Architecture — the one thing to understand

**Data is produced at build time, not runtime.** There is no server and no API route (Next.js `output: "export"`).

1. **`scripts/snapshot.mjs`** (plain ESM, the *only* data pipeline) runs in CI daily:
   `getTradingDaysFresh` finds the latest Polygon grouped-daily (full market) **and self-checks freshness — retries up to 4×20min if the latest available date lags the expected trading day**, then proceeds gracefully → rank by dollar volume `vw×v`, over-rank to 90 → Polygon ticker details to enrich + **drop ETF/fund `type`s** → keep top 50 stocks → fetch the **currently-live `rankings.json`** to compute `isNew`/`rankChange`/`streak` → **three Gemini calls**: `enrichWithGemini` (structured, no search) for theme labels + `themeSummary`; `explainNewEntrants` (`google_search` grounding) for `newEntrants` catalysts; `marketBriefing` (`google_search` grounding) for the 今日市場焦點 panel → writes **`public/rankings.json`** (includes `generatedAt` = run timestamp, surfaced as 更新於 in the UI).
2. `next build` exports static HTML+JS to `out/`; `.github/workflows/deploy.yml` deploys to GitHub Pages. **GitHub `schedule` cron drifts 4+ hours and is only a backup; the punctual ~08:30 Taipei refresh comes from an external cron-job.org job that POSTs `workflow_dispatch`** (see [DEPLOY.md](DEPLOY.md)). Push and manual dispatch also deploy.
3. The browser loads static files and `RankingTable` does a single `fetch("rankings.json")` (relative path, for basePath compat). All sorting is client-side.

Keys live only in CI (GitHub Secrets) / local `.env.local` — never in the shipped bundle.

### Things that will bite you
- **`src/lib/providers/*` and `src/lib/rankings.ts` are orphaned** (an earlier server-mode data layer). The static app does NOT use them; `snapshot.mjs` is the live equivalent. `src/types/stock.ts` is self-contained and is the frontend's type source of truth — edit it, not providers/types.
- **Adding any dynamic server feature (API route, SSR, `force-dynamic`) breaks `output: "export"`.** Keep everything static.
- **`isNew`/`rankChange`/`streak` are relative to the previously deployed snapshot.** A same-trading-day re-run (e.g. a code push) compares against itself → 0 new entries, streak unchanged (this is the `sameDay` guard in snapshot.mjs, not a bug). They populate on the next *new* trading day.
- **Gemini structured output and `google_search` grounding are mutually exclusive in one call** — hence the split: `enrichWithGemini` uses `responseSchema`; the grounded calls (`explainNewEntrants`, `marketBriefing`) use the search tool + tolerant JSON parsing (slice first/last bracket, then `JSON.parse`).
- **Grounded Gemini calls truncate their JSON unless you tame `gemini-2.5-flash`'s default thinking.** Thinking eats the output-token budget → JSON cut mid-string (`Unterminated string`). The grounded calls set `generationConfig: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 2048 }`. Keep that on any new grounded call.
- **Polygon free tier**: EOD/previous-trading-day only (requesting "today" before close returns 403 — the date walk starts at yesterday), ~5 req/min (sliding-window limiter in snapshot.mjs), `.cache/polygon-tickers.json` is the long-lived enrichment cache.

## Environment gotcha (Windows / PowerShell)

PowerShell 5.1 corrupts UTF-8 when reading the JSON or POSTing CJK bodies: `ConvertFrom-Json` chokes on the em-dash/Chinese, and `Invoke-RestMethod` mangles Chinese prompts. **Verify JSON and call APIs with Node (`node -e ...`), not PowerShell cmdlets.** `git` warns about LF→CRLF — harmless.

## Conventions
- Up/down colors: `COLOR_CONVENTION` in `src/lib/format.ts` (default US: up=green/down=red).
- Money/percent/SIC formatting helpers live in `src/lib/format.ts`; reuse them.
- `#` rank in the table always means dollar-volume rank, independent of the active sort column.
