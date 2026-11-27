// Coherencia de la Skill: lo que SKILL.md dice debe existir en la carpeta y en los scripts.
// Ejecutar con: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const SKILL = new URL('../.claude/skills/la-senda/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, SKILL), 'utf8');
const skillMd = read('SKILL.md');

test('el frontmatter tiene name (igual a la carpeta) y description', () => {
  const front = skillMd.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  assert.match(front, /^name: la-senda$/m);
  assert.match(front, /^description: .{80,}$/m, 'la descripción debe explicar cuándo usarla');
  assert.match(front, /^argument-hint: /m);
});

test('todas las rutas <skill>/… que cita SKILL.md existen', () => {
  const refs = [...skillMd.matchAll(/<skill>\/([\w./-]+)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, 'se esperaban varias referencias');
  for (const ref of new Set(refs)) {
    assert.ok(existsSync(new URL(ref, SKILL)), `no existe ${ref}`);
  }
});

test('los comandos de SKILL.md usan opciones que los scripts aceptan', () => {
  const context = read('scripts/context.mjs');
  const build = read('scripts/build.mjs');
  assert.match(context, /'--base'/);
  assert.match(context, /'--out'/);
  assert.match(build, /'--repo'/);
  assert.match(build, /'--out'/);
  assert.match(skillMd, /context\.mjs \$ARGUMENTS/, 'la Skill pasa los argumentos del usuario');
});

test('la Skill no pide ni inventa normas externas en sus instrucciones', () => {
  assert.match(skillMd, /No inventes normas/);
  assert.match(read('references/analysis-guide.md'), /No inventes normas/);
});

test('la guía de análisis cubre todas las partes del bloque study', () => {
  const guide = read('references/analysis-guide.md');
  for (const part of ['chronicle', 'map.flow', 'map.components', 'map.models', 'map.decisions', 'map.edgeCases', 'map.tests', 'teachings', 'snippet', 'No escribas URLs']) {
    assert.ok(guide.includes(part), `falta ${part}`);
  }
});

test('la guía de análisis cubre los cinco tipos de foco del esquema', () => {
  const guide = read('references/analysis-guide.md');
  for (const type of ['requirement-gap', 'decision', 'risk', 'change', 'test-gap']) {
    assert.ok(guide.includes(`\`${type}\``), `falta ${type}`);
  }
});
