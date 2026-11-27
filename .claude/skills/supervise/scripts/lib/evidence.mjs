// Comprueba que cada fragmento de evidencia coincide con el archivo del repositorio.
// Sin esta comprobación, el agente podría citar líneas que no existen o que dicen otra cosa.
// Las evidencias de tipo «diff» no se verifican aquí: sus líneas son del parche, no del archivo.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const normalize = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');

const OWNERS = ['focuses', 'flashcards', 'quiz', 'scenarios'];

/**
 * @param {object} review review.json ya validado estructuralmente
 * @param {string} repoRoot raíz del repositorio revisado
 * @returns {{path: string, message: string}[]}
 */
export function verifyEvidence(review, repoRoot) {
  const errors = [];
  const root = realpathSync(repoRoot);
  const cache = new Map();

  const linesOf = (file) => {
    if (!cache.has(file)) cache.set(file, normalize(readFileSync(file, 'utf8')).split('\n'));
    return cache.get(file);
  };

  for (const group of OWNERS) {
    (review[group] ?? []).forEach((item, i) => {
      item.evidence.forEach((ev, j) => {
        if (ev.kind === 'diff') return;
        const path = `${group}[${i}].evidence[${j}]`;
        const abs = resolve(root, ev.file);

        if (!abs.startsWith(root + sep)) {
          errors.push({ path: `${path}.file`, message: `la ruta «${ev.file}» sale del repositorio` });
          return;
        }
        if (!existsSync(abs) || !statSync(abs).isFile()) {
          errors.push({ path: `${path}.file`, message: `no existe «${ev.file}» en el repositorio` });
          return;
        }

        const want = normalize(ev.snippet).replace(/\n+$/, '').split('\n');
        const file = linesOf(abs);

        if (ev.lines) {
          const { start, end } = ev.lines;
          if (end - start + 1 !== want.length) {
            errors.push({ path: `${path}.lines`, message: `el rango ${start}–${end} tiene ${end - start + 1} línea(s) y el fragmento tiene ${want.length}` });
            return;
          }
          if (end > file.length) {
            errors.push({ path: `${path}.lines`, message: `el archivo solo tiene ${file.length} líneas` });
            return;
          }
          const got = file.slice(start - 1, end);
          const mismatch = want.findIndex((line, k) => line !== got[k]);
          if (mismatch !== -1) {
            errors.push({ path: `${path}.snippet`, message: `la línea ${start + mismatch} del archivo es «${got[mismatch].trim()}», no «${want[mismatch].trim()}»` });
          }
        } else if (!file.join('\n').includes(want.join('\n'))) {
          errors.push({ path: `${path}.snippet`, message: `el fragmento no aparece en «${ev.file}»` });
        }
      });
    });
  }
  return errors;
}
