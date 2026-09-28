# Requirements Document

## Introduction

本ドキュメントは、特定のディレクトリに置かれたMarkdownファイルを自動的にHTMLへ変換し、ブラウザで閲覧できるようにするローカル開発サーバーの要件を定義します。ユーザーはMarkdownファイルを所定のディレクトリに保存するだけで、追加の操作なしにブラウザからHTMLとして確認できます。

## Glossary

- **Server**: ローカルで動作するHTTPサーバープロセス。MarkdownファイルのHTMLへの変換および配信を担当する。
- **Watch_Directory**: Serverが監視する対象のディレクトリ。ユーザーがMarkdownファイルを配置する場所。
- **Markdown_File**: `.md` 拡張子を持つMarkdown形式のテキストファイル。
- **HTML_Output**: Markdown_FileをHTMLに変換した結果。ブラウザで表示可能なHTMLドキュメント。
- **Parser**: Markdown_FileをHTML_Outputに変換するコンポーネント。
- **Pretty_Printer**: HTML_OutputをMarkdown_Fileに戻す整形出力コンポーネント（ラウンドトリップ検証用）。
- **Config_Loader**: 設定ファイル（`mdserver.config.json` または `mdserver.config.yaml`）を読み込み、Serverの起動設定を構成するコンポーネント。
- **File_Watcher**: Watch_Directory内のファイルの変更・追加・削除を検知するコンポーネント。
- **Live_Reload**: ブラウザ上のページをサーバー側からの通知で自動再読み込みする仕組み。

---

## Requirements

### 要件 1: Markdownファイルの配信

**ユーザーストーリー:** Markdownの練習をしているユーザーとして、`.md`ファイルをブラウザで確認したいので、MarkdownファイルをHTMLとして表示するサーバーが欲しい。

#### 受け入れ基準

1. WHEN ブラウザがMarkdown_FileのURLにリクエストを送信したとき、THE Server SHALL Markdown_FileをHTMLに変換し、Content-Type: text/html; charset=utf-8ヘッダーとHTTP 200ステータスコードでレスポンスを返す。
2. WHEN ブラウザが存在しないファイルのURLにリクエストを送信したとき、THE Server SHALL HTTP 404ステータスコードとエラーメッセージを含むHTMLをレスポンスとして返す。
3. WHEN ブラウザがルートURL（`/`）にリクエストを送信したとき、THE Server SHALL Watch_Directory内のMarkdown_Fileの一覧をリンク付きで表示するインデックスページをHTTP 200で返す。
4. WHEN Watch_Directory内にMarkdown_Fileが0件の状態でブラウザがルートURL（`/`）にリクエストを送信したとき、THE Server SHALL ファイルが存在しない旨のメッセージを含むインデックスページをHTTP 200で返す。
5. WHEN Markdown_FileをHTMLへの変換中にエラーが発生したとき、THE Server SHALL HTTP 500ステータスコードとエラー内容を含むHTMLをレスポンスとして返す。

---

### 要件 2: Markdownのパースと変換

**ユーザーストーリー:** ユーザーとして、標準的なMarkdown構文（見出し・リスト・コードブロック・リンクなど）が正しくHTMLに変換されることを期待するので、Parser は一般的なMarkdown仕様に準拠して欲しい。

#### 受け入れ基準

1. WHEN 有効なMarkdown_FileがParserに渡されたとき、THE Parser SHALL 見出し（H1〜H6）・番号なしリスト・番号付きリスト・コードブロック・インラインコード・リンク・画像・テーブル・打消し線を含むGFM（GitHub Flavored Markdown）仕様に準拠したHTMLを生成する。
2. WHEN 空のMarkdown_FileがParserに渡されたとき、THE Parser SHALL 空のHTMLボディを含む有効なHTMLを返す。
3. IF 無効な入力（nullまたはバイナリデータ）がParserに渡された場合、THEN THE Parser SHALL 入力の種別（nullまたはバイナリ）と受け付けられない理由を示すエラーメッセージを返す。
4. WHEN ParserがHTML_OutputをPretty_Printerに渡したとき、THE Pretty_Printer SHALL そのHTML_OutputをGFM準拠のMarkdown形式に変換して出力する。
5. WHEN 有効なMarkdown_FileがParserによってHTMLに変換され、そのHTML_OutputがPretty_PrinterによってMarkdownに変換された後、再度ParserによってHTMLに変換されたとき、THE Parser SHALL 最初の変換で生成したHTML_Outputと構造的に同一のHTMLを生成する。

---

### 要件 3: ファイル監視と自動コンパイル

**ユーザーストーリー:** ユーザーとして、Markdownファイルを保存するたびに手動でコマンドを実行したくないので、ファイルを保存した瞬間に自動でコンパイルが走って欲しい。

#### 受け入れ基準

1. WHEN Watch_Directory（サブディレクトリを含む）内のMarkdown_Fileが保存されたとき、THE File_Watcher SHALL 変更を検知して変換処理を起動する。
2. WHEN Watch_Directory（サブディレクトリを含む）内に新しいMarkdown_Fileが追加されたとき、THE File_Watcher SHALL 新規ファイルを検知して変換処理を起動する。
3. WHEN Watch_Directory内のMarkdown_Fileが削除されたとき、THE File_Watcher SHALL 削除を検知して対応するHTML_OutputをOutput_Directoryおよびキャッシュから削除する。
4. WHEN File_Watcherがファイル変更を検知してから1秒以内に、THE Server SHALL Output_DirectoryへのHTML_Outputの書き出しを完了する。
5. WHEN Watch_Directory内のMarkdown_Fileが300ミリ秒以内に連続して保存されたとき、THE File_Watcher SHALL 最後の保存から300ミリ秒待機した後に変換処理を1回だけ起動する（デバウンス）。
6. WHEN Markdown_FileのHTMLへの変換中にエラーが発生したとき、THE Server SHALL エラー内容をコンソールに出力し、既存のHTML_Outputの状態を変更しない。

---

### 要件 4: ライブリロード

**ユーザーストーリー:** ユーザーとして、ファイルを保存するたびにブラウザを手動でリロードしたくないので、ファイルの変更を検知したら自動でブラウザが更新されて欲しい。

#### 受け入れ基準

1. WHEN File_WatcherがMarkdown_Fileの変更を検知してから1秒以内に、THE Server SHALL 接続中の全ブラウザクライアントにLive_Reload通知を送信する。
2. WHEN ブラウザクライアントがLive_Reload通知を受信してから1秒以内に、THE Browser_Client SHALL 現在表示しているページを自動再読み込みする。
3. THE Server SHALL Server-Sent Events（SSE）を使用してLive_Reload通知を配信する。
4. WHILE ブラウザがLive_Reload接続を確立している間、THE Server SHALL 60秒±5秒ごとにハートビートを送信して接続を維持する。
5. WHEN ブラウザクライアントとのLive_Reload接続が異常切断されたとき、THE Server SHALL その接続をクライアント一覧から削除し、他の接続中クライアントへの通知配信を継続する。

---

### 要件 5: サーバーの起動と設定

**ユーザーストーリー:** ユーザーとして、設定ファイルを置くだけでサーバーの動作を制御したいので、`mdserver.config.json` または `mdserver.config.yaml` に設定を記述できるようにして欲しい。

#### 受け入れ基準

1. WHEN Serverが起動されたとき、THE Config_Loader SHALL カレントディレクトリの `mdserver.config.json` または `mdserver.config.yaml` を読み込む。
2. WHEN 設定ファイルが存在しない場合、THE Config_Loader SHALL `watchDirectory` にカレントディレクトリ、`port` に3000を使用してServerを起動する。
3. WHEN 設定ファイルが存在するとき、THE Config_Loader SHALL `watchDirectory` フィールドに記述されたパスをWatch_Directoryとして使用する。
4. WHEN 設定ファイルが存在するとき、THE Config_Loader SHALL `port` フィールドに記述された値をServerの待ち受けポートとして使用する。
5. WHEN 設定ファイルの `watchDirectory` フィールドが省略された場合、THE Config_Loader SHALL カレントディレクトリをWatch_Directoryとして使用する。
6. WHEN 設定ファイルの `port` フィールドが省略された場合、THE Config_Loader SHALL ポート3000をServerの待ち受けポートとして使用する。
7. IF 設定ファイルの書式が不正（JSONまたはYAMLとして解析できない）な場合、THEN THE Config_Loader SHALL エラーメッセージをコンソールに出力して終了する。
8. IF 設定ファイルの `port` フィールドが有効範囲外（1未満または65535超）、または整数以外の値である場合、THEN THE Config_Loader SHALL エラーメッセージをコンソールに出力して終了する。
9. IF 設定ファイルの `watchDirectory` に指定されたパスが存在しない、またはディレクトリでない場合、THEN THE Config_Loader SHALL エラーメッセージをコンソールに出力して終了する。
10. IF Serverの起動時に指定されたポートが既に使用中である場合、THEN THE Server SHALL エラーメッセージをコンソールに出力して終了する。
11. WHEN Serverが起動したとき、THE Server SHALL 使用中の設定ファイルのパス（存在する場合）・Watch_Directoryの絶対パス・アクセスURL（例: http://localhost:3000）をコンソールに出力する。

---

### 要件 6: 静的アセットの配信

**ユーザーストーリー:** ユーザーとして、Markdownに画像などを埋め込んでも正しく表示されて欲しいので、静的ファイルも配信できるようにして欲しい。

#### 受け入れ基準

1. WHEN ブラウザがWatch_Directory内の`.md`以外のファイル（画像・CSS等）のURLにリクエストを送信したとき、THE Server SHALL そのファイルのバイト列をそのままレスポンスボディとして返す。
2. WHEN ブラウザがWatch_Directory内のファイルにリクエストを送信したとき、THE Server SHALL ファイルの拡張子に対応したContent-Typeヘッダー（未知の拡張子の場合はapplication/octet-stream）を付与してレスポンスを返す。
3. WHEN ブラウザがWatch_Directory内に存在しない静的ファイルのURLにリクエストを送信したとき、THE Server SHALL HTTP 404ステータスコードとエラーメッセージを返す。
