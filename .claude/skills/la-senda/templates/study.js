/* Equinox · inicio y fase de estudio («El camino del Aprendiz»).
   Lee review.study de #review-data y pinta siempre con textContent (nunca innerHTML).
   Las vistas se eligen con el hash: #inicio, #aprendiz, #desafio (el mapa de misiones de app.js). */
(() => {
  'use strict';

  const review = JSON.parse(document.getElementById('review-data').textContent);
  const study = review.study ?? null;
  const source = review.meta.source;

  /* ============ Utilidades ============ */

  const byId = (id) => document.getElementById(id);
  const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Formato permitido en los textos: `código` y **negrita**. Todo se inserta como texto.
  function inline(node, text) {
    node.replaceChildren();
    String(text).split(/(`[^`]+`|\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      if (part.startsWith('`')) node.append(el('code', '', part.slice(1, -1)));
      else if (part.startsWith('**')) node.append(el('strong', '', part.slice(2, -2)));
      else node.append(part);
    });
    return node;
  }

  function svgIcon(id) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `#eq-${id}`);
    svg.append(use);
    return svg;
  }

  /* ============ Referencias al código: ruta, enlace a GitHub y código plegable ============ */

  // Solo se enlaza si hay remoto de GitHub, el commit está publicado y no hay cambios sin commitear.
  const canLink = Boolean(source.repoUrl && source.published && !source.dirty);

  const shortPath = (file) => file.split('/').slice(-2).join('/');
  const lineSuffix = (lines) => (!lines ? '' : lines.start === lines.end ? `:${lines.start}` : `:${lines.start}-${lines.end}`);

  function githubUrl(ref) {
    const path = ref.file.split('/').map(encodeURIComponent).join('/');
    const anchor = !ref.lines ? '' : ref.lines.start === ref.lines.end ? `#L${ref.lines.start}` : `#L${ref.lines.start}-L${ref.lines.end}`;
    return `${source.repoUrl}/blob/${source.commit}/${path}${anchor}`;
  }

  function refBlock(ref) {
    const root = byId('eq-tpl-ref').content.cloneNode(true);
    const box = root.firstElementChild;
    const label = `${shortPath(ref.file)}${lineSuffix(ref.lines)}`;
    const link = slot(box, 'link');
    const path = slot(box, 'path');

    if (canLink) {
      link.href = githubUrl(ref);
      link.textContent = `↗ ${label}`;
      link.title = `${ref.file} en GitHub`;
      path.remove();
    } else {
      link.remove();
      path.textContent = label;
      path.title = source.repoUrl && !source.published ? `${ref.file} · commit sin publicar en GitHub` : ref.file;
    }

    const toggle = slot(box, 'toggle');
    const code = slot(box, 'code');
    if (!ref.snippet) {
      toggle.remove();
      code.remove();
      return box;
    }
    ref.snippet.replace(/\n+$/, '').split('\n').forEach((text, i) => {
      const row = el('div', 'eq-ln');
      row.append(el('i', '', ref.lines ? ref.lines.start + i : ''), el('b', '', text));
      code.append(row);
    });
    toggle.addEventListener('click', () => {
      code.hidden = !code.hidden;
      toggle.setAttribute('aria-expanded', String(!code.hidden));
      toggle.textContent = code.hidden ? '▸ Ver código' : '▾ Ocultar código';
    });
    return box;
  }

  /* ============ Vistas (inicio · aprendiz · desafío) ============ */

  const views = { inicio: byId('eq-landing'), aprendiz: byId('eq-apprentice'), desafio: byId('stage') };

  function route() {
    let name = location.hash.slice(1);
    if (!(name in views) || (name === 'aprendiz' && !study)) name = 'inicio';
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    Object.entries(views).forEach(([key, node]) => { node.hidden = key !== name; });
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }

  byId('eq-mission').textContent = review.meta.missionName ?? review.meta.title;

  if (!study) {
    const card = byId('eq-go-apprentice');
    card.removeAttribute('href');
    card.classList.add('eq-disabled');
    card.setAttribute('aria-disabled', 'true');
    card.querySelector('.eq-card-caption').textContent = 'Sin fase de estudio en esta revisión';
  }

  window.addEventListener('hashchange', route);
  route();

  if (!study) return;

  /* ============ Diálogos ============ */

  const dialogs = { chronicle: byId('eq-chronicle'), map: byId('eq-map'), teachings: byId('eq-teachings') };

  document.querySelectorAll('.eq-dialog').forEach((dialog) => {
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // clic en el fondo
    dialog.querySelectorAll('[data-eq-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  });

  document.querySelectorAll('[data-eq-open]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.eqOpen;
    if (key === 'teachings') { teachingIndex = 0; renderTeaching(); }
    dialogs[key].showModal();
  }));

  /* ============ La crónica ============ */

  byId('eq-chronicle-title').textContent = study.chronicle.title;
  inline(byId('eq-chronicle-text'), study.chronicle.text);
  const stats = review.meta.stats;
  byId('eq-chronicle-source').textContent = [
    `${source.head} → ${source.base}`,
    `commit ${source.commit.slice(0, 7)}${source.dirty ? ' (con cambios sin commitear)' : ''}`,
    stats ? `${stats.filesChanged} archivos · +${stats.additions} −${stats.deletions}` : null,
  ].filter(Boolean).join(' · ');

  /* ============ El mapa del conocimiento ============ */

  const SECTIONS = [
    { key: 'flow', title: 'Execution Flow', subtitle: 'El recorrido de la ejecución', render: renderFlow },
    { key: 'components', title: 'Components', subtitle: 'Las piezas del sistema', render: (items) => renderCards(items, 'role') },
    { key: 'models', title: 'Data model', subtitle: 'Los modelos de datos', render: (items) => renderCards(items, 'role') },
    { key: 'decisions', title: 'Key decisions', subtitle: 'Las decisiones importantes', render: (items) => renderNotes(items, '✦') },
    { key: 'edgeCases', title: 'Edge cases', subtitle: 'Los casos límite', render: (items) => renderNotes(items, '!') },
    { key: 'tests', title: 'Test coverage', subtitle: 'Lo que cubren las pruebas', render: renderTests },
  ];

  const countLabel = (n) => `${n} ${n === 1 ? 'elemento' : 'elementos'}`;
  const options = byId('eq-map-options');
  const content = byId('eq-map-content');

  SECTIONS.forEach((section) => {
    const items = study.map[section.key];
    const button = el('button', `eq-map-option eq-opt-${section.key}`);
    button.type = 'button';
    button.dataset.key = section.key;
    const icon = el('span', 'eq-map-icon');
    icon.append(svgIcon(section.key));
    const copy = el('span', 'eq-map-copy');
    copy.append(el('strong', '', section.title), el('small', '', items.length ? `${section.subtitle} · ${countLabel(items.length)}` : 'No aplica en este cambio'));
    button.append(icon, copy, el('span', 'eq-map-arrow', items.length ? '›' : ''));
    options.append(button);

    // Sección vacía: la skill ha decidido que no aplica. Se ve atenuada y no se puede abrir.
    if (!items.length) {
      button.disabled = true;
      button.classList.add('is-empty');
      button.title = `${section.title}: no aplica en este cambio`;
      return;
    }

    button.addEventListener('click', () => {
      options.querySelectorAll('.eq-map-option').forEach((b) => b.classList.toggle('is-selected', b === button));
      const heading = el('div', 'eq-detail-head');
      heading.append(el('h2', '', section.title), el('p', '', section.subtitle));
      const detail = el('div', 'eq-detail');
      detail.append(heading, section.render(items));
      content.replaceChildren(detail);
      content.scrollTop = 0;
    });
  });

  function withRef(node, item) {
    if (item.ref) node.append(refBlock(item.ref));
    return node;
  }

  function renderFlow(items) {
    const list = el('ol', 'eq-flow');
    items.forEach((step, i) => {
      const li = el('li', 'eq-flow-step');
      const box = el('div', 'eq-flow-box');
      box.append(el('span', 'eq-flow-n', i + 1), el('strong', '', step.label), inline(el('small'), step.detail));
      li.append(withRef(box, step));
      if (i < items.length - 1) li.append(el('span', 'eq-flow-arrow', '↓'));
      list.append(li);
    });
    return list;
  }

  function renderCards(items, tagKey) {
    const grid = el('div', 'eq-grid');
    items.forEach((item) => {
      const card = el('article', 'eq-tile');
      card.append(el('span', 'eq-tag', item[tagKey]), el('h3', '', item.name), inline(el('p'), item.detail));
      if (item.fields?.length) {
        const fields = el('div', 'eq-fields');
        item.fields.forEach((f) => fields.append(el('code', '', f)));
        card.append(fields);
      }
      grid.append(withRef(card, item));
    });
    return grid;
  }

  function renderNotes(items, marker) {
    const list = el('div', 'eq-notes eq-edge-notes');
    items.forEach((item) => {
      const note = el('article', 'eq-note');
      const body = el('div');
      body.append(el('h3', '', item.title), inline(el('p'), item.detail));
      withRef(body, item);
      note.append(el('span', 'eq-note-marker', marker), body);
      list.append(note);
    });
    return list;
  }

  function renderTests(items) {
    const list = el('div', 'eq-notes eq-test-notes');
    items.forEach((item) => {
      const note = el('article', 'eq-note');
      const body = el('div');
      const title = el('h3', '', item.name);
      if (item.cases) title.append(el('span', 'eq-cases', `${item.cases} ${item.cases === 1 ? 'caso' : 'casos'}`));
      body.append(title, inline(el('p'), item.detail));
      withRef(body, item);
      note.append(el('span', 'eq-note-marker', '✓'), body);
      list.append(note);
    });
    return list;
  }

  /* ============ Las enseñanzas del maestro ============ */

  // Imagen y sobretítulo van en orden según la posición de la píldora (1 → maestro1, 2 → maestro2…), en ciclo.
  const MASTER_IMAGES = [...byId('eq-master-images').content.querySelectorAll('img')].map((img) => img.getAttribute('src'));
  const EYEBROWS = ['Recuerda, pequeño...', 'No olvides...', 'Debes saber...'];
  const total = study.teachings.length;
  let teachingIndex = 0;

  function renderTeaching() {
    const t = study.teachings[teachingIndex];
    byId('eq-teaching-img').src = MASTER_IMAGES[teachingIndex % MASTER_IMAGES.length];
    byId('eq-teaching-eyebrow').textContent = EYEBROWS[teachingIndex % EYEBROWS.length];
    byId('eq-teaching-title').textContent = t.title;
    inline(byId('eq-teaching-text'), t.text);
    byId('eq-teaching-ref').replaceChildren(...(t.ref ? [refBlock(t.ref)] : []));
    byId('eq-teaching-count').textContent = `${teachingIndex + 1} / ${total}`;
    byId('eq-teaching-prev').hidden = total < 2;
    byId('eq-teaching-next').hidden = total < 2;
  }

  // Los dos botones dan la vuelta: de la última se pasa a la primera y viceversa.
  const step = (delta) => { teachingIndex = (teachingIndex + delta + total) % total; renderTeaching(); };
  byId('eq-teaching-prev').addEventListener('click', () => step(-1));
  byId('eq-teaching-next').addEventListener('click', () => step(1));
})();
