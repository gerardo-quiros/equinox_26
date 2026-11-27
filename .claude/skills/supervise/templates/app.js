/* Supervise · comportamiento de la página.
   Lee los datos de #review-data y pinta siempre con textContent (nunca innerHTML). */
(() => {
  'use strict';

  const review = JSON.parse(document.getElementById('review-data').textContent);

  // Caracteres mínimos para dar un escenario por respondido (pendiente de decidir).
  const MIN_ANSWER_CHARS = 1;

  /* ============ 1. Utilidades ============ */

  const byId = (id) => document.getElementById(id);
  const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`);
  const clone = (templateId) => byId(templateId).content.cloneNode(true);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
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

  const paragraph = (text) => inline(el('p'), text);
  const wordsLabel = (text) => { const n = (text.trim().match(/\S+/g) || []).length; return `${n} ${n === 1 ? 'palabra' : 'palabras'}`; };

  function evidenceBlock(ev) {
    const box = el('div', 'ev');
    const range = !ev.lines ? '' : ev.lines.start === ev.lines.end ? `línea ${ev.lines.start}` : `líneas ${ev.lines.start}–${ev.lines.end}`;
    const head = el('div', 'ev-h');
    head.append(el('span', '', ev.file), el('span', '', range));
    box.append(head);

    const numbered = ev.lines && ev.kind !== 'diff'; // en un diff las líneas del fragmento no coinciden con las del archivo
    ev.snippet.replace(/\n+$/, '').split('\n').forEach((text, i) => {
      const n = numbered ? ev.lines.start + i : null;
      const row = el('div', 'ln');
      row.append(el('i', '', n === null ? '' : n), el('b', '', text));
      box.append(row);
    });
    if (ev.note) box.append(el('p', 'ev-note', ev.note));
    return box;
  }

  function renderDots(box, dots, label) {
    box.setAttribute('aria-label', label);
    box.replaceChildren(...dots.map((d) => el('i', [d.on && 'on', d.cur && 'cur'].filter(Boolean).join(' '))));
  }

  /* ============ 2. Estado (solo en memoria; los borradores de escenarios, en localStorage) ============ */

  const STORAGE_KEY = `supervise:${review.meta.reviewId}:scenarios`;

  function loadDrafts() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return Object.fromEntries(review.scenarios.filter((s) => typeof saved[s.id] === 'string').map((s) => [s.id, saved[s.id]]));
    } catch { return {}; }
  }
  function saveDrafts(answers) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(answers)); return true; } catch { return false; }
  }

  const state = {
    flash: { index: 0, side: 'front', flipped: new Set() },
    quiz: { index: 0, byId: {} },
    scen: { index: 0, view: 'write', answers: loadDrafts(), evidence: false, saved: false, copied: false, copyText: null },
  };

  const isAnswered = (id) => (state.scen.answers[id] || '').trim().length >= MIN_ANSWER_CHARS;
  const quizState = (q) => (state.quiz.byId[q.id] ??= { selected: new Set(), locked: new Set(), solved: false, wrong: null, evidence: false });

  const LEVELS = {
    flashcards: { title: 'Flashcards', total: review.flashcards.length, unit: 'volteadas', ribbon: '✨ Modo flashcards ✨', ribbonClass: 'violet', done: () => state.flash.flipped.size },
    quiz: { title: 'Test con opciones', total: review.quiz.length, unit: 'resueltas', ribbon: '⚔ En encuentro ⚔', ribbonClass: 'red', done: () => review.quiz.filter((q) => quizState(q).solved).length },
    scenarios: { title: 'Escenarios', total: review.scenarios.length, unit: 'respondidos', ribbon: '⚔ Escenario final ⚔', ribbonClass: 'amber', done: () => review.scenarios.filter((s) => isAnswered(s.id)).length },
  };

  /* ============ 3. Mapa de misiones ============ */

  const STATE_LABEL = { pending: 'Por explorar', active: 'En encuentro', done: 'Conquistado' };

  function renderMap() {
    let conquered = 0;
    document.querySelectorAll('.level').forEach((button) => {
      const level = LEVELS[button.dataset.level];
      const done = level.done();
      const status = done === level.total ? 'done' : done > 0 ? 'active' : 'pending';
      if (status === 'done') conquered++;
      button.dataset.state = status;
      button.querySelector('.lvl-count').textContent = `${done} de ${level.total} ${level.unit}`;
      button.setAttribute('aria-label', `${level.title}. ${STATE_LABEL[status]}. ${done} de ${level.total} ${level.unit}`);
    });

    const percent = Math.round((conquered / 3) * 100);
    byId('mission-name').textContent = review.meta.missionName ?? review.meta.title;
    byId('bar-fill').style.width = `${percent}%`;
    byId('bar').setAttribute('aria-valuenow', conquered);
    byId('bar-text').textContent = `${conquered} de 3 conquistadas (${percent} %)`;

    // Al conquistar los tres niveles, el maestro Padi sustituye a Padi
    const finished = conquered === 3;
    byId('finale').hidden = !finished;
    byId('stage').classList.toggle('finished', finished);
    byId('img-padi').hidden = finished;
    byId('img-master').hidden = !finished;
    byId('hero-label').textContent = finished ? 'Maestro Padi · Revisión completada' : 'Padi · Guardián de PR';
  }

  /* ============ 4. Modal de nivel ============ */

  const dialog = byId('level');
  const body = byId('level-body');
  let current = null; // 'flashcards' | 'quiz' | 'scenarios'

  const views = { flashcards: viewFlashcards, quiz: viewQuiz, scenarios: viewScenarios };

  // Repinta el nivel actual conservando, si se puede, el foco y el scroll.
  function render({ top = false, focus } = {}) {
    const keep = focus ?? document.activeElement?.dataset?.focus;
    const scroll = body.scrollTop;
    body.replaceChildren(views[current]());
    body.scrollTop = top ? 0 : scroll;
    if (keep) body.querySelector(`[data-focus="${keep}"]`)?.focus({ preventScroll: true });
  }

  function openLevel(key) {
    current = key;
    const level = LEVELS[key];
    byId('level-ribbon').textContent = level.ribbon;
    byId('level-ribbon').className = `ribbon ${level.ribbonClass}`;
    dialog.setAttribute('aria-label', level.title);

    if (key === 'flashcards') state.flash.side = 'front';
    if (key === 'quiz') state.quiz.index = Math.max(0, review.quiz.findIndex((q) => !quizState(q).solved));
    if (key === 'scenarios') {
      const first = review.scenarios.findIndex((s) => !isAnswered(s.id));
      Object.assign(state.scen, { view: first === -1 ? 'summary' : 'write', index: Math.max(0, first), evidence: false, copied: false, copyText: null });
    }

    dialog.showModal();
    const focus = key === 'flashcards' ? 'flip' : key === 'scenarios' && state.scen.view === 'write' ? 'answer' : undefined;
    render({ top: true, focus });
  }

  // Cerrar con nuestros botones actualiza el mapa al momento; el evento «close» cubre la tecla Esc.
  function closeLevel() {
    dialog.close();
    current = null;
    renderMap();
  }

  /* ============ 5. Nivel 01 · flashcards ============ */

  function viewFlashcards() {
    const s = state.flash;
    const items = review.flashcards;
    const card = items[s.index];
    const root = clone('tpl-flashcards');
    const back = s.side === 'back';
    const last = s.index === items.length - 1;

    slot(root, 'count').textContent = `Tarjeta ${s.index + 1} de ${items.length}`;
    inline(slot(root, 'front'), card.front);
    slot(root, 'title').textContent = card.title;
    inline(slot(root, 'back'), card.back);
    slot(root, 'evidence').replaceChildren(...card.evidence.map(evidenceBlock));

    slot(root, 'front-face').hidden = back;
    slot(root, 'back-face').hidden = !back;
    slot(root, 'flip-text').textContent = back ? 'Ver pregunta' : 'Voltear tarjeta';

    renderDots(slot(root, 'dots'), items.map((c, i) => ({ on: s.flipped.has(c.id), cur: i === s.index })), `Tarjetas volteadas: ${s.flipped.size} de ${items.length}`);
    slot(root, 'prev').disabled = s.index === 0;
    slot(root, 'next-text').textContent = !last ? 'Siguiente' : s.flipped.size === items.length ? 'Terminar nivel' : 'Salir';
    return root;
  }

  const flash = {
    flip() {
      const s = state.flash;
      s.side = s.side === 'front' ? 'back' : 'front';
      if (s.side === 'back') s.flipped.add(review.flashcards[s.index].id);
      render({ focus: 'flip' });
    },
    prev() {
      const s = state.flash;
      if (s.index === 0) return;
      s.index--; s.side = 'front';
      render({ top: true, focus: 'flip' });
    },
    next() {
      const s = state.flash;
      if (s.index === review.flashcards.length - 1) return closeLevel();
      s.index++; s.side = 'front';
      render({ top: true, focus: 'flip' });
    },
  };

  /* ============ 6. Nivel 02 · test ============ */

  const currentQuestion = () => review.quiz[state.quiz.index];

  function viewQuiz() {
    const q = currentQuestion();
    const qs = quizState(q);
    const multiple = q.kind === 'multiple';
    const need = q.correct.length;
    const last = state.quiz.index === review.quiz.length - 1;
    const root = clone('tpl-quiz');

    slot(root, 'count').textContent = `Pregunta ${state.quiz.index + 1} de ${review.quiz.length}`;
    slot(root, 'kind').hidden = !multiple;
    slot(root, 'title').textContent = q.title;
    inline(slot(root, 'prompt'), q.prompt);

    slot(root, 'info').hidden = !multiple;
    slot(root, 'need').textContent = need;
    slot(root, 'counter').textContent = `${qs.selected.size} / ${need}`;

    slot(root, 'options').replaceChildren(...q.options.map((option) => quizOption(q, qs, option)));
    renderQuizFeedback(root, q, qs);
    if (qs.solved && qs.evidence) slot(root, 'evidence').replaceChildren(...q.evidence.map(evidenceBlock));

    const primary = slot(root, 'primary');
    if (qs.solved) {
      primary.className = 'btn green';
      slot(root, 'primary-text').textContent = last ? 'Terminar nivel' : 'Siguiente';
      slot(root, 'why').hidden = false;
      slot(root, 'why-text').textContent = qs.evidence ? 'Ocultar evidencia' : 'Ver por qué';
    } else {
      slot(root, 'primary-text').textContent = multiple ? 'Confirmar selección' : 'Confirmar decisión';
      primary.disabled = qs.selected.size !== need;
      slot(root, 'hint').textContent = !primary.disabled ? '' : multiple ? 'Completa la selección para continuar'
        : qs.locked.size ? 'Elige otra opción para continuar' : 'Elige una opción para continuar';
    }
    return root;
  }

  function quizOption(q, qs, option) {
    const multiple = q.kind === 'multiple';
    const need = q.correct.length;
    const locked = qs.locked.has(option.id);
    const checked = qs.selected.has(option.id);
    const correct = q.correct.includes(option.id);

    const input = el('input', 'sr-only');
    input.type = multiple ? 'checkbox' : 'radio';
    input.name = 'opt';
    input.value = option.id;
    input.checked = checked;
    input.dataset.focus = `opt-${option.id}`;
    input.disabled = qs.solved || locked || (multiple && !checked && qs.selected.size >= need);

    let status = '';
    let mark = multiple ? 'box' : 'radio';
    if (qs.solved) { status = correct ? 'good' : 'dim'; if (correct) mark = multiple ? 'boxok' : 'ok'; }
    else if (locked) { status = 'bad'; mark = 'bad'; }
    else if (checked) { status = 'sel'; mark = multiple ? 'boxok' : 'ok'; }

    const text = inline(el('div', 't'), option.text);
    if (locked) text.append(el('span', 'pill', 'Descartada'));
    const content = el('div');
    content.append(text);
    if (option.detail) content.append(inline(el('div', 'd'), option.detail));

    const label = el('label', `opt ${status}`.trim());
    const markIcon = icon(mark);
    markIcon.classList.add('mark');
    label.append(input, el('span', 'letter', option.id.toUpperCase()), content, markIcon);
    return label;
  }

  function renderQuizFeedback(root, q, qs) {
    const box = slot(root, 'feedback');
    const bodyBox = slot(root, 'fb-body');
    if (!qs.solved && !qs.wrong) return;

    box.hidden = false;
    box.className = `fb ${qs.solved ? 'good' : 'bad'}`;
    slot(root, 'fb-icon').replaceChildren(...icon(qs.solved ? 'ok' : 'bad').childNodes);
    slot(root, 'fb-title').textContent = qs.solved ? '¡Correcto!' : 'Incorrecto';

    if (qs.solved) return bodyBox.append(paragraph(q.explanation));

    const multiple = q.kind === 'multiple';
    qs.wrong.forEach((id) => {
      const option = q.options.find((o) => o.id === id);
      const why = option.why || 'Esta opción no es correcta.';
      bodyBox.append(paragraph(multiple ? `**Opción ${id.toUpperCase()}:** ${why}` : why));
    });
    bodyBox.append(paragraph(multiple ? 'Revisa tu selección y vuelve a confirmar.' : 'Prueba con otra opción.'));
  }

  const quiz = {
    primary() {
      const q = currentQuestion();
      const qs = quizState(q);
      if (qs.solved) return quiz.next();

      // Una opción incorrecta queda descartada; las correctas elegidas se conservan.
      const wrong = [...qs.selected].filter((id) => !q.correct.includes(id));
      if (!wrong.length) { qs.solved = true; qs.wrong = null; }
      else { wrong.forEach((id) => { qs.locked.add(id); qs.selected.delete(id); }); qs.wrong = wrong; }
      render({ focus: 'primary' });
    },
    next() {
      if (state.quiz.index === review.quiz.length - 1) return closeLevel();
      state.quiz.index++;
      render({ top: true });
    },
    evidence() {
      const qs = quizState(currentQuestion());
      qs.evidence = !qs.evidence;
      render({ focus: 'why' });
    },
  };

  /* ============ 7. Nivel 03 · escenarios ============ */

  const currentScenario = () => review.scenarios[state.scen.index];

  function viewScenarios() {
    return state.scen.view === 'summary' ? viewSummary() : viewWrite();
  }

  function viewWrite() {
    const s = state.scen;
    const sc = currentScenario();
    const root = clone('tpl-scenarios-write');
    const last = s.index === review.scenarios.length - 1;
    const answer = s.answers[sc.id] || '';

    slot(root, 'count').textContent = `Escenario ${s.index + 1} de ${review.scenarios.length}`;
    slot(root, 'title').textContent = sc.title;
    inline(slot(root, 'situation'), sc.situation);
    inline(slot(root, 'prompt'), sc.prompt);
    slot(root, 'answer').value = answer;
    slot(root, 'words').textContent = wordsLabel(answer);
    slot(root, 'saved').hidden = !s.saved;
    if (s.evidence) slot(root, 'evidence').replaceChildren(...sc.evidence.map(evidenceBlock));
    slot(root, 'evidence-text').textContent = s.evidence ? 'Ocultar evidencia' : 'Ver en el código';

    renderDots(slot(root, 'dots'), review.scenarios.map((x, i) => ({ on: isAnswered(x.id), cur: i === s.index })),
      `Escenarios respondidos: ${LEVELS.scenarios.done()} de ${review.scenarios.length}`);
    slot(root, 'prev').disabled = s.index === 0;
    slot(root, 'next-text').textContent = last ? 'Revisar y copiar' : 'Siguiente';
    return root;
  }

  function viewSummary() {
    const s = state.scen;
    const root = clone('tpl-scenarios-summary');
    const answered = LEVELS.scenarios.done();
    const all = answered === review.scenarios.length;

    slot(root, 'count').textContent = `${answered} de ${review.scenarios.length} respondidos`;
    slot(root, 'list').replaceChildren(...review.scenarios.map((sc, i) => {
      const answer = (s.answers[sc.id] || '').trim();
      const item = el('li', answer ? '' : 'empty');
      const text = el('div');
      text.append(el('div', 'st', sc.title), el('div', 'ex', answer || '(sin respuesta)'));
      const edit = el('button', 'btn ghost sm', 'Editar');
      edit.type = 'button';
      edit.dataset.action = 'edit';
      edit.dataset.index = i;
      item.append(el('span', 'n', i + 1), text, edit);
      return item;
    }));

    const copy = slot(root, 'copy');
    slot(root, 'copy-text').textContent = s.copied ? '¡Copiado! Pégalo en el chat' : 'Copiar respuestas';
    if (s.copied) { copy.className = 'btn done big'; slot(root, 'copy-icon').replaceChildren(...icon('check').childNodes); }
    slot(root, 'copy-hint').textContent = s.copyText
      ? 'No se pudo copiar automáticamente. Copia el texto seleccionado (Ctrl/Cmd + C).'
      : all ? 'Se copia en formato Markdown, con la situación, la pregunta, tu respuesta y los archivos de evidencia.'
        : 'Hay escenarios sin respuesta: el nivel no se conquista hasta responderlos todos.';
    if (s.copyText) { const manual = slot(root, 'manual'); manual.hidden = false; manual.value = s.copyText; }
    return root;
  }

  // El portapapeles de la API moderna puede no estar disponible en file://; se prueba una alternativa.
  /* ============ Texto de los escenarios para el chat ============ */
  // Lo que se copia al portapapeles al terminar el nivel: el desarrollador lo pega en el chat para que el agente evalúe sus respuestas.

  const INSTRUCTION =
    'Evalúa mis respuestas a estos escenarios. Dime qué respuestas son acertadas, ' +
    'qué consideraciones me faltan y si alguna respuesta mía implica cambiar el código.';

  const normalize = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim();

  function formatEvidence(ev) {
    let where = '';
    if (ev.lines) {
      where = ev.lines.start === ev.lines.end
        ? ` (línea ${ev.lines.start})`
        : ` (líneas ${ev.lines.start}–${ev.lines.end})`;
    }
    return `\`${ev.file}\`${where}`;
  }

  /**
   * @param {object} review  review.json ya validado
   * @param {Record<string,string>} answers  respuestas por id de escenario, p. ej. { S1: '...' }
   * @returns {string} Markdown listo para pegar en el chat
   */
  function buildScenarioExport(review, answers = {}) {
    const { meta, scenarios } = review;
    const mission = meta.missionName ?? meta.title;
    const dirty = meta.source.dirty ? ', con cambios sin commitear' : '';

    const lines = [
      `Revisión «${mission}» · rama \`${meta.source.head}\`, commit \`${meta.source.commit}\`${dirty}.`,
      '',
      INSTRUCTION,
    ];

    scenarios.forEach((sc, i) => {
      const answer = normalize(answers[sc.id]);
      lines.push(
        '',
        `## Escenario ${i + 1}: ${sc.title}`,
        '',
        `**Situación:** ${normalize(sc.situation)}`,
        '',
        `**Pregunta:** ${normalize(sc.prompt)}`,
        '',
        '**Mi respuesta:**',
        answer || '(sin respuesta)',
        '',
        `**Evidencia:** ${sc.evidence.map(formatEvidence).join(', ')}`,
      );
    });

    return lines.join('\n') + '\n';
  }

  async function copyToClipboard(text) {
    // Si el navegador no resuelve ni rechaza la promesa, no se espera indefinidamente.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
    try { await Promise.race([navigator.clipboard.writeText(text), timeout]); return true; } catch { /* se prueba la alternativa */ }
    const area = el('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    dialog.append(area); // dentro del diálogo: fuera de él, el resto de la página está inerte
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sin permiso */ }
    area.remove();
    return ok;
  }

  const scenarios = {
    prev() {
      const s = state.scen;
      if (s.index > 0) { s.index--; render({ top: true, focus: 'answer' }); }
    },
    next() {
      const s = state.scen;
      if (s.index === review.scenarios.length - 1) { s.view = 'summary'; render({ top: true, focus: 'copy' }); }
      else { s.index++; render({ top: true, focus: 'answer' }); }
    },
    evidence() {
      state.scen.evidence = !state.scen.evidence;
      render({ focus: 'evidence' });
    },
    edit(button) {
      Object.assign(state.scen, { view: 'write', index: Number(button.dataset.index), copied: false, copyText: null });
      render({ top: true, focus: 'answer' });
    },
    async copy() {
      const s = state.scen;
      const text = buildScenarioExport(review, s.answers);
      const ok = await copyToClipboard(text);
      s.copied = ok;
      s.copyText = ok ? null : text;
      render({ focus: 'copy' });
      if (!ok) body.querySelector('.manual')?.select();
      else setTimeout(() => { s.copied = false; if (current === 'scenarios' && s.view === 'summary') render(); }, 3000);
    },
  };

  /* ============ 8. Eventos ============ */

  const actions = { flashcards: flash, quiz, scenarios };

  document.querySelectorAll('.level').forEach((button) => button.addEventListener('click', () => openLevel(button.dataset.level)));
  byId('level-close').addEventListener('click', closeLevel);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) closeLevel(); }); // clic en el fondo
  dialog.addEventListener('close', () => { if (!dialog.open) { current = null; renderMap(); } });

  body.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (target && !target.disabled) actions[current][target.dataset.action]?.(target);
  });

  body.addEventListener('change', (e) => {
    if (current !== 'quiz' || e.target.name !== 'opt') return;
    const qs = quizState(currentQuestion());
    if (e.target.type === 'radio') qs.selected = new Set([e.target.value]);
    else if (e.target.checked) qs.selected.add(e.target.value);
    else qs.selected.delete(e.target.value);
    render();
  });

  // Al escribir no se repinta (se perdería el foco): solo se actualizan contador, borrador y puntos.
  body.addEventListener('input', (e) => {
    if (current !== 'scenarios' || e.target.dataset.slot !== 'answer') return;
    const s = state.scen;
    const sc = currentScenario();
    s.answers[sc.id] = e.target.value;
    s.saved = saveDrafts(s.answers);
    slot(body, 'words').textContent = wordsLabel(e.target.value);
    slot(body, 'saved').hidden = !s.saved;
    body.querySelectorAll('.dots i')[s.index]?.classList.toggle('on', isAnswered(sc.id));
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea, input[type="text"]') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (current === 'flashcards') {
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); flash.flip(); }
      else if (e.key === 'ArrowRight') flash.next();
      else if (e.key === 'ArrowLeft') flash.prev();
    } else if (current === 'quiz' && /^[a-f]$/i.test(e.key)) {
      body.querySelector(`input[value="${e.key.toLowerCase()}"]:not(:disabled)`)?.click();
    }
  });

  renderMap();
})();
