import { readFileSync, writeFileSync } from 'node:fs';

const gluePath = 'pkg/typst_wasm.js';
const glue = readFileSync(gluePath, 'utf8');

const patched = glue.replace(
  /if \(module_or_path === undefined\) \{\s*module_or_path = new URL\((['"])typst_wasm_bg\.wasm\1, import\.meta\.url\);\s*\}/,
  "if (module_or_path === undefined) {\n        throw new Error('typst wasm module must be supplied by the caller');\n    }",
);

if (patched === glue) {
  throw new Error(`${gluePath}: could not find the default wasm URL`);
}

writeFileSync(gluePath, patched);
