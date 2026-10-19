# Typst Mate (fork)

本 README 提供中文、English、日本語三个版本。  
This README is available in Chinese, English, and Japanese.  
本 README は中国語・英語・日本語の三か国語で提供されています。

> **注意 / Notice / 注意**  
> 本项目包含使用 DeepSeek-Flash 进行 AI 辅助编码（vibe coding）的改动。AI 生成内容可能不准确，请自行审查后再使用。  
> This project contains changes made with DeepSeek-Flash AI assistance (vibe coding). Review them before use.  
> 本プロジェクトには DeepSeek-Flash による AI 支援（vibe coding）で作成された変更が含まれます。使用前にご自身で確認してください。

---

## 中文

这是 [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate) 的个人 fork，仅包含以下改动。

### 1. 内置 Typst 升级到 0.15.1

- `wasm/Cargo.toml` 与 `typst` 子模块从 0.14.2 升级到 0.15.1。
- 迁移 wasm 绑定到 0.15 API：`PagedDocument`、`RootedPath`、`DiagSpan`、`RenderOptions`、`PagedPosition` 等。
- Windows 的 vault 路径会规范化为正斜杠，再传给 Typst 的虚拟文件系统。
- 重新生成 wasm JS glue，并加入 `scripts/patch-wasm-glue.ts`：避免 Vite 的 inline worker 把约 46 MB 的 wasm 以 base64 塞进 `main.js`。当前构建产物约为 643 KB 的 `main.js` + 独立的 `typst-2.4.0.wasm`。

### 2. 公式内中文的 CJK fallback

Typst 内置字体不包含 CJK 字形，`$"中文" + 1 = 8$` 这类公式会显示成方框。当前实现：

- 优先使用插件 `fonts/` 目录中已加载的 CJK 字体。
- 如果没有，则在桌面端从系统字体目录加载一个 CJK 字体（Windows: `NotoSerifSC-VF.ttf`、`msyh.ttc`、`simsun.ttc` 等；macOS: `PingFang.ttc` 等；Linux: 常见 Noto CJK / 文泉驿路径）。
- 通过新增的 wasm 导出 `find_cjk_family` 检测字体族，并注入：

```typst
#show math.text: set text(font: ("New Computer Modern", "<family>"))
```

这里必须用 `math.text` 而不是 `math.equation`。对整条公式设置文本字体会让 `cases` 的可拉伸 `{` 回退到普通文本字体的非拉伸字形，导致 brace 只有一行高；`math.text` 只影响公式中的文字，不影响数学符号和定界符。

移动端没有系统字体访问权限，需要把 CJK 字体放进 `.obsidian/plugins/typst-mate/fonts/`。

### 3. 行内 `$ ... $` 宽松解析

Obsidian 只把闭合 `$` 前没有空格的单行 `$...$` 识别为行内公式，因此 `$f(x) := cases(...) $` 会保持原始文本。当前实现：

- 在 Live Preview 中匹配“闭合 `$` 前有空格”的单行 span，用 Typst SVG 替换；点击可恢复源码编辑。
- 在 Reading View 中通过 Markdown postprocessor 处理同样的 span。
- `\$` 按转义美元符号处理；没有其他启发式规则。
- 只支持单行。跨行的 `$...$` 仍然不会被识别，请改用 `$$...$$` 显示公式。

### 为什么要保留在 fork，而不是直接给上游提 PR

- 上述改动实际包含三个独立部分：Typst 升级、CJK fallback、宽松行内公式。
- 上游 `CONTRIBUTING.md` 要求在提 PR 前先开 issue。
- 上游存在 `3.0.0` 分支，已经改用 git 版 typst 和不同架构；0.15.1 升级应该先确认目标分支。
- CJK 自动加载系统字体、宽松行内公式都涉及行为变更，需要原作者先确认是否愿意维护。
- `manifest.json` / `versions.json` 的版本号和本 README 属于 fork 发布/说明内容，不适合混进功能 PR。
- 因此当前只推送到个人 fork，不向上游提交 PR。

### 构建与验证

- `cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release --lib`
- `wasm-bindgen --target web --out-dir pkg --out-name typst_wasm wasm/target/wasm32-unknown-unknown/release/typst_wasm.wasm`
- `bun scripts/patch-wasm-glue.ts`
- `cp pkg/typst_wasm_bg.wasm typst.wasm && bun run build`
- `bun test`：78 pass / 0 fail
- `tsc --noEmit`：通过
- 已在 Obsidian 1.14.4（Windows）实测 live preview、reading view、PDF/SVG/PNG 导出、代码块处理器和 jump。

---

## English

This is a personal fork of [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate). It contains only the following changes.

### 1. Bundled Typst upgraded to 0.15.1

- `wasm/Cargo.toml` and the `typst` submodule were bumped from 0.14.2 to 0.15.1.
- The wasm bindings were migrated to the 0.15 APIs (`PagedDocument`, `RootedPath`, `DiagSpan`, `RenderOptions`, `PagedPosition`, etc.).
- Windows vault paths are normalized to forward slashes before being passed to Typst's virtual filesystem.
- The wasm JS glue is regenerated, and `scripts/patch-wasm-glue.ts` prevents Vite's inline worker from embedding the ~46 MB wasm as base64 in `main.js`. The build now produces a ~643 KB `main.js` plus a separate `typst-2.4.0.wasm`.

### 2. CJK fallback for text inside math

Typst's bundled fonts do not contain CJK glyphs, so `$"中文" + 1 = 8$` renders as tofu boxes. The current implementation:

- First uses a CJK font already loaded from the plugin's `fonts/` directory.
- Otherwise, on desktop, loads one from the host font directory (Windows: `NotoSerifSC-VF.ttf`, `msyh.ttc`, `simsun.ttc`, etc.; macOS: `PingFang.ttc`, etc.; Linux: common Noto CJK / WenQuanYi paths).
- Detects the family through the new wasm export `find_cjk_family` and injects:

```typst
#show math.text: set text(font: ("New Computer Modern", "<family>"))
```

`math.text` is required instead of `math.equation`. Setting the text font on the whole equation makes stretchy delimiters such as the `cases` brace fall back to a non-stretchy text-font glyph, leaving the brace only one line tall. `math.text` only affects text runs inside math, not symbols or delimiters.

Mobile has no system-font access; place a CJK font in `.obsidian/plugins/typst-mate/fonts/`.

### 3. Relaxed inline `$ ... $` parsing

Obsidian only recognizes single-line `$...$` as inline math when the closing `$` is directly preceded by a non-whitespace character. Therefore `$f(x) := cases(...) $` stays raw text. The current implementation:

- In Live Preview, matches single-line spans whose closing `$` is preceded by whitespace and replaces them with a Typst SVG widget; clicking restores the source for editing.
- In Reading View, handles the same spans through a Markdown postprocessor.
- Treats `\$` as an escaped dollar; no other heuristics are applied.
- Supports single-line spans only. Multi-line `$...$` is still not recognized; use `$$...$$` for display math.

### Why this stays in the fork instead of an upstream PR

- The work contains three independent parts: the Typst upgrade, the CJK fallback, and relaxed inline math.
- Upstream `CONTRIBUTING.md` requires an issue before a pull request.
- Upstream has a `3.0.0` branch that already uses a git version of Typst and a different architecture; the target branch for a 0.15.1 upgrade should be confirmed first.
- Automatically loading system fonts and relaxed inline math are behavior changes that need maintainer approval.
- `manifest.json` / `versions.json` release metadata and this fork-specific README should not be mixed into feature PRs.
- For these reasons, the changes are only pushed to the personal fork; no upstream PR has been opened.

### Build and verification

- `cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release --lib`
- `wasm-bindgen --target web --out-dir pkg --out-name typst_wasm wasm/target/wasm32-unknown-unknown/release/typst_wasm.wasm`
- `bun scripts/patch-wasm-glue.ts`
- `cp pkg/typst_wasm_bg.wasm typst.wasm && bun run build`
- `bun test`: 78 pass / 0 fail
- `tsc --noEmit`: clean
- Verified in Obsidian 1.14.4 on Windows: live preview, reading view, PDF/SVG/PNG export, code block processors, and jump.

---

## 日本語

> ※ この日本語訳は AI による翻訳です。正確な内容は英語版または中国語版を参照してください。

これは [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate) の個人フォークです。変更内容は以下のとおりです。

### 1. 内蔵 Typst を 0.15.1 に更新

- `wasm/Cargo.toml` と `typst` サブモジュールを 0.14.2 から 0.15.1 に更新しました。
- wasm バインディングを 0.15 の API（`PagedDocument`、`RootedPath`、`DiagSpan`、`RenderOptions`、`PagedPosition` など）に移行しました。
- Windows の vault パスを Typst の仮想ファイルシステムに渡す前に正規化（スラッシュ区切り）しています。
- wasm の JS glue を再生成し、`scripts/patch-wasm-glue.ts` を追加しました。Vite の inline worker が約 46 MB の wasm を base64 で `main.js` に埋め込むのを防ぎます。現在のビルドは約 643 KB の `main.js` と独立した `typst-2.4.0.wasm` になります。

### 2. 数式内テキストの CJK フォールバック

Typst の同梱フォントには CJK 字形が含まれていないため、`$"中文" + 1 = 8$` は豆腐（□）になります。現在の実装：

- プラグインの `fonts/` に読み込まれている CJK フォントを優先して使用します。
- なければデスクトップ環境で OS のフォントディレクトリから CJK フォントを読み込みます（Windows: `NotoSerifSC-VF.ttf`、`msyh.ttc`、`simsun.ttc` など。macOS: `PingFang.ttc` など。Linux: 一般的な Noto CJK / WenQuanYi のパス）。
- 新しい wasm エクスポート `find_cjk_family` でフォントファミリーを検出し、次を注入します：

```typst
#show math.text: set text(font: ("New Computer Modern", "<family>"))
```

ここでは `math.equation` ではなく `math.text` を使う必要があります。数式全体にテキストフォントを設定すると、`cases` の伸縮する `{` が通常テキストフォントの非伸縮字形にフォールバックし、波括弧が一行分の高さになってしまいます。`math.text` は数式内のテキストだけに作用し、記号や区切り文字には影響しません。

モバイルではシステムフォントにアクセスできないため、CJK フォントを `.obsidian/plugins/typst-mate/fonts/` に配置してください。

### 3. インライン `$ ... $` の緩和解析

Obsidian は、閉じる `$` の直前が空白でない単一行の `$...$` のみをインライン数式として認識します。そのため `$f(x) := cases(...) $` は生テキストのままになります。現在の実装：

- Live Preview では、閉じる `$` の前に空白がある単一行の span を検出し、Typst SVG ウィジェットに置き換えます。クリックすると編集用のソースに戻ります。
- Reading View では Markdown postprocessor で同じ span を処理します。
- `\$` はエスケープされたドル記号として扱います。その他のヒューリスティックはありません。
- 単一行のみ対応します。複数行の `$...$` は依然として認識されないため、表示数式には `$$...$$` を使用してください。

### アップストリームに PR を出さない理由

- 変更は「Typst の更新」「CJK フォールバック」「緩和されたインライン数式」の 3 つの独立した内容に分かれます。
- アップストリームの `CONTRIBUTING.md` は、PR の前に issue を作成することを求めています。
- アップストリームには `3.0.0` ブランチがあり、すでに git 版の Typst と異なるアーキテクチャを採用しています。0.15.1 への更新は、まず対象ブランチを確認する必要があります。
- システムフォントの自動読み込みと緩和されたインライン数式は挙動の変更であり、メンテナーの承認が必要です。
- `manifest.json` / `versions.json` のリリース情報やこのフォーク専用 README は、機能 PR に混ぜるべきではありません。
- 以上の理由から、現時点では個人フォークへの push のみで、アップストリーム PR は作成していません。

### ビルドと検証

- `cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release --lib`
- `wasm-bindgen --target web --out-dir pkg --out-name typst_wasm wasm/target/wasm32-unknown-unknown/release/typst_wasm.wasm`
- `bun scripts/patch-wasm-glue.ts`
- `cp pkg/typst_wasm_bg.wasm typst.wasm && bun run build`
- `bun test`: 78 pass / 0 fail
- `tsc --noEmit`: 成功
- Obsidian 1.14.4（Windows）で Live Preview、Reading View、PDF/SVG/PNG エクスポート、コードブロックプロセッサー、jump を確認済みです。
