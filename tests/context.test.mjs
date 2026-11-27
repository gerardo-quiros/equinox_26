// Ejecutar con: node --test tests/
// Cada prueba crea un repositorio git temporal con historia real y comprueba el contexto que recoge /la-senda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectContext, contextSummary, splitPatch, isExcluded, slug, stampOf, githubWebUrl } from '../.claude/skills/la-senda/scripts/lib/repo-context.mjs';

const REVIEW_ID = /^[A-Za-z0-9._-]{1,120}$/;

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.com', '-c', 'user.name=Tester', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** Repositorio con main (base) y feature/001-auth con commits, cambios sin commitear y un archivo nuevo. */
function fixtureRepo({ withSpecs = true, dirty = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'supervise-ctx-'));
  git(root, 'init', '-q', '-b', 'main');
  write(root, 'package.json', JSON.stringify({ name: 'acme-portal' }));
  write(root, 'src/app.ts', 'export const app = 1;\n');
  write(root, 'package-lock.json', '{"v":1}\n');
  if (withSpecs) write(root, 'specs/001-auth/spec.md', '# Autenticación de usuarios\n\n- AC-1: inicio de sesión.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');

  git(root, 'checkout', '-q', '-b', 'feature/001-auth');
  write(root, 'src/auth.ts', 'export function login() {\n  return true;\n}\n');
  write(root, 'src/app.ts', 'export const app = 2;\n');
  write(root, 'package-lock.json', '{"v":2}\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'feat: login');

  if (dirty) {
    // Cambios sin commitear en un archivo con seguimiento y un archivo nuevo sin seguimiento.
    write(root, 'src/auth.ts', 'export function login() {\n  return false;\n}\n');
    write(root, 'src/new-helper.ts', 'export const helper = true;\n');
  }
  return root;
}

const names = (ctx) => ctx.files.map((f) => f.path).sort();

test('incluye commits y cambios sin commitear, excluye lockfiles y lista la spec', () => {
  const root = fixtureRepo();
  const ctx = collectContext({ cwd: root });

  assert.equal(ctx.head.name, 'feature/001-auth');
  assert.equal(ctx.base.name, 'main');
  assert.equal(ctx.base.source, 'por convención main/master');
  assert.deepEqual(names(ctx), ['src/app.ts', 'src/auth.ts', 'src/new-helper.ts']);
  assert.deepEqual(ctx.excluded, ['package-lock.json']);
  assert.equal(ctx.dirty, true);
  assert.equal(ctx.commits.length, 1);
  assert.equal(ctx.commits[0].subject, 'feat: login');
  assert.equal(ctx.project, 'acme-portal');
  assert.match(ctx.reviewId, REVIEW_ID);
  assert.ok(ctx.reviewId.includes('-dirty-'), 'el id indica que hay cambios sin commitear');
  assert.deepEqual(ctx.specs, [{ dir: 'specs/001-auth', files: ['spec.md'] }]);
  assert.ok(ctx.patch.includes('diff --git a/src/new-helper.ts b/src/new-helper.ts'), 'el archivo nuevo entra en el parche');
  assert.equal(ctx.patch.includes('package-lock'), false, 'el parche no contiene lockfiles');
  assert.equal(ctx.mergeBase, git(root, 'rev-parse', 'main'));
});

test('estadísticas y estado de cada archivo', () => {
  const root = fixtureRepo();
  const ctx = collectContext({ cwd: root });
  const byPath = Object.fromEntries(ctx.files.map((f) => [f.path, f]));
  assert.equal(byPath['src/new-helper.ts'].status, 'added');
  assert.equal(byPath['src/auth.ts'].status, 'added', 'auth.ts es nuevo frente a main');
  assert.equal(ctx.stats.filesChanged, 3);
  // auth.ts (3 líneas nuevas), app.ts (+1 −1) y new-helper.ts (+1)
  assert.deepEqual(ctx.stats, { filesChanged: 3, additions: 5, deletions: 1 });
});

test('la rama base se puede indicar con --base', () => {
  const root = fixtureRepo();
  git(root, 'branch', 'develop', 'main');
  const ctx = collectContext({ cwd: root, base: 'develop' });
  assert.equal(ctx.base.name, 'develop');
  assert.equal(ctx.base.source, '--base');
});

test('error claro fuera de un repositorio git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supervise-nogit-'));
  assert.throws(() => collectContext({ cwd: dir }), /No estás dentro de un repositorio git/);
});

test('error claro cuando no hay nada que revisar', () => {
  const root = fixtureRepo();
  git(root, 'checkout', '-q', '--', '.');
  git(root, 'clean', '-qfd');
  git(root, 'checkout', '-q', 'main');
  assert.throws(() => collectContext({ cwd: root }), /No hay cambios que revisar frente a «main»/);
});

test('sin especificaciones: aviso y se usa el README como contexto', () => {
  const root = fixtureRepo({ withSpecs: false });
  write(root, 'README.md', '# Acme\n\nPortal de clientes.\n');
  const ctx = collectContext({ cwd: root });
  assert.deepEqual(ctx.specs, []);
  assert.ok(ctx.warnings.some((w) => w.includes('No hay especificaciones')));
  assert.deepEqual(ctx.conventions.map((c) => c.path), ['README.md']);
});

test('se listan todas las especificaciones y el agente decide cuáles aplican', () => {
  const root = fixtureRepo();
  write(root, 'specs/002-billing/spec.md', '# Facturación\n');
  write(root, 'specs/002-billing/plan.md', '# Plan\n');
  const ctx = collectContext({ cwd: root });
  assert.deepEqual(ctx.specs.map((s) => s.dir), ['specs/001-auth', 'specs/002-billing']);
  assert.deepEqual(ctx.specs[1].files, ['spec.md', 'plan.md']);
});

test('CLAUDE.md se incluye como convenciones del proyecto', () => {
  const root = fixtureRepo();
  write(root, 'CLAUDE.md', '# Reglas\n\nNo usar innerHTML.\n');
  const ctx = collectContext({ cwd: root });
  assert.ok(ctx.conventions.some((c) => c.path === 'CLAUDE.md' && c.content.includes('innerHTML')));
});

test('context.json no contiene el parche (va en changes.patch) y trae el metadato prellenado', () => {
  const root = fixtureRepo();
  const ctx = collectContext({ cwd: root });
  const summary = contextSummary(ctx);
  assert.equal('patch' in summary, false);
  assert.equal(summary.metaDraft.reviewId, ctx.reviewId);
  assert.equal(summary.metaDraft.source.base, 'main');
  assert.equal(summary.metaDraft.source.dirty, true);
  assert.equal(summary.metaDraft.source.commit, ctx.head.sha);
  assert.equal(summary.metaDraft.title, 'feat: login');
  assert.match(summary.metaDraft.summary, /pendiente/);
});

test('sin remoto no hay repoUrl ni enlaces', () => {
  const ctx = collectContext({ cwd: fixtureRepo() });
  assert.equal(ctx.repoUrl, null);
  assert.equal(ctx.published, false);
  assert.equal('repoUrl' in contextSummary(ctx).metaDraft.source, false, 'metaDraft no lleva campos vacíos');
});

test('con remoto de GitHub: repoUrl y si el commit está publicado', () => {
  const root = fixtureRepo({ dirty: false });
  git(root, 'remote', 'add', 'origin', 'git@github.com:acme/acme-portal.git');
  let ctx = collectContext({ cwd: root });
  assert.equal(ctx.repoUrl, 'https://github.com/acme/acme-portal');
  assert.equal(ctx.published, false, 'ninguna rama remota contiene el commit');

  // Simula un push: una rama remota que contiene HEAD.
  git(root, 'update-ref', 'refs/remotes/origin/feature/001-auth', 'HEAD');
  ctx = collectContext({ cwd: root });
  assert.equal(ctx.published, true);
  assert.deepEqual(
    { repoUrl: contextSummary(ctx).metaDraft.source.repoUrl, published: contextSummary(ctx).metaDraft.source.published },
    { repoUrl: 'https://github.com/acme/acme-portal', published: true },
  );
});

test('githubWebUrl normaliza SSH y HTTPS, quita credenciales y rechaza otros hosts', () => {
  const expected = 'https://github.com/acme/portal';
  for (const url of ['git@github.com:acme/portal.git', 'ssh://git@github.com/acme/portal.git', 'https://github.com/acme/portal.git',
    'https://github.com/acme/portal', 'https://token:x-oauth@github.com/acme/portal.git', 'https://github.com/acme/portal/']) {
    assert.equal(githubWebUrl(url), expected, url);
  }
  for (const url of ['git@gitlab.com:acme/portal.git', 'https://bitbucket.org/acme/portal', 'https://github.com/acme', null, '']) {
    assert.equal(githubWebUrl(url), null, String(url));
  }
});

/* ---- Funciones auxiliares ---- */

test('splitPatch separa secciones, estados y cuenta líneas', () => {
  const patch = [
    'diff --git a/a.txt b/a.txt', 'index 1..2 100644', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1,2 @@', '-old', '+new', '+extra',
    'diff --git a/n.txt b/n.txt', 'new file mode 100644', '--- /dev/null', '+++ b/n.txt', '@@ -0,0 +1 @@', '+hola',
  ].join('\n');
  const [a, n] = splitPatch(patch);
  assert.equal(a.path, 'a.txt');
  assert.equal(a.additions, 2);
  assert.equal(a.deletions, 1);
  assert.equal(n.status, 'added');
  assert.equal(n.additions, 1);
});

test('isExcluded reconoce lockfiles y generados, y no excluye código', () => {
  for (const p of ['package-lock.json', 'web/pnpm-lock.yaml', 'Cargo.lock', 'dist/app.min.js', 'x/y.map']) assert.equal(isExcluded(p), true, p);
  for (const p of ['src/lock.ts', 'docs/locking.md', 'src/app.js']) assert.equal(isExcluded(p), false, p);
});

test('slug y stampOf producen identificadores válidos', () => {
  assert.equal(slug('feature/auth sesiones!'), 'feature-auth-sesiones');
  assert.match(slug('HEAD (detached abc)'), REVIEW_ID);
  assert.equal(stampOf(new Date(2026, 10, 26, 9, 5)), '20261126-0905');
});
