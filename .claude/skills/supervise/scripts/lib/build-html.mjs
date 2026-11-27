// Ensambla review.html a partir de review.json y de las plantillas de la Skill.
// Todo queda en un solo archivo: estilos, script, fuentes e imágenes incrustados, sin recursos externos.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const SKILL = new URL('../../', import.meta.url);
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };

const read = (relative) => readFileSync(new URL(relative, SKILL), 'utf8');

function dataUri(name) {
  const mime = MIME[extname(name)];
  if (!mime) throw new Error(`Tipo de recurso no soportado: ${name}`);
  return `data:${mime};base64,${readFileSync(new URL(`assets/${name}`, SKILL)).toString('base64')}`;
}

// «asset:nombre» (precedido de comillas o paréntesis) se sustituye por el recurso incrustado.
const inlineAssets = (text) => text.replace(/(["'(])asset:([\w./-]+)/g, (_, open, name) => open + dataUri(name));

const replaceAll = (text, marker, value) => text.split(marker).join(value);

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// El JSON va dentro de <script type="application/json">: se escapa «<» para que nada pueda cerrar la etiqueta.
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** @param {object} review review.json ya validado */
export function buildHtml(review) {
  const mission = review.meta.missionName ?? review.meta.title;

  const templates = ['flashcards', 'quiz', 'scenarios'].map((name) => read(`templates/${name}.html`)).join('\n');

  let html = read('templates/page.html');
  html = replaceAll(html, '<!--@title-->', escapeHtml(`${mission} · Supervise`));
  html = replaceAll(html, '<!--@styles-->', inlineAssets(read('templates/styles.css')));
  html = replaceAll(html, '<!--@templates-->', templates);
  html = replaceAll(html, '<!--@data-->', safeJson(review));
  html = replaceAll(html, '<!--@script-->', read('templates/app.js'));
  return inlineAssets(html);
}
