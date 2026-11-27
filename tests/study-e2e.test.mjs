// Abre el HTML en Chrome sin interfaz y recorre el inicio y «El camino del Aprendiz». Se omite si no hay Chrome.
// Ejecutar con: node --test tests/   (o CHROME=/ruta/a/chrome para indicar el navegador)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtml } from '../.claude/skills/supervise/scripts/lib/build-html.mjs';

const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find((path) => existsSync(path));

const example = JSON.parse(readFileSync(new URL('../.claude/skills/supervise/examples/review.example.json', import.meta.url), 'utf8'));

const DRIVER = String.raw`
const results = [];
const check = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra === undefined ? '' : String(extra) });
window.addEventListener('error', (e) => check('sin errores de JavaScript', false, e.message));
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const go = async (hash) => { location.hash = hash; await wait(30); };

(async () => {
  try {
    // ---- Inicio ----
    check('inicio: visible al cargar', !$('#eq-landing').hidden && $('#eq-apprentice').hidden && $('#stage').hidden);
    check('inicio: dos caminos', $$('#eq-landing .eq-card').length === 2);
    check('inicio: nombre de la misión', text($('#eq-mission')) === 'Valle de la Autenticación');
    check('inicio: imágenes incrustadas', $$('#eq-landing img').every((img) => img.src.startsWith('data:image/webp')));

    // ---- Aprendiz ----
    await go('#aprendiz');
    check('aprendiz: vista visible', !$('#eq-apprentice').hidden && $('#eq-landing').hidden);
    check('aprendiz: tres secciones', $$('[data-eq-open]').length === 3);

    // ---- Crónica ----
    $('[data-eq-open="chronicle"]').click();
    check('crónica: se abre', $('#eq-chronicle').open);
    check('crónica: título', text($('#eq-chronicle-title')) === 'Valle de la Autenticación');
    check('crónica: formato en línea como código', $$('#eq-chronicle-text code').some((c) => c.textContent === 'fullName'));
    check('crónica: origen con rama y commit', text($('#eq-chronicle-source')).includes('feature/auth-sesiones → main') && text($('#eq-chronicle-source')).includes('a1b2c3d'));
    $('#eq-chronicle [data-eq-close]').click();
    check('crónica: se cierra', !$('#eq-chronicle').open);

    // ---- Mapa ----
    $('[data-eq-open="map"]').click();
    check('mapa: se abre con estado vacío', $('#eq-map').open && text($('#eq-map-content')).includes('Elige una sección'));
    check('mapa: seis opciones con icono', $$('.eq-map-option').length === 6 && $$('.eq-map-option svg').length === 6);
    const open = (key) => { $('.eq-map-option[data-key="' + key + '"]').click(); return $('#eq-map-content'); };

    let c = open('flow');
    check('flujo: pasos numerados con flechas', $$('.eq-flow-step', c).length === 5 && $$('.eq-flow-arrow', c).length === 4);
    check('flujo: opción marcada', $('.eq-map-option[data-key="flow"]').classList.contains('is-selected'));

    c = open('components');
    check('componentes: cuadrícula', $$('.eq-tile', c).length === 4 && text($('.eq-tile h3', c)) === 'rate_limit.py');

    c = open('models');
    check('modelos: campos', $$('.eq-fields code', c).map(text).join(',').includes('accessToken'));

    c = open('decisions');
    check('decisiones: lista', $$('.eq-note', c).length === 3);
    const link = $('.eq-ref-link', c);
    const path = $('.eq-ref-path', c);
    check('decisiones: referencia sin enlace', !link && path && text(path) === 'session/config.py:16-17', path && text(path));
    check('decisiones: enlace a GitHub fijado al commit', link && link.href === 'https://github.com/acme/acme-portal/blob/a1b2c3d/api/session/config.py#L16-L17', link && link.href);
    check('decisiones: el enlace abre en otra pestaña', link && link.target === '_blank' && link.rel.includes('noopener'));
    const toggle = $('.eq-ref-toggle', c);
    check('decisiones: el código empieza plegado', toggle && $('.eq-code', c).hidden);
    toggle.click();
    check('decisiones: «Ver código» lo despliega con números de línea', !$('.eq-code', c).hidden && text($('.eq-ln i', c)) === '16' && text($('.eq-ln b', c)) === 'SESSION_BACKEND = "redis"');
    check('decisiones: sin snippet no hay botón de código', $$('.eq-note', c)[1].querySelector('.eq-ref-toggle') === null);

    c = open('edgeCases');
    check('casos límite: lista', $$('.eq-note', c).length === 3);

    c = open('tests');
    check('tests: nombre y casos', text($('.eq-note h3', c)).startsWith('test_session.py') && text($('.eq-cases', c)) === '1 caso');

    $('#eq-map [data-eq-close]').click();

    // ---- Enseñanzas ----
    $('[data-eq-open="teachings"]').click();
    const eyebrow = () => text($('#eq-teaching-eyebrow'));
    const img = () => $('#eq-teaching-img').src;
    check('enseñanzas: se abre en la primera', $('#eq-teachings').open && text($('#eq-teaching-count')) === '1 / 3');
    check('enseñanzas: sin el rótulo repetido', !$('#eq-teachings').textContent.includes('Las enseñanzas del maestro'));
    check('enseñanzas: imagen del maestro incrustada', img().startsWith('data:image/webp'));
    check('enseñanzas: la primera dice «Recuerda, pequeño...»', eyebrow() === 'Recuerda, pequeño...');
    const img1 = img();
    $('#eq-teaching-next').click();
    check('enseñanzas: siguiente', text($('#eq-teaching-count')) === '2 / 3' && text($('#eq-teaching-title')) === 'El límite de intentos es por proceso');
    check('enseñanzas: la segunda dice «No olvides...» y cambia de imagen', eyebrow() === 'No olvides...' && img() !== img1);
    check('enseñanzas: referencia con código plegable', $('#eq-teaching-ref .eq-ref-toggle') !== null);
    const img2 = img();
    $('#eq-teaching-next').click();
    check('enseñanzas: la tercera dice «Debes saber...»', eyebrow() === 'Debes saber...' && img() !== img2 && img() !== img1);
    $('#eq-teaching-next').click();
    check('enseñanzas: siguiente da la vuelta a la primera', text($('#eq-teaching-count')) === '1 / 3' && eyebrow() === 'Recuerda, pequeño...' && img() === img1);
    $('#eq-teaching-prev').click();
    check('enseñanzas: anterior da la vuelta a la última', text($('#eq-teaching-count')) === '3 / 3' && eyebrow() === 'Debes saber...');
    $('#eq-teaching-prev').click();
    check('enseñanzas: anterior conserva imagen y sobretítulo de cada píldora', text($('#eq-teaching-count')) === '2 / 3' && img() === img2 && eyebrow() === 'No olvides...');
    $('#eq-teachings [data-eq-close]').click();
    $('[data-eq-open="teachings"]').click();
    check('enseñanzas: al reabrir empieza en la primera', text($('#eq-teaching-count')) === '1 / 3');
    $('#eq-teachings [data-eq-close]').click();

    // ---- Navegación ----
    await go('#desafio');
    check('desafío: muestra el mapa de misiones', !$('#stage').hidden && $('#eq-apprentice').hidden);
    await go('#inicio');
    check('inicio: se vuelve desde el desafío', !$('#eq-landing').hidden && $('#stage').hidden);
  } catch (e) {
    check('el guion no debe fallar', false, e && e.stack || e);
  }
  const pre = document.createElement('pre');
  pre.id = 'e2e-out';
  pre.textContent = JSON.stringify(results);
  document.body.append(pre);
})();
`;

function runInChrome(review, hash = '') {
  const dir = mkdtempSync(join(tmpdir(), 'supervise-study-'));
  const page = join(dir, 'review.html');
  writeFileSync(page, buildHtml(review).replace('</body>', () => `<script>${DRIVER}</script>\n</body>`));
  const run = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=8000', '--dump-dom', `file://${page}${hash}`], { encoding: 'utf8', timeout: 90000 });
  const match = run.stdout.match(/<pre id="e2e-out">([\s\S]*?)<\/pre>/);
  assert.ok(match, `el guion no terminó. stderr: ${run.stderr.slice(-400)}`);
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(unescape(match[1]));
}

const skip = !CHROME && 'Chrome no encontrado (indica uno con CHROME=...)';

const LINK_CHECKS = { linked: 'decisiones: enlace a GitHub fijado al commit', plain: 'decisiones: referencia sin enlace' };

test('recorrido del estudio en Chrome: inicio, crónica, mapa y enseñanzas', { skip }, () => {
  const results = runInChrome(example);
  const failed = results.filter((r) => !r.pass && r.name !== LINK_CHECKS.plain);
  assert.deepEqual(failed, [], `fallan ${failed.length} de ${results.length} comprobaciones`);
  assert.ok(results.length >= 30, `solo se ejecutaron ${results.length} comprobaciones`);
});

for (const [label, mutate] of [
  ['commit sin publicar', (s) => { s.published = false; }],
  ['cambios sin commitear', (s) => { s.dirty = true; }],
  ['sin remoto de GitHub', (s) => { delete s.repoUrl; delete s.published; }],
]) {
  test(`${label}: no hay enlace, se muestra la ruta`, { skip }, () => {
    const review = structuredClone(example);
    mutate(review.meta.source);
    const results = runInChrome(review);
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    assert.equal(byName[LINK_CHECKS.plain].pass, true, byName[LINK_CHECKS.plain].extra);
    assert.equal(byName['sin errores de JavaScript'], undefined, 'sin errores de JavaScript');
  });
}

function probe(review, script) {
  const dir = mkdtempSync(join(tmpdir(), 'supervise-study-'));
  const page = join(dir, 'review.html');
  const wrapped = String.raw`
    (async () => {
      const r = [];
      const $ = (s) => document.querySelector(s);
      const $$ = (s) => [...document.querySelectorAll(s)];
      const wait = (ms) => new Promise((x) => setTimeout(x, ms));
      try { ${script} } catch (e) { r.push(['el guion no debe fallar: ' + e.message, false]); }
      const pre = document.createElement('pre'); pre.id = 'e2e-out'; pre.textContent = JSON.stringify(r); document.body.append(pre);
    })();`;
  writeFileSync(page, buildHtml(review).replace('</body>', () => `<script>${wrapped}</script>\n</body>`));
  const run = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=5000', '--dump-dom', `file://${page}`], { encoding: 'utf8', timeout: 90000 });
  const match = run.stdout.match(/<pre id="e2e-out">([\s\S]*?)<\/pre>/);
  assert.ok(match, `el guion no terminó. stderr: ${run.stderr.slice(-400)}`);
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

test('una sección del mapa que no aplica queda bloqueada', { skip }, () => {
  const review = structuredClone(example);
  review.study.map.edgeCases = [];
  const results = probe(review, String.raw`
    location.hash = '#aprendiz'; await wait(30);
    $('[data-eq-open="map"]').click();
    const btn = $('.eq-map-option[data-key="edgeCases"]');
    r.push(['las seis opciones siguen visibles', $$('.eq-map-option').length === 6]);
    r.push(['botón desactivado', btn.disabled && btn.classList.contains('is-empty')]);
    r.push(['dice que no aplica', btn.textContent.includes('No aplica en este cambio')]);
    btn.click();
    r.push(['no abre nada', $('#eq-map-content').textContent.includes('Elige una sección')]);
    r.push(['las demás funcionan', !$('.eq-map-option[data-key="decisions"]').disabled]);
  `);
  assert.deepEqual(results.filter(([, ok]) => !ok), []);
});

test('con una sola enseñanza no hay botones de navegación', { skip }, () => {
  const review = structuredClone(example);
  review.study.teachings = review.study.teachings.slice(0, 1);
  const results = probe(review, String.raw`
    location.hash = '#aprendiz'; await wait(30);
    $('[data-eq-open="teachings"]').click();
    r.push(['sin anterior ni siguiente', $('#eq-teaching-prev').hidden && $('#eq-teaching-next').hidden]);
    r.push(['contador 1 / 1', $('#eq-teaching-count').textContent === '1 / 1']);
  `);
  assert.deepEqual(results.filter(([, ok]) => !ok), []);
});

test('una revisión 1.0 sin study: el aprendiz queda deshabilitado y el desafío funciona', { skip }, () => {
  const review = structuredClone(example);
  review.schemaVersion = '1.0';
  delete review.study;
  const dir = mkdtempSync(join(tmpdir(), 'supervise-study-'));
  const page = join(dir, 'review.html');
  const probe = String.raw`
    (async () => {
      const r = [];
      const $ = (s) => document.querySelector(s);
      r.push(['inicio visible', !$('#eq-landing').hidden]);
      r.push(['aprendiz deshabilitado', $('#eq-go-apprentice').getAttribute('aria-disabled') === 'true' && !$('#eq-go-apprentice').hasAttribute('href')]);
      location.hash = '#aprendiz'; await new Promise((x) => setTimeout(x, 30));
      r.push(['#aprendiz vuelve al inicio', !$('#eq-landing').hidden && $('#eq-apprentice').hidden]);
      location.hash = '#desafio'; await new Promise((x) => setTimeout(x, 30));
      r.push(['desafío visible', !$('#stage').hidden && document.querySelectorAll('.level').length === 3]);
      const pre = document.createElement('pre'); pre.id = 'e2e-out'; pre.textContent = JSON.stringify(r); document.body.append(pre);
    })();`;
  writeFileSync(page, buildHtml(review).replace('</body>', () => `<script>${probe}</script>\n</body>`));
  const run = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=5000', '--dump-dom', `file://${page}`], { encoding: 'utf8', timeout: 90000 });
  const match = run.stdout.match(/<pre id="e2e-out">([\s\S]*?)<\/pre>/);
  assert.ok(match, `el guion no terminó. stderr: ${run.stderr.slice(-400)}`);
  const results = JSON.parse(match[1].replace(/&quot;/g, '"'));
  assert.deepEqual(results.filter(([, ok]) => !ok), []);
});
