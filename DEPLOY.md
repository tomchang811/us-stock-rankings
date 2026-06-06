# 部署指南：GitHub Pages（純靜態 + 每日排程快照）

本專案是 **Next.js 靜態網站**。資料由 GitHub Action 每日（美股收盤後）執行
`scripts/snapshot.mjs` 抓取 Polygon，產生 `public/rankings.json`，編譯成純靜態檔後
部署到 GitHub Pages。**訪客只讀靜態 JSON，不會呼叫 Polygon**，故無速率限制問題，
API 金鑰也只存在 GitHub Secret。

## 架構

```
GitHub Action（排程 / 手動 / push）
   └─ node scripts/snapshot.mjs   → 產生 public/rankings.json（前一交易日全市場前50）
   │                                 + public/history/<交易日>.json、重建 index.json / trends.json
   └─ npm run build               → 靜態匯出到 out/
   └─ deploy-pages                → 發佈到 GitHub Pages
   └─ git commit [skip ci]        → 把 rankings.json + history/ 寫回 main（讓歷史跨日累積）
訪客瀏覽器 → 載入 index.html → fetch history/index.json → 最新一天 → 點列看走勢（trends.json）
```

## 一次性設定步驟

### 1. 建立 Git 儲存庫並推上 GitHub
```powershell
git init
git add .
git commit -m "Initial commit: 美股成交值排行 Top 50"
git branch -M main
# 在 GitHub 建一個新的 repo（例如 stock-rankings），然後：
git remote add origin https://github.com/<你的帳號>/<repo 名稱>.git
git push -u origin main
```
> `.env.local`（含金鑰）已被 `.gitignore` 排除，不會被推上去。

### 2. 設定 Repository Secrets
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
- `POLYGON_API_KEY`：你的 Polygon 金鑰（必要）
- `GEMINI_API_KEY`：你的 Google Gemini 金鑰（選用，做 AI 題材/族群分析；免費取得：https://aistudio.google.com/apikey 。未設定時題材欄會退回 SIC 產業別）

### 3. 啟用 GitHub Pages（用 Actions 部署）
GitHub repo → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

### 4. 觸發第一次部署
- 推送到 `main` 會自動觸發，或到 **Actions** 分頁手動跑 **Snapshot & Deploy**（workflow_dispatch）。
- 完成後網址會出現在 Action 的 `deploy` 步驟，通常是
  `https://<你的帳號>.github.io/<repo 名稱>/`

## 之後的更新
- **資料**：排程（UTC 00:40、02:17，週二至週六）自動更新，無需手動；CI 會把 `rankings.json` 與 `public/history/` 用 `[skip ci]` commit 回 `main`，歷史因此能跨日累積。
- **程式**：改完 push 到 `main` 即自動重新部署。
- **手動更新資料**：到 Actions 分頁手動執行 **Snapshot & Deploy**。

## 歷史回補（一次性）
首次啟用「歷史走勢」時，過去的資料需回補一次：到 **Actions → Backfill history → Run workflow**，輸入要回補的交易日數（預設 60）。它會在 CI（Gemini Secret 可用 → 題材品質較佳）跑 `scripts/backfill.mjs`、重建 `index.json`/`trends.json`、部署並 commit 回 `main`。之後每日 snapshot 會自動把新交易日接續寫入，不需再回補。
- 也可本機執行：`node scripts/backfill.mjs 60`（`.env.local` 需有 `POLYGON_API_KEY`；有 `GEMINI_API_KEY` 則題材更準）。Polygon 免費層約每分鐘 5 次，回補 60 天約需數十分鐘。

> **Polygon 免費層的時間差**：剛收盤的交易日資料會被擋（`403 today's data before end of day`）直到「美東時間跨日」才開放，實測約收盤後 8 小時（≈ UTC 04:00–05:00）。所以清晨的排程／備援班拿到的是「前一個」已開放的交易日；資料要等較晚的執行（或 UTC 05:00 後重新觸發）才會推進。

## 本機開發
```powershell
node scripts/snapshot.mjs   # 產生 public/rankings.json（需 .env.local 內的 POLYGON_API_KEY）
npm run dev                 # http://localhost:3000
```
或預覽正式靜態輸出：
```powershell
npm run build               # 產生 out/
```

## 備註
- `basePath` 由 workflow 透過 `actions/configure-pages` 自動帶入（專案站台為 `/<repo>`，
  使用者站台或自訂網域為空），不需手動設定。
- Polygon 免費方案為**前一交易日收盤**資料；網站標示為「前一交易日收盤」。
- 若要綁自訂網域：GitHub Pages 設定網域後，`configure-pages` 會回傳空 base_path，
  前端的相對路徑載入仍可正常運作。
