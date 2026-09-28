# Implementation Plan: md-to-html-server

## Overview

TypeScript (Node.js 20+) で実装するローカル Markdown プレビューサーバーの実装計画です。
純粋関数コンポーネントを先に実装し、HTTP サーバー・ファイル監視・SSE の順に統合します。
すべてのコンポーネントは `Result<T, E>` 型でエラーを伝搬し、例外に依存しない設計とします。

## Tasks

- [x] 1. プロジェクト基盤のセットアップ
  - `package.json`（dependencies: marked, turndown, chokidar, js-yaml, mime-types / devDependencies: typescript, vitest, fast-check, @types/node, @types/turndown, @types/mime-types, @types/js-yaml）を作成する
  - `tsconfig.json`（`module: NodeNext`, `target: ES2022`, `strict: true`）を作成する
  - `vitest.config.ts`（`tests/**/*.test.ts` を include、v8 カバレッジ、閾値 80%）を作成する
  - `src/` および `tests/unit/`, `tests/property/`, `tests/integration/` ディレクトリ構造を作成する
  - _Requirements: 5.1_

- [x] 2. 共通型定義の実装
  - [x] 2.1 `src/types.ts` に `Result<T, E>`・`ParseResult`・`ParseError`・`PrintResult`・`RouteKind`・`ServerConfig`・`RawConfig`・`SseClient`・`WatcherCallbacks`・`HtmlCache` を定義する
    - _Requirements: 2.1, 2.3, 5.2, 5.5, 5.6_

- [x] 3. Config_Loader の実装
  - [x] 3.1 `src/config.ts` に `parseConfig(raw, cwd)`・`loadConfigFile(cwd)`・`generateStartupMessage(config)` を実装する
    - `parseConfig` は `watchDirectory` と `port` の未指定時にデフォルト値（port: 3000, watchDirectory: cwd）を適用する
    - ポート範囲（1〜65535 の整数）と watchDirectory の存在チェックを行い、不正値は `Result.error` を返す
    - `loadConfigFile` は `mdserver.config.json` → `mdserver.config.yaml` の順に探索する
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_
  - [x]* 3.2 `tests/property/config.property.test.ts` に Property 9・Property 10 のプロパティテストを書く
    - **Property 9: 設定のデフォルト値フォールバック**
    - **Validates: Requirements 5.2, 5.5, 5.6**
    - **Property 10: 不正な設定値はエラーを返す**
    - **Validates: Requirements 5.7, 5.8, 5.9**
  - [x]* 3.3 `tests/unit/config.test.ts` にユニットテストを書く
    - ポート境界値（1, 65535, 65536, 0）、JSON/YAML 両形式の読み込み、設定ファイル不在時のデフォルト値を検証する
    - _Requirements: 5.1–5.9_

- [x] 4. Parser の実装
  - [x] 4.1 `src/parser.ts` に `parseMarkdown(input)`・`wrapHtml(bodyHtml, title)` を実装する
    - `marked` v12 と GFM オプションを使用して Markdown → HTML 変換を行う
    - null およびバイナリ入力を検出して `ParseError`（`null_input` / `binary_input`）を返す
    - `wrapHtml` はスタイルシートリンクとライブリロードスクリプト（`/events` SSE 接続コード）を埋め込む
    - _Requirements: 1.1, 1.5, 2.1, 2.2, 2.3_
  - [x]* 4.2 `tests/property/parser.property.test.ts` に Property 4・Property 5 のプロパティテストを書く
    - **Property 4: GFM 構文の HTML 変換**
    - **Validates: Requirements 2.1**
    - **Property 5: ラウンドトリップ安定性（Markdown → HTML → Markdown → HTML）**
    - **Validates: Requirements 2.4, 2.5**
  - [x]* 4.3 `tests/unit/parser.test.ts` にユニットテストを書く
    - GFM 各構文要素（見出し・リスト・コードブロック・テーブル・打消し線）の変換結果を検証する
    - 空入力・null・バイナリ入力のエラーハンドリングを検証する
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 5. Pretty_Printer の実装
  - [x] 5.1 `src/pretty-printer.ts` に `prettyPrint(html)` を実装する
    - `turndown` v7 と GFM テーブルプラグインを使用して HTML → Markdown 変換を行う
    - エラー時は `Result.error` を返す
    - _Requirements: 2.4, 2.5_
  - [x]* 5.2 `tests/unit/pretty-printer.test.ts` にユニットテストを書く
    - テーブル・コードブロック・見出しの往復変換を検証する
    - _Requirements: 2.4_

- [x] 6. Router の実装
  - [x] 6.1 `src/router.ts` に `resolveRoute(requestUrl, watchDirectory)`・`generateIndexPage(files, watchDirectory)`・`generateErrorPage(statusCode, message)` を実装する
    - URL パスを `/events`（SSE）・`/`（index）・`.md`（markdown）・その他（static / not_found）に分類する
    - パストラバーサル（`../` 等）を検出して `not_found` を返す
    - `generateIndexPage` はファイルリストがゼロ件の場合もメッセージを含む有効 HTML を返す
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.3, 6.3_
  - [x]* 6.2 `tests/property/router.property.test.ts` に Property 1・Property 2・Property 3 のプロパティテストを書く
    - **Property 1: Markdown レスポンスの HTTP 属性**
    - **Validates: Requirements 1.1**
    - **Property 2: 存在しないリソースは常に 404**
    - **Validates: Requirements 1.2, 6.3**
    - **Property 3: インデックスページに全ファイルリンクが含まれる**
    - **Validates: Requirements 1.3**
  - [x]* 6.3 `tests/unit/router.test.ts` にユニットテストを書く
    - 各ルート分類・パストラバーサルブロック・空ファイルリストのインデックスページを検証する
    - _Requirements: 1.1–1.5, 6.3_

- [x] 7. チェックポイント — 純粋関数コンポーネントの確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. SSE Manager の実装
  - [x] 8.1 `src/sse.ts` に `SseManager` クラス（`addClient`・`removeClient`・`broadcast`・`startHeartbeat`・`getClientCount`）を実装する
    - `broadcast` は切断済みクライアントへの送信をスキップし、エラー時はクライアントリストから削除する
    - `startHeartbeat` は 60 秒 ±5 秒ごとにコメント行（`: heartbeat\n\n`）を送信する
    - _Requirements: 4.3, 4.4, 4.5_
  - [x]* 8.2 `tests/property/sse.property.test.ts` に Property 8 のプロパティテストを書く
    - **Property 8: 切断クライアントへの通知スキップ**
    - **Validates: Requirements 4.5**
  - [x]* 8.3 `tests/unit/sse.test.ts` にユニットテストを書く
    - クライアントの追加・削除・broadcast・切断時の動作を検証する
    - _Requirements: 4.3, 4.4, 4.5_

- [x] 9. Content-Type ユーティリティの実装と HTTP キャッシュ
  - [x] 9.1 `src/types.ts` に `getContentType(filePath)` を追加し、`mime-types` を使用して拡張子→MIMEタイプを解決する（未知拡張子は `application/octet-stream`）
    - _Requirements: 6.2_
  - [x]* 9.2 `tests/property/content-type.property.test.ts` に Property 11・Property 12 のプロパティテストを書く
    - **Property 11: Content-Type の正確なマッピング**
    - **Validates: Requirements 6.2**
    - **Property 12: 静的ファイルのバイト列保全性**
    - **Validates: Requirements 6.1**

- [x] 10. File_Watcher の実装
  - [x] 10.1 `src/watcher.ts` に `createDebouncedHandler(fn, delayMs)`・`startWatcher(directory, callbacks)` を実装する
    - `chokidar` v4 で Watch_Directory（サブディレクトリ含む）を監視する
    - `change`/`add` イベントには 300ms デバウンスを適用し、`unlink` イベントはキャッシュから即座に削除する
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [x]* 10.2 `tests/property/watcher.property.test.ts` に Property 6・Property 7 のプロパティテストを書く
    - **Property 6: デバウンス後は変換処理が 1 回だけ起動される**
    - **Validates: Requirements 3.5**
    - **Property 7: エラー時のキャッシュ不変性**
    - **Validates: Requirements 3.6**

- [x] 11. HTTP サーバーの実装
  - [x] 11.1 `src/server.ts` に `createRequestHandler(config, cache, sseManager)` を実装する
    - `node:http` を使用して HTTP リクエストを受け取り、`resolveRoute` でルーティングする
    - `.md` リクエスト: キャッシュ確認 → ミス時は `parseMarkdown` + `wrapHtml` → キャッシュ保存 → `text/html; charset=utf-8` でレスポンス
    - 静的ファイル: `fs.readFile` でバイト列を読み込み、`getContentType` で Content-Type を付与して返す
    - 変換エラーは HTTP 500 で返し、キャッシュを変更しない
    - `/events` エンドポイントで SSE ヘッダー（`text/event-stream`, `Cache-Control: no-cache`）を送信してクライアントを `SseManager` に登録する
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.3, 6.1, 6.2, 6.3_
  - [x] 11.2 `src/server.ts` に `startHttpServer(config)` を実装する
    - `HtmlCache`・`SseManager` を初期化して `createRequestHandler` を組み立てる
    - `File_Watcher` の `onChange`/`onAdd` コールバックでキャッシュ更新 → `sseManager.broadcast("reload")` を呼ぶ
    - `onUnlink` コールバックでキャッシュエントリを削除する
    - `EADDRINUSE` エラーを捕捉してコンソール出力後にプロセスを終了する
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 4.1, 4.2, 5.10, 5.11_

- [x] 12. エントリポイントの実装
  - [x] 12.1 `src/index.ts` に `main()` を実装する
    - `loadConfigFile` → `parseConfig` → エラー時はコンソール出力してプロセス終了
    - 正常時は `generateStartupMessage` をコンソール出力して `startHttpServer` を呼び出す
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

- [x] 13. チェックポイント — 全コンポーネント統合後の確認
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. 統合テスト
  - [x]* 14.1 `tests/integration/file-watcher.test.ts` に File_Watcher の統合テストを書く
    - 実際のファイル書き込み・削除でコールバックが呼ばれることを確認する
    - ファイル変更から 1 秒以内にキャッシュが更新されることを確認する
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x]* 14.2 `tests/integration/server.test.ts` に HTTP サーバーの統合テストを書く
    - SSE クライアントがファイル変更後 1 秒以内に `reload` イベントを受信することを確認する
    - 同一ポートへの 2 度目のバインドがエラーで終了することを確認する
    - _Requirements: 4.1, 4.2, 5.10_

- [x] 15. 最終チェックポイント — 全テストパスの確認
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- タスクに `*` が付いている sub-task は任意（MVP では省略可）
- 各タスクは Requirements の粒度まで追跡可能にしています
- Property テストは `// Feature: md-to-html-server, Property N: <text>` タグを先頭に記述してください
- 純粋関数（config・parser・router）を先に実装することで統合前にテストが可能です
- `Result<T, E>` を一貫して使用し、例外は I/O 境界でのみキャッチしてください

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.2", "4.3", "5.2", "6.2", "6.3", "8.1", "9.1"] },
    { "id": 3, "tasks": ["8.2", "8.3", "9.2", "10.1"] },
    { "id": 4, "tasks": ["10.2", "11.1"] },
    { "id": 5, "tasks": ["11.2"] },
    { "id": 6, "tasks": ["12.1"] },
    { "id": 7, "tasks": ["14.1", "14.2"] }
  ]
}
```
