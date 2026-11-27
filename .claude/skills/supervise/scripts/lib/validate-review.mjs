// Validación completa de review.json: estructura (schema) + semántica.
// Sin dependencias; funciona en Node y en el navegador. El schema se recibe como
// parámetro para no depender del sistema de archivos.

import { validateAgainstSchema } from './schema-subset.mjs';

const MAX_SNIPPET_LINES = 60;
const QUESTION_GROUPS = ['flashcards', 'quiz', 'scenarios'];

/**
 * @returns {{valid: boolean, errors: {path, message}[], warnings: {path, message}[]}}
 */
export function validateReview(review, schema) {
  const errors = validateAgainstSchema(review, schema);
  const warnings = [];
  // Las comprobaciones semánticas asumen una estructura correcta.
  if (errors.length) return { valid: false, errors, warnings };

  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });

  // 1. Identificadores únicos en todo el documento.
  const seen = new Map();
  const groups = ['focuses', ...QUESTION_GROUPS];
  for (const group of groups) {
    (review[group] ?? []).forEach((item, i) => {
      const path = `${group}[${i}].id`;
      if (seen.has(item.id)) err(path, `id "${item.id}" duplicado (ya usado en ${seen.get(item.id)})`);
      else seen.set(item.id, path);
    });
  }

  // 2. Referencias a focos.
  const focusIds = new Set(review.focuses.map((f) => f.id));

  const referenced = new Set();
  for (const group of QUESTION_GROUPS) {
    review[group].forEach((item, i) => {
      item.focusIds.forEach((id, j) => {
        if (!focusIds.has(id)) err(`${group}[${i}].focusIds[${j}]`, `el foco "${id}" no existe en focuses`);
        referenced.add(id);
      });
    });
  }

  // 3. Reglas de las preguntas de test.
  review.quiz.forEach((q, i) => checkQuizItem(q, `quiz[${i}]`, err));

  // 4. Evidencias.
  const evidenceOwners = ['focuses', ...QUESTION_GROUPS];
  for (const group of evidenceOwners) {
    review[group].forEach((item, i) => {
      item.evidence.forEach((ev, j) => checkEvidence(ev, `${group}[${i}].evidence[${j}]`, err));
    });
  }

  // 5. Aviso de calidad (no bloquea).
  review.focuses.forEach((focus, i) => {
    if (!referenced.has(focus.id)) {
      const level = focus.priority === 'high' ? 'de prioridad alta ' : '';
      warn(`focuses[${i}]`, `el foco ${level}"${focus.id}" no se trabaja en ninguna pregunta`);
    }
  });

  // 6. Fase de estudio (opcional).
  if (review.study) checkStudy(review.study, focusIds, err, warn);
  if (review.study && review.schemaVersion === '1.0') err('schemaVersion', 'el bloque study necesita schemaVersion "1.1"');

  return { valid: errors.length === 0, errors, warnings };
}

const MAX_STUDY_SNIPPET_LINES = 12;

/** Recorre todas las referencias a código del bloque study: [ruta, ref]. */
export function studyRefs(study) {
  const out = [];
  const add = (path, item) => { if (item.ref) out.push([`${path}.ref`, item.ref]); };
  const { map } = study;
  for (const group of ['flow', 'components', 'models', 'decisions', 'edgeCases', 'tests']) {
    map[group].forEach((item, i) => add(`study.map.${group}[${i}]`, item));
  }
  study.teachings.forEach((item, i) => add(`study.teachings[${i}]`, item));
  return out;
}

function checkStudy(study, focusIds, err, warn) {
  const { map } = study;

  for (const group of ['components', 'models']) {
    const seen = new Set();
    map[group].forEach((item, i) => {
      if (seen.has(item.name)) err(`study.map.${group}[${i}].name`, `«${item.name}» está repetido`);
      seen.add(item.name);
    });
  }

  const withFocus = [
    ...map.decisions.map((x, i) => [`study.map.decisions[${i}]`, x]),
    ...map.edgeCases.map((x, i) => [`study.map.edgeCases[${i}]`, x]),
    ...study.teachings.map((x, i) => [`study.teachings[${i}]`, x]),
  ];
  for (const [path, item] of withFocus) {
    (item.focusIds ?? []).forEach((id, j) => {
      if (!focusIds.has(id)) err(`${path}.focusIds[${j}]`, `el foco "${id}" no existe en focuses`);
    });
  }

  for (const [path, ref] of studyRefs(study)) {
    if (ref.lines && ref.lines.end < ref.lines.start) {
      err(`${path}.lines`, `end (${ref.lines.end}) no puede ser menor que start (${ref.lines.start})`);
    }
    if (ref.snippet) {
      const count = ref.snippet.replace(/\n+$/, '').split('\n').length;
      if (count > MAX_STUDY_SNIPPET_LINES) err(`${path}.snippet`, `máximo ${MAX_STUDY_SNIPPET_LINES} líneas en el estudio (tiene ${count}); si hace falta más, no pongas código`);
    }
  }

  if (!map.decisions.length && !map.edgeCases.length) {
    warn('study.map', 'sin decisiones ni casos límite: el mapa se queda corto');
  }
}

function checkQuizItem(q, path, err) {
  const optionIds = q.options.map((o) => o.id);
  optionIds.forEach((id, j) => {
    if (optionIds.indexOf(id) !== j) err(`${path}.options[${j}].id`, `id de opción "${id}" duplicado`);
  });
  q.correct.forEach((id, j) => {
    if (!optionIds.includes(id)) err(`${path}.correct[${j}]`, `"${id}" no es ninguna de las opciones`);
  });
  q.options.forEach((o, j) => {
    if (!q.correct.includes(o.id) && !o.why) {
      err(`${path}.options[${j}].why`, `la opción incorrecta "${o.id}" necesita "why": se muestra si el humano la elige`);
    }
  });

  if (q.kind === 'single') {
    if (q.correct.length !== 1) err(`${path}.correct`, 'una pregunta single tiene exactamente una respuesta correcta');
    return;
  }

  // multiple: la interfaz pide seleccionar exactamente tantas como respuestas correctas haya.
  if (optionIds.length < 3) err(`${path}.options`, 'una pregunta multiple necesita al menos 3 opciones');
  if (q.correct.length < 2) err(`${path}.correct`, 'una pregunta multiple tiene al menos 2 respuestas correctas; con una sola usa single');
  if (q.correct.length >= optionIds.length) err(`${path}.correct`, 'no pueden ser correctas todas las opciones: la pregunta no discrimina');
}

function checkEvidence(ev, path, err) {
  const lineCount = ev.snippet.split('\n').length;
  if (lineCount > MAX_SNIPPET_LINES) {
    err(`${path}.snippet`, `máximo ${MAX_SNIPPET_LINES} líneas (tiene ${lineCount}); recorta al fragmento relevante`);
  }
  if (ev.lines && ev.lines.end < ev.lines.start) {
    err(`${path}.lines`, `end (${ev.lines.end}) no puede ser menor que start (${ev.lines.start})`);
  }
}
