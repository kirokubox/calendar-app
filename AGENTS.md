# calendar-app（カレンダー アプリ本体）フォルダマップ

コード・Git操作・ビルドの正本はここ。

## 正本の場所

- コード・Git操作・ビルド：ここ（`09_開発\01_自分用アプリ\calendar-app`）
- 仕様・要件・改善履歴などの資料：`C:\Users\masat\yuki_local_workspace\05_開発・Webアプリ\16_カレンダー`（要件の正本は `166_カレンダー_要件と経緯.md`）
- コーディングルール：`09_開発\AGENTS.md`
- Webアプリ開発の共通ルール：`05_開発・Webアプリ\00_共通\`

## ルール

- 仕様書・改善履歴・調査資料をここに増やさない。資料の更新は05側の該当ファイルを直す
- 個人データ（バックアップJSON `calendar-backup-*.json`・実データ・実データ入りスクショ）をコミットしない
- アプリを改善したら「05側の現在の仕様の更新＋改善履歴への追記」をワンセットで行う（`00_共通/09_共有_資料整理ルール.md` のルール）。初期仕様（161）は凍結で編集しない
- 検証：`npm run build`（型チェック＋本番ビルド）と `npm test`（純粋ロジックの `node --test`）を通す

## コード構成（要点）

- 純粋ロジック（テスト対象）：`src/dateUtils.ts`（日付）、`src/layout.ts`（日の切り出し・列分割）、`src/eventLogic.ts`（終了日の自動翌日化・種別判定・候補・＋ボタンの範囲）、`src/backup.ts`（バックアップの検証とマージ）、`src/colors.ts`、`src/recurrence.ts`（繰り返しの生成・反映・分割・墓標）、`src/holidays.ts`（祝日の計算）
- 純粋ロジック（v0.4.0で追加）：`src/markerLogic.ts`（マーカーの並びと経過時間）、`src/searchLogic.ts`（検索・前回日・回数）。継続中のセッションは `src/nagaraLogic.ts`、場所・「主行動の流れに含む」の集計は `src/reviewLogic.ts`
- IndexedDB：`src/storage.ts`（DB名 `calendar-app`、DB_VERSION 3。ストア `events` / `nagara` / `revisions` / `recurrences` / `markers` / `settings`。記録中の睡眠は `settings` ストアの別キー）
- 画面：`src/App.tsx`（日表示・全体のつなぎ）、`src/WeekView.tsx`（週・4日表示）、`src/EventBlock.tsx`（ブロックの行数と表示）、`src/EventModal.tsx`（入力シート）、`src/EventViewer.tsx`（閲覧モード）、`src/SearchView.tsx`（検索）、`src/QuickPanel.tsx`（いまの時刻で記録）、`src/RunningBand.tsx`（継続中の帯）、`src/MarkerSheet.tsx`（マーカーの修正）、`src/SettingsView.tsx`（設定）
- シート（`.sheet`）やブロック（`.event`）は縦並びのflex。中に `overflow: hidden` の部品を足すと高さ0へ縮むので、直下の子は `flex: none` にしてある（v0.3.3のタブ潰れの原因）
- 日時は `YYYY-MM-DDTHH:mm` のローカル時刻文字列で持つ。UTC変換しない
