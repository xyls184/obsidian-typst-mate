# Fork changes

This fork upgrades the embedded Typst engine and fixes two rendering cases.

## Typst 0.15.1

- `wasm/Cargo.toml` and the `typst` submodule now use Typst `0.15.1` (was `0.14.2`).
- The wasm bindings were migrated to the 0.15 APIs:
  - `PagedDocument` comes from `typst-layout`.
  - `FileId::new` takes a `RootedPath`; Windows backslashes are normalized in
    the virtual base path.
  - `VirtualPath::new` returns `Result`.
  - `World::today` receives a `Duration`.
  - `typst-svg`, `typst-render`, and `typst-pdf` options are passed explicitly.
  - `jump_from_click` takes a `PagedPosition`.
- Rebuild the wasm after changing Rust code:

  ```sh
  cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release --lib
  wasm-bindgen --target web --out-dir pkg --out-name typst_wasm \
    wasm/target/wasm32-unknown-unknown/release/typst_wasm.wasm
  bun scripts/patch-wasm-glue.ts
  cp pkg/typst_wasm_bg.wasm typst.wasm
  bun run build
  ```

  `scripts/patch-wasm-glue.ts` removes the generated default wasm URL. Without
  it, Vite's inline worker embeds the 45 MB wasm as base64 and produces a
  60 MB `main.js`. The worker always passes a precompiled module, so the
  default URL is never used.

## CJK fallback in math

`TypstManager.prepareCjkFont()` looks for a CJK-capable family among the fonts
already loaded from the plugin's `fonts/` directory. If none exists, it loads
one from the host font directory on desktop:

- Windows: `NotoSerifSC-VF.ttf`, `NotoSansSC-VF.ttf`, `msyh.ttc`, `simsun.ttc`,
  `simhei.ttf`, `Deng.ttf`
- macOS: `PingFang.ttc`, `STHeiti Light.ttc`, `Songti.ttc`, `Arial Unicode.ttf`
- Linux: common Noto CJK and WenQuanYi paths

The detected family is injected as:

```typst
#show math.text: set text(font: ("New Computer Modern", "<family>"))
```

The rule targets `math.text` rather than `math.equation`; setting the text font
on the whole equation would make stretchy delimiters such as the `cases` brace
fall back to a non-stretchy text-font glyph.

On mobile, place a CJK font in `.obsidian/plugins/typst-mate/fonts/`.

## Inline math with trailing whitespace

Obsidian's Markdown parser only recognizes `$...$` when the closing `$` is
directly preceded by a non-whitespace character. `$f(x) := cases(...) $`
therefore stays raw text. The new `RelaxedInlineMath` editor extension and a
reading-view postprocessor render those spans with Typst.

- Live preview replaces the span with a Typst widget; clicking it restores the
  source for editing.
- Reading view replaces matching text nodes.
- Native Obsidian math, code blocks, and inline code are excluded.
- `\$` is treated as an escaped dollar; no other heuristics are applied.
- Limitation: a leading-space-only form like `$ x$` is still left to Obsidian
  in reading view; the reported trailing-space form is covered.
