# Fork changes

This fork upgrades the embedded Typst engine and fixes several rendering
issues around CJK text, inline math baselines, and full-height formulas.

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

## Inline baseline

Typst 0.15 removed the `class` attribute from the root `<svg>` element. The
wasm renderer used to inject the computed baseline as
`<svg class="..." style="vertical-align: ...">`, so after the upgrade the
descent was silently lost. The injection now matches `<svg` directly.

`inline-middle` also used to override the SVG's baseline with CSS
`vertical-align: middle`, which depends on the surrounding font metrics. It now
keeps the container on the baseline and uses the Typst-computed descent, so
the formula baseline lines up with the text baseline. The existing `offset`
setting still applies.

## Full-height inline math

A new Renderer setting, **Full-height inline math**, renders plain inline
formulas in Typst display style while keeping them in the inline flow:

```typst
#set page(margin: (x: 0pt, y: 0.3125em))
#box($ {CODE} $)
```

This makes `cases`, fractions, sums, and other large operators keep their
display size instead of the compressed inline size. The setting applies to the
default plain `${CODE}$` inline processor; custom processors are unchanged.

## SVG render cache

Every formula used to be compiled from scratch. CodeMirror destroys widgets
outside the viewport and recreates them when they scroll back, so the same
formula was recompiled on every pass. `TypstManager.svg()` now caches results
by `kind + ndir + formatted source`, shares in-flight requests, and keeps up to
512 SVGs in LRU order. The cache is cleared whenever the Typst world changes
(fonts, packages, tag files, offset) or the source is reformatted.

The CJK `math.text` rule is only injected when the formula source contains
CJK characters (Han, kana, Hangul, CJK punctuation, or fullwidth forms);
formulas without them use Typst's default text font and compile faster.

The cache is deliberately in-memory only. A persistent SVG cache would need a
hash of every input (Typst version, fonts, CJK fallback, preamble, frontmatter
imports, tag files, offset, processors); missing one input silently serves
stale formulas. With ~8–15 KB per formula it would also grow into hundreds of
MB, and reading it may not beat a 4–6 ms compile.

## Live reload, refresh all, and startup pre-render

- **Live Reload** (default on): `vault.on('modify')` refreshes reading views of
  the changed note after a 400 ms debounce. Live Preview is not rebuilt; its
  own widget re-renders only the edited formula, and the cache key change means
  only that formula compiles again.
- **Refresh All Formulas**: a Renderer-tab button and a `refresh-all-formulas`
  command. It clears the SVG cache and rebuilds every open Markdown view.
  Global settings are not auto-refreshed, to avoid background work.
- **Pre-render Active Note on Startup** (default off): after the plugin is
  ready, `EditorHelper.precompileActiveNote()` walks the active note's math
  regions and compiles them one at a time into the cache. It awaits each
  compile, so interactive renders queued in between run first.

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
