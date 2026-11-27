#!/usr/bin/env node
// Uso:
//   node context.mjs                      rama actual frente a su base (incluye cambios sin commitear)
//   node context.mjs <rama>               solo los commits de <rama> frente a su base
//   node context.mjs [...] --base <rama>  cambia la rama base
//   node context.mjs [...] --out <carpeta>
//
// Escribe en la carpeta de la revisión (por defecto .hitl/reviews/<id>/ dentro del repositorio):
//   context.json   metadatos, archivos, especificaciones, convenciones y avisos
//   changes.patch  diff completo (sin archivos generados)
// Código de salida: 0 correcto · 1 no se puede revisar (sin git, sin base, sin cambios…) · 2 uso incorrecto.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectContext, contextSummary } from './lib/repo-context.mjs';

function usage(message) {
  console.error(message);
  console.error('Uso: node context.mjs [<rama>] [--base <rama>] [--out <carpeta>]');
  process.exit(2);
}

const args = process.argv.slice(2);
const options = { branch: null, base: null, out: null };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--base' || arg === '--out') {
    const value = args[++i];
    if (!value || value.startsWith('--')) usage(`${arg} necesita un valor.`);
    options[arg.slice(2)] = value;
  } else if (arg.startsWith('--')) usage(`Opción desconocida: ${arg}`);
  else if (!options.branch) options.branch = arg;
  else usage(`Argumento inesperado: ${arg}`);
}

let ctx;
try {
  ctx = collectContext({ branch: options.branch, base: options.base });
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

const outDir = resolve(options.out ?? join(ctx.root, '.hitl', 'reviews', ctx.reviewId));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'context.json'), JSON.stringify(contextSummary(ctx), null, 2) + '\n');
writeFileSync(join(outDir, 'changes.patch'), ctx.patch);

// Aviso útil si la carpeta de revisiones no está ignorada por git.
const ignored = (() => {
  try { execFileSync('git', ['-C', ctx.root, 'check-ignore', '-q', '.hitl/'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

const line = (label, value) => console.log(`  ${label.padEnd(15)} ${value}`);
console.log(`✓ Contexto de la revisión «${ctx.head.name}» (${ctx.head.sha.slice(0, 7)})`);
line('base', `${ctx.base.name}, ${ctx.base.source} · merge-base ${ctx.mergeBase.slice(0, 7)}`);
line('cambios', `${ctx.stats.filesChanged} archivo(s) · +${ctx.stats.additions} −${ctx.stats.deletions}${ctx.dirty.count ? ` · ${ctx.dirty.count} sin commitear` : ''}`);
line('commits', ctx.commits.length ? `${ctx.commits.length}: ${ctx.commits.slice(0, 3).map((c) => c.subject).join(' · ')}${ctx.commits.length > 3 ? ' …' : ''}` : 'ninguno (solo cambios sin commitear)');
line('especificaciones', ctx.specs.length ? ctx.specs.map((s) => s.path).join(', ') : 'ninguna');
if (ctx.excluded.length) line('excluidos', ctx.excluded.join(', '));
for (const w of ctx.warnings) console.log(`  ⚠ ${w}`);
line('carpeta', outDir);
if (!ignored) console.log('  ⚠ .hitl/ no está en .gitignore: conviene añadirlo para no versionar las revisiones.');
console.log('');
console.log('Siguiente: leer context.json y changes.patch, y escribir review.json en esa carpeta.');
process.exit(0);
