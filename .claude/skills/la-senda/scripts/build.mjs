#!/usr/bin/env node
// Uso: node build.mjs <review.json> [--repo <raíz del repositorio>] [--out <review.html>]
// Valida review.json (con --repo, también que las evidencias coinciden con el archivo) y genera un único review.html.
// Código de salida: 0 correcto · 1 review.json no válido · 2 uso o lectura incorrectos.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { validateReview } from './lib/validate-review.mjs';
import { buildHtml } from './lib/build-html.mjs';
import { verifyEvidence } from './lib/evidence.mjs';

function usage(message) {
  console.error(message);
  console.error('Uso: node build.mjs <review.json> [--out <review.html>]');
  process.exit(2);
}

const args = process.argv.slice(2);
let input = null;
let output = null;
let repo = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') output = args[++i];
  else if (args[i] === '--repo') repo = args[++i];
  else if (args[i].startsWith('--')) usage(`Opción desconocida: ${args[i]}`);
  else if (!input) input = args[i];
  else usage(`Argumento inesperado: ${args[i]}`);
}
if (!input) usage('Falta el archivo review.json.');
if (args.includes('--out') && !output) usage('--out necesita una ruta.');
if (args.includes('--repo') && !repo) usage('--repo necesita una ruta.');

let review;
try {
  review = JSON.parse(readFileSync(input, 'utf8'));
} catch (e) {
  usage(`No se puede leer ${input} como JSON: ${e.message}`);
}

const schema = JSON.parse(readFileSync(new URL('../schema/review.schema.json', import.meta.url), 'utf8'));
const result = validateReview(review, schema);
if (result.valid && repo) result.errors.push(...verifyEvidence(review, repo));
const { errors, warnings } = result;
const valid = errors.length === 0;
for (const w of warnings) console.warn(`  ⚠ ${w.path}: ${w.message}`);
if (!valid) {
  for (const e of errors) console.error(`  ✗ ${e.path}: ${e.message}`);
  console.error(`✗ review.json no válido · ${errors.length} error(es). No se ha generado el HTML.`);
  process.exit(1);
}

const html = buildHtml(review);
const target = resolve(output ?? join(dirname(input), 'review.html'));
writeFileSync(target, html);
console.log(`✓ ${target} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · ${warnings.length} aviso(s)`);
