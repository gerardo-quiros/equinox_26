#!/usr/bin/env node
// Uso: node validate.mjs <review.json> [--repo <raíz del repositorio>]
//   Con --repo, además comprueba que cada fragmento de evidencia coincide con el archivo.
// Código de salida: 0 válido (puede haber avisos) · 1 errores · 2 uso o lectura incorrectos.

import { readFileSync } from 'node:fs';
import { validateReview } from './lib/validate-review.mjs';
import { verifyEvidence } from './lib/evidence.mjs';

const args = process.argv.slice(2);
const repoAt = args.indexOf('--repo');
const repo = repoAt === -1 ? null : args[repoAt + 1];
if (repoAt !== -1 && !repo) { console.error('--repo necesita una ruta.'); process.exit(2); }
const repoValueAt = repoAt === -1 ? -1 : repoAt + 1;
const positional = args.filter((a, i) => a !== '--repo' && i !== repoValueAt);
const file = positional[0];
if (!file || positional.length > 1) {
  console.error('Uso: node validate.mjs <review.json> [--repo <raíz del repositorio>]');
  process.exit(2);
}

const readJson = (path, label) => {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`No se puede leer ${label} (${path}): ${e.message}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`✗ ${label} no es JSON válido: ${e.message}`);
    process.exit(1);
  }
};

const schema = readJson(new URL('../schema/review.schema.json', import.meta.url), 'review.schema.json');
const review = readJson(file, 'review.json');
const result = validateReview(review, schema);
if (result.valid && repo) result.errors.push(...verifyEvidence(review, repo));
const { errors, warnings } = result;
const valid = errors.length === 0;

for (const e of errors) console.error(`  ✗ ${e.path}: ${e.message}`);
for (const w of warnings) console.warn(`  ⚠ ${w.path}: ${w.message}`);
const summary = `${errors.length} error(es), ${warnings.length} aviso(s)${repo ? ' · evidencias verificadas' : ''}`;
if (valid) console.log(`✓ review.json válido · ${summary}`);
else console.error(`✗ review.json no válido · ${summary}`);

process.exit(valid ? 0 : 1);
