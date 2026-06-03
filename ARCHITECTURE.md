# 系統架構文件

美股成交值排行 Top 50 —— 純靜態網站 + 每日 AI 快照。

核心設計：**所有重活（抓資料、排序、AI 分析）集中在每日一次的 GitHub Action**，產物是一份靜態 `rankings.json`；**訪客端只讀這份靜態檔**，不呼叫任何 API、不需金鑰、沒有伺服器 → 零成本、不被速率限制、不易壞。

---

## 1. 整體架構流程圖

```mermaid
flowchart TD
  CRON["⏰ 排程觸發<br/>每交易日收盤後"] --> JOB
  PUSH["📤 push 到 main"] --> JOB
  MANUAL["👆 手動觸發"] --> JOB

  subgraph GHA["GitHub Actions（每日自動執行）"]
    JOB["checkout + npm ci<br/>還原 .cache 快取"] --> SNAP
    subgraph SNAP["scripts/snapshot.mjs（資料產生）"]
      direction TB
      A["① Polygon grouped-daily<br/>最新+前一交易日 全市場約1.2萬檔"] --> B["② 依成交值 價格×成交量 排序<br/>取前 90"]
      B --> C["③ Polygon 明細補 名稱/市值/SIC<br/>濾掉 ETF → 湊滿 50 檔個股"]
      C --> D["④ 抓線上前一份 rankings.json<br/>算 新進榜 / 排名變動 / 在榜天數"]
      D --> E["⑤ Gemini 結構化<br/>每檔題材標籤 + 發動題材摘要"]
      E --> F["⑥ Gemini + Google搜尋<br/>新進榜個股催化劑說明"]
      F --> G["⑦ 寫出 public/rankings.json"]
    end
    G --> BUILD["next build<br/>靜態匯出 out/"] --> DEP["部署 GitHub Pages"]
  end

  POLY[("Polygon.io API<br/>市場資料")] -.-> A
  POLY -.-> C
  GEM[("Google Gemini API")] -.-> E
  GEM -.-> F
  SNAP -.讀/寫.-> CACHE[("快取 .cache<br/>明細 + 題材標籤")]

  DEP --> SITE
  subgraph SITE["GitHub Pages（靜態主機）"]
    RJSON["rankings.json"]
    SHTML["index.html + JS"]
  end

  subgraph CLIENT["訪客瀏覽器（純靜態·不碰金鑰）"]
    L["開啟網頁"] --> FE["fetch rankings.json"] --> RT["RankingTable"]
    RT --> P1["🆕 新進榜雷達面板"]
    RT --> P2["🔥 發動題材面板"]
    RT --> P3["排行表：NEW標籤 / ▲躍升 / 在榜天數 / 點欄位排序"]
  end
  SHTML --> L
  RJSON --> FE
```

**重點**
- 建置期金鑰：`POLYGON_API_KEY`、`GEMINI_API_KEY`（GitHub Secrets，只存在 CI）。
- `.cache`（明細與題材標籤）以 actions/cache 跨執行保留，降低 API 呼叫。
- 排程 `0 2 * * 2-6`（UTC，美股收盤後，週二至週六）；push / 手動也會觸發。

---

## 2. 資料欄位流向圖

每個欄位是怎麼算出來的、來自哪個來源。

```mermaid
flowchart LR
  subgraph SRC["資料來源"]
    PG["Polygon grouped-daily<br/>最新日 c/v/vw/o + 前一日 c"]
    PD["Polygon ticker details<br/>name/type/market_cap/shares/sic"]
    PREV["線上前一份 rankings.json<br/>名次 + 各列 streak + asOf"]
    GST["Gemini 結構化輸出"]
    GGR["Gemini + Google 搜尋"]
  end

  subgraph ROW["StockRow（每一列）"]
    f_sym["symbol 代碼"]
    f_name["name 名稱"]
    f_price["price 價格"]
    f_chg["changePercent 漲跌幅"]
    f_dv["dollarVolume 成交金額"]
    f_cap["marketCap 市值"]
    f_sec["sector 原始SIC"]
    f_theme["theme 題材/族群"]
    f_new["isNew 新進榜"]
    f_rc["rankChange 排名變動"]
    f_streak["streak 在榜天數"]
  end

  subgraph TOP["頂層欄位"]
    t_sum["themeSummary 發動題材"]
    t_ne["newEntrants 新進榜雷達"]
    t_ai["aiSource"]
    t_asof["asOf 交易日"]
  end

  PG --> f_sym
  PG --> f_price
  PG --> f_dv
  PG --> f_chg
  PG --> t_asof
  PD --> f_name
  PD --> f_sec
  PD -->|"type 濾掉 ETF"| ROW
  PD --> f_cap
  PG -->|"× 收盤價"| f_cap
  PREV --> f_new
  PREV --> f_rc
  PREV --> f_streak
  GST --> f_theme
  GST --> t_sum
  GST --> t_ai
  GGR --> t_ne
```

**算法重點**
- `dollarVolume`（成交金額）= 均價 `vw` × 成交量 `v`；排序依據。
- `changePercent` = (最新收盤 − 前一日收盤) / 前一日收盤。
- `marketCap` = 流通股數 × 最新收盤（無股數則用 Polygon `market_cap`）；ETF 無市值。
- `theme` 優先序：Gemini → `.cache` 內題材（30 天 TTL）→ SIC 格式化字串（後備）。
- `isNew` / `rankChange` / `streak` 皆與「線上前一份快照」比對；同一交易日重跑不累加 streak。
- 缺 `GEMINI_API_KEY` 或呼叫失敗 → `aiSource="none"`、`theme` 退回 SIC、`themeSummary`/`newEntrants` 為空。

---

## 3. 前端元件樹

```mermaid
flowchart TD
  LAYOUT["app/layout.tsx<br/>根版面（中文/字型/全域樣式）"] --> PAGE["app/page.tsx<br/>標題 + 說明"]
  PAGE --> RT["RankingTable.tsx (client)<br/>fetch rankings.json · 排序狀態 · 名次計算"]
  RT --> SB["StatusBar.tsx<br/>資料時間 / 來源 / AI 標示 / 重新整理"]
  RT --> NE["NewEntrants.tsx<br/>🆕 新進榜雷達（空陣列則隱藏）"]
  RT --> TS["ThemeSummary.tsx<br/>🔥 發動題材（aiSource=none 顯示未啟用）"]
  RT --> TBL["排行表 table"]
  TBL --> SH["SortableHeader.tsx ×7 欄<br/>點擊切換 升/降冪"]
  TBL --> ROWS["資料列<br/>NEW標籤 / ▲躍升 / 在榜天數著色 / 題材"]

  FMT["lib/format.ts<br/>金額·價格·百分比·著色·SIC格式化"] -.被使用.-> SB
  FMT -.-> NE
  FMT -.-> TS
  FMT -.-> TBL
  TYPES["types/stock.ts<br/>StockRow / SortKey / ThemeSummaryItem / NewEntrant"] -.型別.-> RT
```

**重點**
- 整個前端只有一處抓資料：`RankingTable` 載入時 `fetch('rankings.json')`（相對路徑，相容 GitHub Pages 子路徑）。
- 排序全在前端（對已載入的 50 列），即時無延遲；`#` 名次固定代表「成交值排名」，與當前排序無關。
- 著色慣例（漲綠跌紅 / 台股漲紅跌綠）集中在 `lib/format.ts` 的 `COLOR_CONVENTION` 常數。

---

## 檔案地圖

| 路徑 | 角色 |
|------|------|
| `scripts/snapshot.mjs` | **資料引擎**：抓 Polygon + Gemini 分析 → 產 `public/rankings.json` |
| `scripts/prewarm.mjs` | 預熱明細快取（選用） |
| `.github/workflows/deploy.yml` | 每日排程 + 建置 + 部署 Pages |
| `src/app/{layout,page}.tsx`、`globals.css` | 頁面外殼 |
| `src/components/RankingTable.tsx` | 主表格（抓資料、排序、標示） |
| `src/components/{NewEntrants,ThemeSummary,StatusBar,SortableHeader}.tsx` | 面板與表頭 |
| `src/lib/format.ts` | 格式化與著色工具 |
| `src/types/stock.ts` | 前端共用型別（自足） |
| `public/rankings.json` | 每日資料快照（CI 產生、靜態提供） |
| `src/lib/providers/*`、`src/lib/rankings.ts` | 早期 server 模式的資料層（靜態版未使用，保留供未來 server 部署參考） |

> 部署與金鑰設定見 [DEPLOY.md](DEPLOY.md)。
