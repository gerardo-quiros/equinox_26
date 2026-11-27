// Ejecutar con: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyEvidence } from '../.claude/skills/la-senda/scripts/lib/evidence.mjs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/token.ts';
const CONTENT = [
  'export function saveSession(res) {',
  '  const { accessToken } = res;',
  "  localStorage.setItem('access_token', accessToken);",
  "  localStorage.setItem('refresh_token', res.refreshToken);",
  '}',
].join('\n') + '\n';

function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'supervise-ev-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const review = (evidence) => ({
  focuses: [{ id: 'F1', evidence: [evidence] }],
  flashcards: [], quiz: [], scenarios: [],
});

const ev = (overrides = {}) => ({
  kind: 'code', file: FILE, lines: { start: 3, end: 4 },
  snippet: "  localStorage.setItem('access_token', accessToken);\n  localStorage.setItem('refresh_token', res.refreshToken);",
  ...overrides,
});

test('un fragmento que coincide con sus líneas no genera errores', () => {
  assert.deepEqual(verifyEvidence(review(ev()), repoWith({ [FILE]: CONTENT })), []);
});

test('el desajuste indica la línea real y lo que dice el archivo', () => {
  const bad = ev({ snippet: "  localStorage.setItem('access_token', accessToken);\n  localStorage.setItem('session', x);" });
  const [error] = verifyEvidence(review(bad), repoWith({ [FILE]: CONTENT }));
  assert.equal(error.path, 'focuses[0].evidence[0].snippet');
  assert.match(error.message, /línea 4 del archivo es «localStorage.setItem\('refresh_token'/);
});

test('el número de líneas del rango debe coincidir con el fragmento', () => {
  const [error] = verifyEvidence(review(ev({ lines: { start: 3, end: 5 } })), repoWith({ [FILE]: CONTENT }));
  assert.equal(error.path, 'focuses[0].evidence[0].lines');
  assert.match(error.message, /3 línea\(s\).*tiene 2/);
});

test('un rango que sale del archivo se reporta', () => {
  const [error] = verifyEvidence(review(ev({ lines: { start: 40, end: 41 } })), repoWith({ [FILE]: CONTENT }));
  assert.match(error.message, /solo tiene 6 líneas|no coincide|línea/);
});

test('archivo inexistente', () => {
  const [error] = verifyEvidence(review(ev({ file: 'src/otro.ts' })), repoWith({ [FILE]: CONTENT }));
  assert.equal(error.path, 'focuses[0].evidence[0].file');
  assert.match(error.message, /no existe «src\/otro.ts»/);
});

test('una ruta que sale del repositorio se rechaza aunque el esquema no la haya detectado', () => {
  const root = repoWith({ [FILE]: CONTENT });
  const [error] = verifyEvidence(review(ev({ file: '../../etc/passwd' })), root);
  assert.match(error.message, /sale del repositorio/);
});

test('sin rango de líneas, el fragmento debe aparecer en el archivo', () => {
  const root = repoWith({ 'docs/spec.md': '## Criterios\n\n- AC-4: recuperar contraseña\n' });
  const ok = verifyEvidence(review(ev({ kind: 'spec', file: 'docs/spec.md', lines: undefined, snippet: '- AC-4: recuperar contraseña' })), root);
  assert.deepEqual(ok, []);
  const [error] = verifyEvidence(review(ev({ kind: 'spec', file: 'docs/spec.md', lines: undefined, snippet: '- AC-9: inventado' })), root);
  assert.match(error.message, /no aparece/);
});

test('las evidencias de diff no se verifican contra el archivo', () => {
  const root = repoWith({});
  const diff = ev({ kind: 'diff', file: 'no-existe.ts', lines: undefined, snippet: '+ nueva línea' });
  assert.deepEqual(verifyEvidence(review(diff), root), []);
});

test('ignora espacios finales al comparar', () => {
  const root = repoWith({ [FILE]: CONTENT.replace('accessToken);', 'accessToken);   ') });
  assert.deepEqual(verifyEvidence(review(ev()), root), []);
});

// ---- Referencias del bloque study ----

const studyReview = (ref) => ({
  focuses: [], flashcards: [], quiz: [], scenarios: [],
  study: {
    chronicle: { title: 't', text: 't' },
    map: { flow: [{ label: 'a', detail: 'b', ref }, { label: 'c', detail: 'd' }], components: [], models: [], decisions: [], edgeCases: [], tests: [] },
    teachings: [],
  },
});

test('study: una referencia sin snippet solo comprueba archivo y rango', () => {
  const root = repoWith({ [FILE]: CONTENT });
  assert.deepEqual(verifyEvidence(studyReview({ file: FILE, lines: { start: 1, end: 5 } }), root), []);
  const [missing] = verifyEvidence(studyReview({ file: 'src/fantasma.ts' }), root);
  assert.equal(missing.path, 'study.map.flow[0].ref.file');
  assert.match(missing.message, /no existe/);
  const [range] = verifyEvidence(studyReview({ file: FILE, lines: { start: 3, end: 40 } }), root);
  assert.equal(range.path, 'study.map.flow[0].ref.lines');
});

test('study: un snippet se verifica igual que una evidencia', () => {
  const root = repoWith({ [FILE]: CONTENT });
  const good = studyReview({ file: FILE, lines: { start: 3, end: 3 }, snippet: "  localStorage.setItem('access_token', accessToken);" });
  assert.deepEqual(verifyEvidence(good, root), []);
  const bad = studyReview({ file: FILE, lines: { start: 3, end: 3 }, snippet: '  inventado();' });
  const [error] = verifyEvidence(bad, root);
  assert.equal(error.path, 'study.map.flow[0].ref.snippet');
});

test('study: una referencia que sale del repositorio se rechaza', () => {
  const [error] = verifyEvidence(studyReview({ file: '../../etc/passwd' }), repoWith({ [FILE]: CONTENT }));
  assert.match(error.message, /sale del repositorio/);
});

test('validate --repo y build --repo rechazan un review con evidencias falsas', () => {
  const root = repoWith({ [FILE]: CONTENT });
  const reviewPath = join(root, 'review.json');
  // Revisión mínima válida según el esquema, con una cita falsa.
  const minimal = {
    schemaVersion: '1.0',
    meta: {
      reviewId: 'test-1', project: 'p', title: 't', summary: 's', generatedAt: '2026-11-26T10:00:00Z',
      source: { type: 'branch', base: 'main', head: 'feature/x', mergeBase: 'a'.repeat(40), commit: 'b'.repeat(40), dirty: false },
    },
    focuses: [{ id: 'F1', type: 'risk', priority: 'high', title: 'Token', why: 'Se guarda en localStorage.',
      evidence: [ev({ snippet: '  localStorage.setItem("x", 1);', lines: { start: 3, end: 3 } })] }],
    flashcards: [{ id: 'C1', focusIds: ['F1'], front: '¿Dónde?', title: 'En localStorage', back: 'Ahí.', evidence: [ev({ lines: { start: 3, end: 3 }, snippet: "  localStorage.setItem('access_token', accessToken);" })] }],
    quiz: [{ id: 'Q1', focusIds: ['F1'], kind: 'single', title: 'T', prompt: 'P', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B', why: 'no' }], correct: ['a'], explanation: 'E', evidence: [ev({ lines: { start: 3, end: 3 }, snippet: "  localStorage.setItem('access_token', accessToken);" })] }],
    scenarios: [{ id: 'S1', focusIds: ['F1'], title: 'S', situation: 'Sit', prompt: 'P', evidence: [ev({ lines: { start: 3, end: 3 }, snippet: "  localStorage.setItem('access_token', accessToken);" })] }],
  };
  writeFileSync(reviewPath, JSON.stringify(minimal));
  const cli = (script, ...args) => {
    try {
      execFileSync('node', [join(process.cwd(), '.claude/skills/la-senda/scripts', script), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      return 0;
    } catch (e) { return e.status; }
  };
  assert.equal(cli('build.mjs', reviewPath), 0, 'sin --repo solo se valida la estructura y se genera el HTML');
  assert.equal(cli('build.mjs', reviewPath, '--repo', root), 1, 'con --repo se detecta el fragmento falso');
});
