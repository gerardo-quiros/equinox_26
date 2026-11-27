// Ejecutar con: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateReview } from '../.claude/skills/supervise/scripts/lib/validate-review.mjs';
import { validateAgainstSchema } from '../.claude/skills/supervise/scripts/lib/schema-subset.mjs';

const SKILL = new URL('../.claude/skills/supervise/', import.meta.url);
const load = (rel) => JSON.parse(readFileSync(new URL(rel, SKILL), 'utf8'));

const reviewSchema = load('schema/review.schema.json');
const example = load('examples/review.example.json');

const clone = () => structuredClone(example);

/** Aplica una mutación al ejemplo y espera un error en `path` cuyo mensaje contenga `msg`. */
function expectError(mutate, path, msg) {
  const review = clone();
  mutate(review);
  const result = validateReview(review, reviewSchema);
  assert.equal(result.valid, false, 'debería ser inválido');
  const hit = result.errors.find((e) => e.path === path && (!msg || e.message.includes(msg)));
  assert.ok(hit, `se esperaba error en ${path}${msg ? ` con «${msg}»` : ''}; errores: ${JSON.stringify(result.errors)}`);
}

test('el ejemplo es válido y sin avisos', () => {
  const result = validateReview(example, reviewSchema);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

// ---- Estructura ----

test('campo obligatorio ausente', () => {
  expectError((r) => delete r.meta.source, 'meta.source', 'obligatorio');
});

test('campo no permitido (detecta erratas del agente)', () => {
  expectError((r) => { r.flashcards[0].answer = 'x'; }, 'flashcards[0].answer', 'no permitido');
});

test('enum inválido', () => {
  expectError((r) => { r.focuses[0].priority = 'critical'; }, 'focuses[0].priority', 'no permitido');
});

test('texto vacío o solo espacios', () => {
  expectError((r) => { r.flashcards[0].front = '   '; }, 'flashcards[0].front', 'vacío');
});

test('texto demasiado largo', () => {
  expectError((r) => { r.flashcards[0].front = 'x'.repeat(301); }, 'flashcards[0].front', 'máximo 300');
});

test('más preguntas de las permitidas', () => {
  expectError((r) => { r.quiz.push(structuredClone(r.quiz[0])); }, 'quiz', 'máximo 4');
});

test('nivel vacío', () => {
  expectError((r) => { r.scenarios = []; }, 'scenarios', 'mínimo 1');
});

test('fecha sin zona horaria', () => {
  expectError((r) => { r.meta.generatedAt = '2026-11-26 10:00'; }, 'meta.generatedAt', 'ISO 8601');
});

test('sha con formato incorrecto', () => {
  expectError((r) => { r.meta.source.commit = 'HEAD'; }, 'meta.source.commit');
});

test('pregunta sin evidencia', () => {
  expectError((r) => { r.flashcards[0].evidence = []; }, 'flashcards[0].evidence', 'mínimo 1');
});

for (const bad of ['/etc/passwd', '../secrets.env', 'src/../../x', 'C:\\repo\\a.ts', '..\\x']) {
  test(`ruta insegura rechazada: ${bad}`, () => {
    expectError((r) => { r.focuses[0].evidence[0].file = bad; }, 'focuses[0].evidence[0].file');
  });
}

test('rutas relativas normales aceptadas', () => {
  for (const ok of ['src/a.ts', '.github/workflows/ci.yml', 'a..b/c.ts', 'docs/v1.2/x.md']) {
    const r = clone();
    r.focuses[0].evidence[0].file = ok;
    assert.deepEqual(validateReview(r, reviewSchema).errors, [], ok);
  }
});

// ---- Semántica ----

test('id duplicado entre colecciones', () => {
  expectError((r) => { r.quiz[0].id = 'Q2'; }, 'quiz[1].id', 'duplicado');
});

test('referencia a un foco inexistente', () => {
  expectError((r) => { r.flashcards[0].focusIds = ['F99']; }, 'flashcards[0].focusIds[0]', 'F99');
});

test('el tipo true-false ya no existe: se expresa como single con dos opciones', () => {
  expectError((r) => { r.quiz[0].kind = 'true-false'; }, 'quiz[0].kind', 'no permitido');
});

test('single con dos opciones (verdadero/falso) es válido', () => {
  const r = clone();
  r.quiz[0].options = [{ id: 'a', text: 'Verdadero' }, { id: 'b', text: 'Falso', why: 'No es así.' }];
  r.quiz[0].correct = ['a'];
  assert.deepEqual(validateReview(r, reviewSchema).errors, []);
});

test('opción con detalle opcional', () => {
  const r = clone();
  delete r.quiz[0].options[0].detail;
  assert.deepEqual(validateReview(r, reviewSchema).errors, []);
});

test('opción incorrecta sin why', () => {
  expectError((r) => { delete r.quiz[0].options[1].why; }, 'quiz[0].options[1].why', 'necesita');
});

test('la opción correcta puede no llevar why', () => {
  const r = clone();
  delete r.quiz[0].options[0].why;
  assert.deepEqual(validateReview(r, reviewSchema).errors, []);
});

test('flashcard sin título de respuesta', () => {
  expectError((r) => { delete r.flashcards[0].title; }, 'flashcards[0].title', 'obligatorio');
});

test('flashcard con más de 2 evidencias', () => {
  expectError((r) => { const ev = r.flashcards[0].evidence[0]; r.flashcards[0].evidence = [ev, ev, ev]; }, 'flashcards[0].evidence', 'máximo 2');
});

test('pregunta de test sin título', () => {
  expectError((r) => { delete r.quiz[0].title; }, 'quiz[0].title', 'obligatorio');
});

test('id de opción solo a–f', () => {
  expectError((r) => { r.quiz[0].options[0].id = 'true'; r.quiz[0].correct = ['true']; }, 'quiz[0].options[0].id');
});

test('multiple con una sola respuesta correcta', () => {
  expectError((r) => { r.quiz[2].correct = ['b']; }, 'quiz[2].correct', 'al menos 2');
});

test('multiple con todas las opciones correctas', () => {
  expectError((r) => { r.quiz[2].correct = ['a', 'b', 'c', 'd']; }, 'quiz[2].correct', 'todas');
});

test('single con dos respuestas correctas', () => {
  expectError((r) => { r.quiz[1].correct = ['a', 'b']; }, 'quiz[1].correct', 'exactamente una');
});

test('respuesta correcta que no es una opción', () => {
  expectError((r) => { r.quiz[2].correct = ['b', 'f']; }, 'quiz[2].correct[1]', 'no es ninguna');
});

test('multiple con menos de 3 opciones', () => {
  expectError((r) => { r.quiz[2].options = r.quiz[2].options.slice(0, 2); r.quiz[2].correct = ['b']; }, 'quiz[2].options', 'al menos 3');
});

test('rango de líneas invertido', () => {
  expectError((r) => { r.focuses[3].evidence[0].lines = { start: 60, end: 56 }; }, 'focuses[3].evidence[0].lines', 'menor');
});

test('snippet de más de 60 líneas', () => {
  expectError((r) => { r.focuses[3].evidence[0].snippet = 'x\n'.repeat(61); }, 'focuses[3].evidence[0].snippet', '60 líneas');
});

// ---- Avisos ----

test('aviso por foco de prioridad alta sin preguntas', () => {
  const r = clone();
  for (const g of ['flashcards', 'quiz', 'scenarios']) {
    r[g].forEach((q) => { q.focusIds = q.focusIds.filter((id) => id !== 'F1'); if (!q.focusIds.length) q.focusIds = ['F3']; });
  }
  const result = validateReview(r, reviewSchema);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.path === 'focuses[0]' && w.message.includes('prioridad alta')));
});

// ---- Garantía de sincronía schema ↔ validador ----

test('una palabra clave de JSON Schema no soportada lanza en vez de ignorarse', () => {
  assert.throws(() => validateAgainstSchema({}, { type: 'object', oneOf: [] }), /no soportada: "oneOf"/);
});

// ---- Fase de estudio ----

test('una revisión 1.0 sin study sigue siendo válida', () => {
  const r = clone();
  r.schemaVersion = '1.0';
  delete r.study;
  delete r.meta.source.repoUrl;
  delete r.meta.source.published;
  assert.deepEqual(validateReview(r, reviewSchema).errors, []);
});

test('study exige schemaVersion 1.1', () => {
  expectError((r) => { r.schemaVersion = '1.0'; }, 'schemaVersion', '1.1');
});

test('study: el flujo necesita al menos dos pasos', () => {
  expectError((r) => { r.study.map.flow = r.study.map.flow.slice(0, 1); }, 'study.map.flow', 'mínimo 2');
});

test('study: grupos opcionales vacíos son válidos', () => {
  const r = clone();
  r.study.map.models = [];
  r.study.map.tests = [];
  r.study.map.edgeCases = [];
  assert.deepEqual(validateReview(r, reviewSchema).errors, []);
});

test('study: aviso si no hay decisiones ni casos límite', () => {
  const r = clone();
  r.study.map.decisions = [];
  r.study.map.edgeCases = [];
  const result = validateReview(r, reviewSchema);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.path === 'study.map'));
});

test('study: componente repetido', () => {
  expectError((r) => { r.study.map.components[1].name = r.study.map.components[0].name; }, 'study.map.components[1].name', 'repetido');
});

test('study: referencia a un foco inexistente', () => {
  expectError((r) => { r.study.teachings[0].focusIds = ['F42']; }, 'study.teachings[0].focusIds[0]', 'F42');
});

test('study: los componentes no admiten snippet', () => {
  expectError((r) => { r.study.map.components[0].ref.snippet = 'x'; }, 'study.map.components[0].ref.snippet', 'no permitido');
});

test('study: snippet de más de 12 líneas', () => {
  expectError((r) => {
    r.study.teachings[1].ref = { file: 'a.py', lines: { start: 1, end: 13 }, snippet: 'x\n'.repeat(13) };
  }, 'study.teachings[1].ref.snippet', '12 líneas');
});

test('study: ruta insegura en una referencia', () => {
  expectError((r) => { r.study.map.flow[1].ref.file = '../etc/passwd'; }, 'study.map.flow[1].ref.file');
});

test('study: no se admiten URLs escritas por el agente', () => {
  expectError((r) => { r.study.teachings[0].url = 'https://github.com/x'; }, 'study.teachings[0].url', 'no permitido');
});

test('meta.source.repoUrl solo acepta la URL web de GitHub', () => {
  for (const bad of ['git@github.com:acme/x.git', 'https://gitlab.com/acme/x', 'https://github.com/acme/x/blob/main', 'javascript:alert(1)']) {
    expectError((r) => { r.meta.source.repoUrl = bad; }, 'meta.source.repoUrl');
  }
});

// ---- Exportación de escenarios al portapapeles ----

test('el escenario ya no exige respuesta de referencia', () => {
  const r = clone();
  assert.equal('referenceAnswer' in r.scenarios[0], false);
  assert.deepEqual(validateReview(r, reviewSchema).errors, []);
  expectError((r2) => { r2.scenarios[0].referenceAnswer = 'x'; }, 'scenarios[0].referenceAnswer', 'no permitido');
});
