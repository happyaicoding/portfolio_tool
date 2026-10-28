# 黃金龜投資組合績效報表

把原本的 Excel(`.xlsm`)計算式改寫成網站與桌面軟體。資料只在本機處理。

## 使用
- 網站:`npm start` 後開 <http://localhost:8000>(或把 `web/` 放到任何靜態主機,例如 GitHub Pages)。
- 桌面版:`npm install` 後 `npm run desktop`;`npm run dist` 打包。桌面版直接載入同一份 `web/`。
- 上傳:CSV / `.xlsx` / `.xlsm`。每檔一個策略(日期、損益),或寬表(第一欄日期,其餘每欄一策略),或原報表的「文字檔」工作表。

## 結構
- `web/src/core.js` 計算核心(MAXDD、MovingDayDD、月/年矩陣、創高天數、資金規劃),無相依。
- `web/src/parse.js` CSV / xlsx 解析,無相依。
- `web/src/app.js`、`charts.js`、`index.html` 介面。
- `tests/` 以原 Excel 快取值驗證:`npm test`(需把原 `.xlsm` 放在專案根目錄)。

## 與 Excel 的已知差異
- Excel 的日序列延伸到「更新當天」,多出的未來日損益為 0,會讓每日浮動區間的平均與標準差略有不同;本工具只到資料最後一天。
- 「保證金檢核」沿用原公式(所需保證金 < 最少資金準備 才顯示 YES),邏輯看起來可能與直覺相反,請自行確認。
