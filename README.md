# Typst Mate (fork)

> **注意**
>
> 本项目包含使用 AI 辅助编码（vibe coding）的改动。AI 生成内容可能不准确，请自行审查后再使用。
>
> **新克隆构建提示**：请使用 `git clone --recurse-submodules`。仓库不提交 `pkg/` 与 `typst.wasm`，首次构建须先重建 WASM，再执行 `bun install && bun run build`；仅修改 TypeScript 时可直接 `bun run build`。完整工具链与构建步骤见 [docs/fork-changes.md](docs/fork-changes.md)。

这是 [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate) 的个人维护 fork（基于上游行为与发布节奏差异独立维护，暂不向上游提交 PR），主要改动如下：

## 主要改动

1. **内置 Typst 升级至 0.15.1**
   - 升级 `wasm/Cargo.toml` 与 `typst` 子模块并迁移至 0.15 API，Windows 下路径自动规范化为正斜杠。
   - 通过 `scripts/patch-wasm-glue.ts` 分离 `main.js` 与独立的 `typst-<version>.wasm`，避免 worker 内联膨胀。

2. **公式内中文 CJK Fallback**
   - 优先使用插件 `fonts/` 目录中的 CJK 字体，桌面端自动回退系统常见 CJK 字体，并通过 `#show math.text` 注入回退字体族（不影响 `cases` 等数学定界符伸缩）；移动端需自行将字体放入插件 `fonts/` 目录。

3. **行内公式增强**
   - 支持闭合 `$` 前带空格的单行 `$ ... $` 宽松解析（同时覆盖 Live Preview 与 Reading View）。
   - 修复 Typst 0.15 行内基线对齐，并新增 **Full-height inline math** 设置（以 `#box($ {CODE} $)` 保持行内公式的 display 尺寸）。

4. **渲染缓存与刷新控制**
   - `TypstManager` 内置 512 条内存 LRU SVG 缓存与并发编译去重，world 状态变化时自动失效。
   - 支持 **Live Reload**（仅刷新阅读视图）、**Refresh all formulas**（手动全量重编译）以及可选的启动后台预渲染。

5. **简体中文界面（i18n）**
   - 提供完整的 `resources/locales/zh.json` 简体中文语言包，自动匹配 Obsidian / 系统语言。

6. **LaTeX 公式转 Typst**
   - **自动粘贴转换 & 一键转换**：支持粘贴时自动转换（可开关），以及侧栏按钮/命令针对选区、当前公式或全笔记进行原地局部替换（保持光标与滚动条位置，支持 `\[...\]`、`\(...\)`、环境块与表格）。
   - **输出规范化与幂等保护**：内置 `tylax` 升级至 0.3.7，自动将直立文本转为引号字符串、`\boxed` 转为 `boxed(...)`、合并拆散的多位数/小数、剥离环境外层 `$` / `#math.equation(...)[$ ... $]` 包装；识别时准确跳过 Typst 字符串、注释、`\ ` 换行与转义标点，避免已转换或手动编辑的 Typst 公式被重复拆分。

## 构建与部署

```sh
bun install
bun run build   # 产出 dist/main.js、dist/styles.css、dist/manifest.json、dist/typst-<version>.wasm
bun test
```

- 首次克隆或改动 `wasm/` 后，需先按 [docs/fork-changes.md](docs/fork-changes.md) 重建 `pkg/` 并复制 `typst.wasm`。
- 将 `dist/` 下的四个产物复制到 `<vault>/.obsidian/plugins/typst-mate/` 并在 Obsidian 中重载插件即可使用。
