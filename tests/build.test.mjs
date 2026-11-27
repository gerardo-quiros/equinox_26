// Ejecutar con: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHtml } from '../.claude/skills/supervise/scripts/lib/build-html.mjs';

const example = JSON.parse(readFileSync(new URL('../.claude/skills/supervise/examples/review.example.json', import.meta.url), 'utf8'));
// Lo que haría que la página dependiera de internet (vacío si es autocontenida).
function findExternalReferences(html) {
  const withoutData = html.replace(/<script type="application\/json"[^>]*>[\s\S]*?<\/script>/, '');
  const rules = [
    [/\s(?:src|href|action|poster)\s*=\s*["']?(?:https?:)?\/\//i, 'atributo src/href con URL externa'],
    [/url\(\s*["']?(?:https?:)?\/\//i, 'url() externa en el CSS'],
    [/@import\b/i, '@import'],
    [/<link\b/i, 'etiqueta <link>'],
    [/<script\b[^>]*\bsrc\s*=/i, 'script externo'],
  ];
  return rules.filter(([pattern]) => pattern.test(withoutData)).map(([, label]) => label);
}

const dataBlock = (html) => html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1];

test('el HTML es autocontenido: sin recursos externos', () => {
  const html = buildHtml(example);
  assert.deepEqual(findExternalReferences(html), []);
  assert.equal(/asset:[\w./-]+/.test(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), false, 'ningún asset: sin sustituir');
});

test('incrusta fuentes e imágenes y pesa menos de 1 MB', () => {
  const html = buildHtml(example);
  assert.match(html, /data:font\/woff2;base64,/);
  assert.match(html, /data:image\/webp;base64,/);
  assert.ok(Buffer.byteLength(html) < 1024 * 1024, `pesa ${Buffer.byteLength(html)} bytes`);
});

test('incluye las vistas de estudio con imágenes WebP y abre en el inicio', () => {
  const html = buildHtml(example);
  assert.match(html, /data:image\/webp;base64,/);
  assert.match(html, /id="eq-landing"/);
  assert.match(html, /<main class="stage" id="stage" hidden>/, 'el mapa de misiones empieza oculto');
  assert.equal(/<!--@[\w-]+-->/.test(html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), false, 'ningún marcador sin sustituir');
});

test('un marcador dentro de los datos no se sustituye', () => {
  const tricky = structuredClone(example);
  tricky.study.chronicle.text = 'Texto con <!--@study-script--> dentro';
  assert.equal(JSON.parse(dataBlock(buildHtml(tricky))).study.chronicle.text, 'Texto con <!--@study-script--> dentro');
});

test('las plantillas de estudio no usan innerHTML', () => {
  const js = readFileSync(new URL('../.claude/skills/supervise/templates/study.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // sin comentarios
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js), false);
});

test('los datos viajan íntegros en el bloque JSON', () => {
  assert.deepEqual(JSON.parse(dataBlock(buildHtml(example))), example);
});

test('un texto malicioso no puede cerrar el script ni inyectar HTML', () => {
  const evil = structuredClone(example);
  evil.meta.title = '</script><img src=x onerror=alert(1)>';
  evil.meta.missionName = '<b>Misión</b> & "co"';
  evil.flashcards[0].front = '</script><script>alert(1)</script>';
  const html = buildHtml(evil);
  assert.equal(html.includes('</script><img'), false);
  assert.equal(html.includes('</script><script>alert(1)'), false);
  assert.match(html, /<title>&lt;b&gt;Misión&lt;\/b&gt; &amp; &quot;co&quot; · Supervise<\/title>/);
  assert.deepEqual(JSON.parse(dataBlock(html)), evil, 'el JSON se recupera igual');
});
