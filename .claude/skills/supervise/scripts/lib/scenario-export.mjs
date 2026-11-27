// Texto que el renderizador copia al portapapeles al terminar el nivel de escenarios.
// El desarrollador lo pega en el chat con el agente para que evalúe sus respuestas.
// Función pura: sin DOM ni fs, así que se prueba en Node y se incrusta en el HTML.

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
export function buildScenarioExport(review, answers = {}) {
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
