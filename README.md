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

## Windows 免安裝版(portable)
- `.github/workflows/desktop-windows.yml` 在 `windows-latest` 上:跑 `npm test` → `npm run dist:win` 打包 → 啟動打包後的 exe、上傳原 `.xlsm`、檢查畫面數字並截圖。
- 產物在該次 Actions 執行頁的 Artifacts:`PortfolioTool-portable`(單一 `.exe`,雙擊即用)與 `desktop-screenshot`。
- 推 `v*` tag(例如 `v0.1.2`)時,會自動把版號設成 tag 的版號,並把 `PortfolioTool-<版號>-portable.exe` 附到 GitHub Release。
- 尚未簽章,Windows SmartScreen 第一次執行會警告(更多資訊 → 仍要執行)。

## 桌面版:自動讀取資料夾內所有 CSV
- 開啟程式時自動讀取一個資料夾內全部的 `.csv`/`.tsv`/`.txt`(每檔一個策略,或一張寬表);資料夾內檔案有增減或修改,畫面會自動更新,已調整的策略權重與設定會保留。
- 預設資料夾:portable `.exe` 所在的資料夾(開發時為專案的 `data/`)。可按「選擇資料夾」改成別處,下次啟動會記住。
- CSV 編碼自動判斷(UTF-8,不合法時改用 Big5);分隔符號支援逗號、Tab、分號。
- 網站版受瀏覽器限制,無法自動讀資料夾,仍需手動選檔或拖曳。

## 記錄檔與截圖(桌面版)
- 資料夾內的 CSV 有新增、修改、刪除時,程式會寫一行到資料夾內的 `portfolio-tool.log`(可用記事本開啟,UTF-8),格式:`時間 | 類型 | 內容`,類型有「載入、新增、修改、刪除、截圖」;修改會註明筆數變化(例如 `90 → 91 筆(+1)`)。
- 右上角「📷 截圖並記錄」會把整張總表存成 PNG 到資料夾內的 `snapshots/`,並在記錄檔寫一行當下的關鍵數字(商品與比例、總獲利、最大策略虧、預期年報酬/報酬率、最新創高日)。
- 程式內的「記錄」分頁顯示同樣內容(最新在最上面),下次開啟會接著顯示以前的記錄。
- 記錄檔與 `snapshots/` 是程式自己寫的,不會被當成策略讀進來,也不會觸發重新載入。
- 網站版的記錄只保存在瀏覽器裡(不寫檔案),截圖功能僅桌面版提供。
