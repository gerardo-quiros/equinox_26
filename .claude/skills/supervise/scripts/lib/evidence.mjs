// Comprueba que cada fragmento de evidencia coincide con el archivo del repositorio.
// Sin esta comprobación, el agente podría citar líneas que no existen o que dicen otra cosa.
// Las evidencias de tipo «diff» no se verifican aquí: sus líneas son del parche, no del archivo.
// En el bloque study, las referencias sin snippet solo se comprueban en ruta y rango de líneas.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { studyRefs } from './validate-review.mjs';

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

  // Devuelve las líneas del archivo o null si la ruta no es válida (y anota el error).
  const open = (file, path) => {
    const abs = resolve(root, file);
    if (!abs.startsWith(root + sep)) {
      errors.push({ path: `${path}.file`, message: `la ruta «${file}» sale del repositorio` });
      return null;
    }
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      errors.push({ path: `${path}.file`, message: `no existe «${file}» en el repositorio` });
      return null;
    }
    return linesOf(abs);
  };

  const checkSnippet = (name, file, lines, snippet, path) => {
    const want = normalize(snippet).replace(/\n+$/, '').split('\n');
    if (lines) {
      const { start, end } = lines;
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
      errors.push({ path: `${path}.snippet`, message: `el fragmento no aparece en «${name}»` });
    }
  };

  for (const group of OWNERS) {
    (review[group] ?? []).forEach((item, i) => {
      item.evidence.forEach((ev, j) => {
        if (ev.kind === 'diff') return;
        const path = `${group}[${i}].evidence[${j}]`;
        const file = open(ev.file, path);
        if (file) checkSnippet(ev.file, file, ev.lines, ev.snippet, path);
      });
    });
  }

  if (review.study) {
    for (const [path, ref] of studyRefs(review.study)) {
      const file = open(ref.file, path);
      if (!file) continue;
      if (ref.snippet) checkSnippet(ref.file, file, ref.lines, ref.snippet, path);
      else if (ref.lines && ref.lines.end > file.length) {
        errors.push({ path: `${path}.lines`, message: `el archivo solo tiene ${file.length} líneas` });
      }
    }
  }
  return errors;
}
