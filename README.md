# Typst Mate (fork)

> **注意**
>
> 本项目包含使用 DeepSeek-Flash 进行 AI 辅助编码（vibe coding）的改动。AI 生成内容可能不准确，请自行审查后再使用。

这是 [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate) 的个人 fork，仅包含以下改动。

## 1. 内置 Typst 升级到 0.15.1

- `wasm/Cargo.toml` 与 `typst` 子模块从 0.14.2 升级到 0.15.1。
- 迁移 wasm 绑定到 0.15 API：`PagedDocument`、`RootedPath`、`DiagSpan`、`RenderOptions`、`PagedPosition` 等。
- Windows 的 vault 路径会规范化为正斜杠，再传给 Typst 的虚拟文件系统。
- 重新生成 wasm JS glue，并加入 `scripts/patch-wasm-glue.ts`：避免 Vite 的 inline worker 把约 46 MB 的 wasm 以 base64 塞进 `main.js`。当前构建产物约为 643 KB 的 `main.js` + 独立的 `typst-2.4.0.wasm`。

## 2. 公式内中文的 CJK fallback

Typst 内置字体不包含 CJK 字形，`$"中文" + 1 = 8$` 这类公式会显示成方框。当前实现：

- 优先使用插件 `fonts/` 目录中已加载的 CJK 字体。
- 如果没有，则在桌面端从系统字体目录加载一个 CJK 字体（Windows: `NotoSerifSC-VF.ttf`、`msyh.ttc`、`simsun.ttc` 等；macOS: `PingFang.ttc` 等；Linux: 常见 Noto CJK / 文泉驿路径）。
- 通过新增的 wasm 导出 `find_cjk_family` 检测字体族，并注入：

```typst
#show math.text: set text(font: ("New Computer Modern", "<family>"))
```

这里必须用 `math.text` 而不是 `math.equation`。对整条公式设置文本字体会让 `cases` 的可拉伸 `{` 回退到普通文本字体的非拉伸字形，导致 brace 只有一行高；`math.text` 只影响公式中的文字，不影响数学符号和定界符。

移动端没有系统字体访问权限，需要把 CJK 字体放进 `.obsidian/plugins/typst-mate/fonts/`。

## 3. 行内 `$ ... $` 宽松解析

Obsidian 只把闭合 `$` 前没有空格的单行 `$...$` 识别为行内公式，因此 `$f(x) := cases(...) $` 会保持原始文本。当前实现：

- 在 Live Preview 中匹配“闭合 `$` 前有空格”的单行 span，用 Typst SVG 替换；点击可恢复源码编辑。
- 在 Reading View 中通过 Markdown postprocessor 处理同样的 span。
- `\$` 按转义美元符号处理；没有其他启发式规则。
- 只支持单行。跨行的 `$...$` 仍然不会被识别，请改用 `$$...$$` 显示公式。

## 4. 行内基线修复与全高公式

- 修复 Typst 0.15 下根 `<svg>` 不再带 `class` 导致 baseline/descent 没有注入的问题。
- `middle` 样式现在使用 Typst 计算出的基线，不再用 CSS `vertical-align: middle` 覆盖。
- 新增 Renderer 设置 **Full-height inline math**：用 `#box($ {CODE} $)` 让行内分式、`cases`、求和等保持 display 尺寸，同时仍留在文字行内。

## 5. 渲染缓存

Typst 每次编译公式都会重新排版。滚动时 CodeMirror 会销毁并重建视口外的公式 widget，导致同一公式被反复编译，这是滚动卡顿的主要来源。现在 `TypstManager` 会缓存已经生成的 SVG：

- 缓存键为 `kind + ndir + 完整格式化源码`（包含 preamble、CJK 设置和 frontmatter imports）。
- 相同公式的并发请求会合并为一个编译任务。
- 缓存最多保留 512 条，按使用顺序淘汰。
- 字体、包、tag 文件、offset 等 Typst world 状态变化时清空缓存；preamble 或 processor 变化会改变缓存键。

### 为什么不在磁盘上长期保存 SVG

SVG 依赖 Typst 版本、内置/系统字体、CJK fallback、preamble、frontmatter imports、tag 文件、offset 和 processor 设置。任何一项变化都会让旧 SVG 静默过期，而完整依赖哈希很容易漏项。单个公式的 SVG 约 8–15 KB，大量公式会占用数百 MB；从磁盘读取和解析这些文件也未必比在 worker 中重新编译（约 4–6 ms/条）更快。因此当前策略是：**每个会话按需编译 + 内存 LRU 缓存**，而不是持久化到磁盘。

## 6. 实时重载、手动刷新与启动预热

- **Live Reload**（默认开启）：笔记文件保存后，只刷新该笔记的**阅读视图/分屏预览**。Live Preview 本身只会重建被编辑的那个公式；缓存键变化后也只重新编译这一条，其他公式直接命中缓存。
- **Refresh All Formulas**：Renderer 设置中的按钮，或命令面板中的 `Refresh all formulas`。清空 SVG 缓存并重建所有打开的 Markdown 视图。修改 preamble、processor、offset 等全局设置后手动执行；不会自动刷新，避免额外功耗。
- **Pre-render Active Note on Startup**（默认关闭）：启动后在后台把当前笔记里的行内/显示公式逐条编译进缓存。使用现有单 worker 顺序编译，不增加内存；交互式渲染会插队，因此不会因为预热而卡住滚动。

## 为什么要保留在 fork，而不是直接给上游提 PR

- 上述改动实际包含三个独立部分：Typst 升级、CJK fallback、行内公式行为（宽松解析/基线/全高）。
- 上游 `CONTRIBUTING.md` 要求在提 PR 前先开 issue。
- 上游存在 `3.0.0` 分支，已经改用 git 版 typst 和不同架构；0.15.1 升级应该先确认目标分支。
- CJK 自动加载系统字体、宽松行内公式都涉及行为变更，需要原作者先确认是否愿意维护。
- `manifest.json` / `versions.json` 的版本号和本 README 属于 fork 发布/说明内容，不适合混进功能 PR。
- 因此当前只推送到个人 fork，不向上游提交 PR。

## 构建与验证

- `cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release --lib`
- `wasm-bindgen --target web --out-dir pkg --out-name typst_wasm wasm/target/wasm32-unknown-unknown/release/typst_wasm.wasm`
- `bun scripts/patch-wasm-glue.ts`
- `cp pkg/typst_wasm_bg.wasm typst.wasm && bun run build`
- `bun test`：78 pass / 0 fail
- `tsc --noEmit`：通过
- 已在 Obsidian 1.14.4（Windows）实测 live preview、reading view、PDF/SVG/PNG 导出、代码块处理器和 jump。
