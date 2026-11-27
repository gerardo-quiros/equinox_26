// Abre el HTML generado en Chrome sin interfaz y recorre los tres niveles. Se omite si no hay Chrome.
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

// Guion que se ejecuta dentro de la página: usa solo clics y eventos, como una persona.
const DRIVER = String.raw`
const results = [];
const check = (name, pass, extra) => results.push({ name, pass: !!pass, extra: extra === undefined ? '' : String(extra) });
window.addEventListener('error', (e) => check('sin errores de JavaScript', false, e.message));
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const body = $('#level-body');
const level = (k) => $('.level[data-level="' + k + '"]');
const slot = (n) => $('[data-slot="' + n + '"]', body);
const option = (v) => $('input[value="' + v + '"]', body);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// dialog.close() avisa de forma asíncrona: se espera un instante antes de mirar el mapa.
const closed = () => wait(30);
const type = (ta, text) => { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); };
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

(async () => {
  try {
    check('mapa: tres niveles por explorar', $$('.level').length === 3 && $$('.level').every((l) => l.dataset.state === 'pending'));
    check('mapa: progreso inicial', text($('#bar-text')).startsWith('0 de 3'));
    check('mapa: misión', text($('#mission-name')) === 'Valle de la Autenticación');
    check('mapa: el final no se ve', $('#finale').hidden);

    // ---- Nivel 1: flashcards ----
    level('flashcards').click();
    check('flashcards: se abre el modal', $('#level').open);
    check('flashcards: empieza por la cara delantera', !slot('front-face').hidden && slot('back-face').hidden);
    check('flashcards: pregunta', text(slot('front')).startsWith('¿Dónde guarda el cliente web'));
    check('flashcards: la primera categoría', text(slot('chip')) === 'Detalle de código');
    for (let i = 0; i < 8; i++) {
      $('[data-focus="flip"]', body).click();
      if (i === 0) {
        check('flashcards: se voltea', slot('front-face').hidden && !slot('back-face').hidden);
        check('flashcards: titular de la respuesta', text(slot('title')) === 'En localStorage, con dos claves');
        check('flashcards: evidencia con número de línea', text($('.ev .ln i', body)) === '42' && text($('.ev-h', body)).includes('líneas 42–43'));
        check('flashcards: el código se pinta como texto', !body.innerHTML.includes('<img'));
      }
      if (i === 3) {
        $('[data-focus="flip"]', body).click(); // volver a la pregunta
        check('flashcards: se vuelve a la pregunta', !slot('front-face').hidden);
        $('[data-focus="flip"]', body).click();
      }
      if (i < 7) $('[data-action="next"]', body).click();
    }
    check('flashcards: última tarjeta ofrece terminar', text(slot('next-text')) === 'Terminar nivel');
    $('[data-action="next"]', body).click();
    check('flashcards: terminar cierra el modal', !$('#level').open);
    await closed();
    check('flashcards: nivel conquistado', level('flashcards').dataset.state === 'done');
    check('mapa: 33 %', text($('#bar-text')).startsWith('1 de 3 conquistadas (33 %)'));

    // ---- Nivel 2: test ----
    level('quiz').click();
    check('test: título de la pregunta', text(slot('title')) === 'Dónde guardar el token de refresco');
    check('test: letras en mayúsculas', $$('.letter', body).map(text).join('') === 'ABC');
    check('test: confirmar desactivado sin elegir', slot('primary').disabled);
    option('c').click();
    check('test: elegir activa confirmar', !slot('primary').disabled);
    slot('primary').click();
    check('test: opción incorrecta marcada y bloqueada', option('c').disabled && option('c').closest('.opt').classList.contains('bad'));
    check('test: explica por qué es incorrecta', $('.fb.bad', body) && text(slot('fb-body')).includes('sessionStorage'));
    check('test: no se avanza sin acertar', slot('primary').disabled);
    check('test: la respuesta correcta no se desvela', !option('a').closest('.opt').classList.contains('good'));
    option('a').click();
    slot('primary').click();
    check('test: acierto muestra la explicación', $('.fb.good', body) && text(slot('fb-body')).includes('HttpOnly'));
    check('test: ver por qué disponible', !slot('why').hidden);
    check('test: evidencia oculta al principio', $$('.ev', body).length === 0);
    slot('why').click();
    check('test: ver por qué despliega la evidencia', $$('.ev', body).length >= 1);
    $('[data-action="primary"]', body).click(); // siguiente
    check('test: pregunta 2 de 4', text(slot('count')) === 'Pregunta 2 de 4');
    option('b').click(); slot('primary').click(); slot('primary').click();
    check('test: pregunta 3 es múltiple', text(slot('count')) === 'Pregunta 3 de 4' && !slot('kind').hidden && !slot('info').hidden);
    check('test: pide 2 respuestas', text(slot('need')) === '2' && text(slot('counter')) === '0 / 2');
    option('a').click(); option('b').click();
    check('test: al llegar al máximo se bloquean las demás', option('c').disabled && option('d').disabled);
    slot('primary').click();
    check('test: múltiple parcial es incorrecto', $('.fb.bad', body) !== null);
    check('test: solo se descarta la errónea', option('a').disabled && option('b').checked && !option('b').disabled);
    check('test: contador conserva lo acertado', text(slot('counter')) === '1 / 2');
    check('test: confirmar desactivado hasta completar', slot('primary').disabled);
    option('c').click(); slot('primary').click();
    check('test: múltiple resuelta', $('.fb.good', body) !== null);
    slot('primary').click();
    option('b').click(); slot('primary').click();
    check('test: última pregunta ofrece terminar', text(slot('primary-text')) === 'Terminar nivel');
    slot('primary').click();
    await closed();
    check('test: nivel conquistado', !$('#level').open && level('quiz').dataset.state === 'done');

    // ---- Nivel 3: escenarios ----
    level('scenarios').click();
    check('escenarios: empieza escribiendo', text(slot('title')) === 'Redis se reinicia en hora punta');
    check('escenarios: no hay respuesta de referencia', !body.textContent.includes('Respuesta del agente'));
    type(slot('answer'), 'Fallan las peticiones y se pierden las sesiones.\nActivaría persistencia.');
    check('escenarios: cuenta palabras', text(slot('words')) === '10 palabras');
    check('escenarios: borrador guardado', !slot('saved').hidden);
    check('escenarios: el punto pasa a verde', $('.dots i', body).classList.contains('on'));
    $('[data-action="evidence"]', body).click();
    check('escenarios: ver en el código', $$('.ev', body).length === 1);
    $('[data-action="next"]', body).click();
    check('escenarios: segundo escenario', text(slot('count')) === 'Escenario 2 de 2');
    check('escenarios: último ofrece revisar y copiar', text(slot('next-text')) === 'Revisar y copiar');
    $('[data-action="next"]', body).click();
    check('escenarios: resumen con un escenario sin responder', $$('.sum li', body).length === 2 && $$('.sum li.empty', body).length === 1);
    check('escenarios: avisa de que falta uno', text(slot('copy-hint')).includes('sin respuesta'));
    $('[data-action="edit"][data-index="1"]', body).click();
    check('escenarios: editar vuelve al escenario', text(slot('count')) === 'Escenario 2 de 2');
    type(slot('answer'), 'Devolvería name y fullName durante un mes.');
    $('[data-action="next"]', body).click();
    check('escenarios: resumen completo', $$('.sum li.empty', body).length === 0 && text(slot('count')) === '2 de 2 respondidos');
    $('[data-action="copy"]', body).click();
    await wait(2200);
    const copied = $('.btn.done', body) !== null;
    const manual = $('.manual', body);
    check('escenarios: copia al portapapeles o muestra el texto', copied || (manual && !manual.hidden), copied ? 'portapapeles' : 'alternativa manual');
    if (manual && !manual.hidden) {
      check('escenarios: texto manual completo', manual.value.includes('## Escenario 1: Redis se reinicia') && manual.value.includes('Devolvería name y fullName'));
      check('escenarios: texto sin respuesta del agente', !manual.value.includes('Respuesta del agente'));
    }
    $('#level-close').click();
    await closed();
    check('escenarios: nivel conquistado', level('scenarios').dataset.state === 'done');

    // ---- Final ----
    check('final: mensaje visible', !$('#finale').hidden && text($('#finale h2')) === '¡Has finalizado la revisión!');
    check('final: aparece el maestro Padi', $('#img-padi').hidden && !$('#img-master').hidden && text($('#hero-label')).startsWith('Maestro Padi'));
    check('final: progreso 100 %', text($('#bar-text')).startsWith('3 de 3 conquistadas (100 %)'));

    // ---- Reabrir un nivel ya conquistado ----
    level('quiz').click();
    check('reabrir test: empieza en la primera, ya resuelta', text(slot('count')) === 'Pregunta 1 de 4' && $('.fb.good', body) !== null);
    $('#level-close').click();
    await closed();
  } catch (e) {
    check('el guion no debe fallar', false, e && e.stack || e);
  }
  const pre = document.createElement('pre');
  pre.id = 'e2e-out';
  pre.textContent = JSON.stringify(results);
  document.body.append(pre);
})();
`;

test('recorrido completo en Chrome: flashcards, test, escenarios y final', { skip: !CHROME && 'Chrome no encontrado (indica uno con CHROME=...)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'supervise-e2e-'));
  const page = join(dir, 'review.html');
  writeFileSync(page, buildHtml(example).replace('</body>', () => `<script>${DRIVER}</script>\n</body>`));

  const run = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=8000', '--dump-dom', `file://${page}`], { encoding: 'utf8', timeout: 90000 });
  const match = run.stdout.match(/<pre id="e2e-out">([\s\S]*?)<\/pre>/);
  assert.ok(match, `el guion no terminó. stderr: ${run.stderr.slice(-400)}`);
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const results = JSON.parse(unescape(match[1]));

  const failed = results.filter((r) => !r.pass);
  assert.deepEqual(failed, [], `fallan ${failed.length} de ${results.length} comprobaciones`);
  assert.ok(results.length >= 55, `solo se ejecutaron ${results.length} comprobaciones`);
});
