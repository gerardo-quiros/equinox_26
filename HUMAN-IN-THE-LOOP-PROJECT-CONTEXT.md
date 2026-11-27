# Human-in-the-Loop: contexto, alcance y hoja de ruta

> Documento de contexto del proyecto del hackathon. Recoge el objetivo, el alcance acordado, las decisiones y los asuntos abiertos, para retomar el trabajo en futuras conversaciones. **No es una especificación técnica**: el detalle vive en el código, en `SKILL.md`, en `references/analysis-guide.md` y en `schema/review.schema.json`, y aquí solo se enlaza.
>
> Última actualización: 2026-11-27 (tras la simplificación de la Skill, ver `SIMPLIFICACION-TAREAS.md`, y la incorporación de la fase de estudio «El camino del Aprendiz»). **Alcance actual: dos fases**, **estudio** (entender cómo funciona el cambio) y **evaluación** (revisar lo que merece criterio humano), con análisis, contrato de datos y experiencia interactiva para ambas. El feedback humano y el informe Markdown están aparcados (sección 6).

---

## 1. Problema y propuesta de valor

Los agentes de IA producen grandes cantidades de especificaciones, planes, código y pruebas. Revisarlo todo a mano es costoso, y no revisarlo lleva a aprobar a ciegas. El desarrollador pierde comprensión y control sobre las decisiones relevantes del software.

> Ayudar al desarrollador a comprender y supervisar lo importante de una feature, PR o cambio de código: el agente detecta qué merece criterio humano y lo convierte en una revisión breve, interactiva y basada en evidencias.

Las flashcards, los test y las preguntas abiertas son **el medio**, no el fin: cada pregunta existe porque apunta a algo que el humano debería mirar.

Para poder criticar un cambio primero hay que entenderlo. Por eso la revisión tiene **dos fases**: primero **«El camino del Aprendiz»** (estudio: qué se hizo y cómo funciona) y después **«El desafío del Maestro»** (evaluación: qué merece criterio humano). El estudio explica; no juzga. Los riesgos, decisiones discutibles y huecos viven en los focos.

## 2. Qué es el proyecto

Una **Skill para Claude Code** (`/la-senda`) que el desarrollador invoca para estudiar y evaluar una feature o un conjunto de cambios. La Skill:

1. Reúne el contexto: git diff, commits, especificaciones y convenciones.
2. Analiza los cambios y produce dos cosas en el mismo `review.json`: el **estudio** (crónica, mapa del conocimiento y enseñanzas del maestro) y los **focos** que merecen revisión humana.
3. Convierte esos focos en flashcards, test y escenarios, con evidencias del repositorio.
4. Genera un `review.html` interactivo, de un solo archivo y que no necesita conexión, a partir de plantillas fijas. Se abre en una página de inicio con dos caminos.
5. En el **camino del Aprendiz** el desarrollador lee la crónica, explora el mapa del conocimiento (con enlaces al código en GitHub) y recorre las enseñanzas del maestro.
6. En el **desafío del Maestro** responde y consulta las evidencias. En el test ve al momento la corrección. En los escenarios escribe sus respuestas y las copia al chat para que el agente las evalúe.

### Alcance del MVP

| Dentro | Fuera |
|---|---|
| Uso desde Claude Code | Compatibilidad con otros agentes |
| Revisión **postimplementación** del diff de la rama | Revisión previa a la implementación (spec/plan) |
| Specs de SpecKit, README y `CLAUDE.md` como contexto | Soporte de OpenSpec |
| Fase de estudio: crónica, mapa del conocimiento y enseñanzas | Diagramas dibujados (el mapa es una lista de secciones, no un grafo), Architecture Explorer |
| Flashcards, test y escenarios | Spot the bug, mapas mentales |
| HTML local autocontenido, sin backend | Backend, autenticación, histórico |
| Enlaces al código en GitHub, si el commit está publicado | Integración con otros alojamientos (GitLab, Bitbucket) |
| Copiar al portapapeles las respuestas de los escenarios | Informe Markdown, valoraciones por pregunta y reimportación de feedback |
| | Corrección del código desde la interfaz, puntos o rankings |
| | Revisión por número de PR (`/la-senda pr <n>`) |

---

## 3. Arquitectura

```
 /la-senda ─► context.mjs ─► agente (analysis-guide) ─► review.json ─► build.mjs ─► review.html
              (git + specs)   estudio + focos + preguntas  (validado)    (valida + ensambla)
                                                                              │
                                                              inicio ─► Aprendiz (estudio)
                                                                    └► Maestro (evaluación)
```

### 3.1 Skill de entrada

Instrucciones en `.claude/skills/la-senda/SKILL.md`. Un único comando:

| Comando | Qué revisa |
|---|---|
| `/la-senda` | La rama actual frente a su base, **incluidos los cambios sin commitear** y los archivos nuevos |
| `--base <rama>` (opcional) | Cambia la rama base |

- **Rama base por defecto:** `origin/HEAD`; si no existe, `main` y después `master`.
- **Por qué el merge-base:** solo aparecen los cambios propios de la rama.
- **Por qué incluir lo no commiteado:** el código que acaba de escribir un agente suele estar sin commitear. La revisión lo marca (`dirty`).
- **Para revisar otra rama**, hay que cambiarse a ella antes. Se retiró `/la-senda <rama>` para tener un solo modo.
- **Specs:** `context.json` lista todas las carpetas `specs/<NNN-nombre>/` (SpecKit) sin asociarlas a la rama; el agente lee las que encajan con el cambio. Sin specs, se usa el README.
- **Excluidos:** lockfiles y archivos generados se listan pero no entran en el diff.
- **Diff grande** (más de 3000 líneas): se avisa y el agente lo lee por archivos.
- **Remoto de GitHub:** `context.mjs` deduce `repoUrl` a partir de `origin` (quita credenciales) y comprueba si el commit está publicado en alguna rama remota (`published`). Ambos van en `metaDraft`.
- **Más adelante:** `/la-senda pr <n>` mediante `gh`.

### 3.2 Motor de análisis

Lo ejecuta el propio agente siguiendo `references/analysis-guide.md`. Salida: un JSON que cumple `schema/review.schema.json`. El agente nunca escribe HTML. Aprovecha lo que ya ha leído para el diff: el estudio no requiere otra pasada.

1. **Estudio** (`study`, sección 4 de la guía). Explica cómo funciona el cambio: crónica, mapa del conocimiento y enseñanzas.
2. **Focos de revisión.** Cada foco tiene un tipo (cambio, decisión, riesgo, desviación de requisito, hueco de pruebas), una prioridad orientativa, un motivo y evidencias.
3. **Preguntas.** **Cada pregunta referencia al menos un foco**, así no son trivia sobre el código.

### 3.3 Renderizador interactivo

Una plantilla de inicio y estudio (`study.html`, `study.css`, `study.js`), una contenedora y una por nivel (`templates/`). `build.mjs` inyecta el JSON validado como datos (no como HTML) y escribe un único `review.html`.

**Página de inicio** («Equinox»). Se muestra al abrir el HTML, con el nombre de la misión y dos caminos ilustrados. La navegación usa el hash de la URL: `#inicio`, `#aprendiz` y `#desafio`.

- **El camino del Aprendiz** → fase de estudio (3.3.1).
- **El desafío del Maestro** → el «Mapa de misiones» de abajo (flashcards, test y escenarios).

#### 3.3.1 El camino del Aprendiz (estudio)

Tres sendas, cada una en un `<dialog>` nativo que se cierra cuando se quiere. Todo el texto se pinta con `textContent`.

| Senda | Contenido (`review.study`) |
|---|---|
| **La crónica** | `chronicle`: título y un párrafo de 2–4 frases con qué se hizo y para qué. Muestra la rama y el commit de origen. |
| **El mapa del conocimiento** | `map`: seis secciones en un panel lateral: **flujo** (recorrido de la entrada a la salida, 2–8 pasos), **componentes**, **modelos** (con campos), **decisiones**, **casos límite** y **pruebas** (lo que cubren las que ya existen). |
| **Las enseñanzas del maestro** | `teachings`: 2–5 píldoras que se recorren una a una, con imagen del maestro. Lo que conviene recordar si mañana hay que tocar este código o atender un incidente. |

- **Secciones vacías.** Si una sección del mapa no aplica (`[]`), se muestra atenuada, bloqueada y con «No aplica en este cambio». Solo `flow` y `components` tienen siempre contenido.
- **Referencias al código (`ref`).** Cada elemento puede indicar `file` y `lines`. La página la pinta como ruta y, si procede, como enlace a GitHub. `decisions`, `edgeCases` y `teachings` admiten además un `snippet` de hasta 12 líneas, plegado tras «Ver código». Se usa solo si el código se entiende antes que la explicación.
- **Enlaces a GitHub.** Los construye la página con `meta.source.repoUrl`, el commit y la `ref` (`<repoUrl>/blob/<commit>/<ruta>#L<inicio>-L<fin>`). El agente no escribe URLs. Solo se enlaza si hay remoto de GitHub, el commit está publicado **y no hay cambios sin commitear**; si no, se muestra la ruta sin enlace.
- **Foco asociado.** Decisiones, casos límite y enseñanzas pueden llevar `focusIds`, para conectar el estudio con lo que luego se evalúa.
- **Sin juicio.** El estudio no sustituye a los focos: si algo es un riesgo, un hueco o una desviación, va en un foco.

**Pantalla del desafío: «Mapa de misiones»** (diseño aportado por el equipo, estética de RPG ilustrado):

- Tres niveles: **01 Flashcards**, **02 Test** y **03 Escenarios**, en cualquier orden y sin bloqueos.
- Panel de misión con `meta.missionName` (si falta, `meta.title`) y barra de progreso calculada en el navegador.
- Héroe fijo «Padi · Guardián de PR». Al conquistar los tres niveles aparece el maestro Padi y el mensaje «¡Has finalizado la revisión!», que recuerda copiar las respuestas de los escenarios.
- Estados de nivel: *por explorar*, *en encuentro* (alguna pregunta resuelta) y *conquistado* (todas resueltas).
- Cada nivel abre un modal (`<dialog>` nativo) con solo la tarjeta del nivel. Se puede cerrar en cualquier momento sin perder lo respondido.

**Nivel 01 · Flashcards.** Cara delantera con la pregunta y cara trasera con título, explicación y evidencia. Navegación libre; se conquista al voltear todas las tarjetas (propuesta).

**Nivel 02 · Test** (selección simple o múltiple):

- **Incorrecta:** se indica por qué (el `why` de la opción elegida) y se reintenta hasta acertar. En múltiple, un acierto parcial cuenta como incorrecto.
- **Correcta:** se muestra la explicación, y «Ver por qué» despliega la evidencia.
- No hay puntuación: se puede fallar las veces que haga falta.
- **Riesgo abierto:** la respuesta «correcta» la escribe el mismo agente que hizo el código. Si se equivoca, el humano no podría avanzar. Propuesta: tras 2 fallos, mostrar la respuesta correcta y permitir avanzar.
- El color nunca es la única señal: cada estado lleva icono y texto.

**Nivel 03 · Escenarios.** El desarrollador escribe sus respuestas, recorre todos los escenarios y, al final, pulsa **«Copiar respuestas»** y las pega en el chat. El HTML **no muestra ninguna respuesta de referencia**: la evaluación la hace el agente.

- Evita corregir en el navegador (no hay backend), mantiene al humano pensando por su cuenta y cierra el ciclo sin ficheros ni integraciones. Las respuestas pueden revelar preocupaciones que requieran cambios en el código, y el texto copiado lo pide.
- Se conquista cuando todos los escenarios tienen respuesta; copiar no es obligatorio.
- El borrador se guarda en `localStorage` (con `try/catch` y `meta.reviewId` como clave).
- Copia con `navigator.clipboard`, con alternativa `execCommand('copy')` y, si falla, texto en un cuadro seleccionable. Se abre por `file://`: probar en Chrome, Safari y Firefox.
- **Texto copiado:** misión, rama y commit; una instrucción fija para evaluar las respuestas; y, por escenario, título, situación, pregunta, respuesta y archivos de evidencia (ruta y líneas). No incluye fragmentos de código ni respuestas del agente.

### 3.4 Tecnología

- **Node.js ≥ 18 con módulos nativos, sin `npm install`.** Se descartó `ajv`: exigiría vendorizar `node_modules` (más `ajv-formats` y 4 dependencias transitivas) para ahorrar unas 136 líneas ya probadas.
- **Validador propio** (`lib/schema-subset.mjs` + `lib/validate-review.mjs`): errores legibles con la ruta del campo, para que el agente los corrija. El esquema es la única fuente de verdad y el validador falla si usa una palabra clave que no soporta.
- **Evidencias verificadas** (`lib/evidence.mjs`, con `build.mjs --repo`): cada fragmento debe coincidir con las líneas del archivo. El agente no puede citar líneas inventadas. Las evidencias de tipo diff no se verifican línea a línea.
- **Inyección segura:** el JSON va en `<script type="application/json">` con `<` escapado; la página pinta siempre con `textContent`.
- **HTML de un solo archivo y sin conexión:** estilos, scripts, fuentes (Cinzel, Outfit y Bree Serif, OFL) e imágenes incrustados (~970 KB el del ejemplo, con un límite de 1 MB en los tests). Las ilustraciones nuevas van en WebP para no inflarlo. Sin servidor, `fetch` ni recursos externos; un test lo comprueba. Los enlaces a GitHub son solo anclas que se abren al pulsarlas: la página no carga nada de ahí.
- **Orden de ensamblado:** los datos de la revisión se inyectan los últimos, para que ningún texto del JSON se confunda con un marcador de plantilla.

---

## 4. Contrato de datos

Un único contrato: `.claude/skills/la-senda/schema/review.schema.json`, con un ejemplo completo en `examples/review.example.json`. Estructura: `meta`, `study` (opcional), `focuses`, `flashcards`, `quiz` y `scenarios`; todas las evidencias llevan `snippet`.

**Versión del esquema.** `schemaVersion` es `"1.1"`. La `"1.0"` sigue aceptándose, pero **sin** bloque `study`: un `study` con `"1.0"` es un error. `meta.source` puede llevar `repoUrl` y `published` (los copia el agente de `metaDraft`).

**Bloque `study`** (obligatorio dentro si existe: `chronicle`, `map` y `teachings`):

| Parte | Máximos |
|---|---|
| `chronicle` | título y un texto |
| `map.flow` | 2–8 pasos (`label`, `detail`, `ref`) |
| `map.components` | 1–8 (`name`, `role`, `detail`, `ref`) |
| `map.models` | 0–8 (como componentes, más `fields`, hasta 8) |
| `map.decisions` y `map.edgeCases` | 0–6 cada uno (`title`, `detail`, `focusIds`, `ref` con `snippet` opcional) |
| `map.tests` | 0–8 (`name`, `detail`, `cases`, `ref`) |
| `teachings` | 1–6 (`title`, `text`, `focusIds`, `ref` con `snippet` opcional) |

Reglas del estudio:

- **`ref` sin `snippet`** (`file` y `lines`): el build comprueba que el archivo existe y que las líneas caben. **Con `snippet`**: se verifica igual que una evidencia, y como máximo 12 líneas.
- Nombres de componentes y modelos **sin repetir** dentro de su grupo. Los `focusIds` deben existir.
- Sin decisiones ni casos límite, el build avisa de que el mapa se queda corto.
- Los grupos que no apliquen van vacíos (`[]`): se muestran como «No aplica». Mejor eso que rellenarlos.

Reglas principales:

- **Textos en texto plano**, con límites de longitud. Solo se admite `código` y **negrita**. Nunca HTML.
- **`additionalProperties: false`**: una errata del agente es un error, no un campo ignorado.
- **Snippet obligatorio** en cada evidencia, porque el HTML no puede leer el repositorio. Máximo 60 líneas.
- **Rutas relativas seguras:** sin `/` inicial, sin unidades de Windows y sin `..`.
- **Cantidades:** los máximos viven solo en el esquema (12 focos, 10 flashcards, 4 test, 2 escenarios) y son techos, no objetivos. Mínimo duro: 1 por grupo.
- **Test:** las opciones incorrectas llevan `why` obligatorio; `detail` se ve antes de responder y debe ser neutro.

Validación: `build.mjs` valida la estructura y la semántica (ids únicos, referencias a focos, reglas del test y del estudio, rangos de líneas) y avisa de los focos que ninguna pregunta trabaja. Tests: `node --test tests/` (contrato, ensamblado, evidencias, contexto con repositorios temporales, coherencia de la Skill y dos recorridos completos en Chrome, uno del desafío y otro del estudio, que se omiten si no hay Chrome).

---

## 5. Principios de diseño

1. **Entender para supervisar.** El estudio da la comprensión mínima del cambio; el objetivo sigue siendo revisar decisiones, riesgos y conformidad con requisitos. Por eso el estudio **explica y no juzga**: lo discutible va en los focos.
2. **Toda pregunta nace de un foco** y toda afirmación lleva evidencia. En el estudio, cada referencia al código se comprueba contra el repositorio y las URLs las construye la página, nunca el agente.
3. **Hechos e inferencias, separados.** La prioridad que sugiere el LLM es orientativa. Una deducción se dice como tal en `why`.
4. **El agente no se evalúa a sí mismo sin contraste.** La respuesta «correcta» la genera el mismo LLM que implementó, por eso cada pregunta lleva su evidencia.
5. **Interacción informativa.** Responder no aprueba el código ni cambia el repositorio.
6. **Contenido y presentación separados.** El LLM produce JSON validado; las plantillas son fijas.
7. **Contenido del repositorio no confiable.** Se inserta como texto, nunca como HTML o JS.
8. **Trazabilidad.** Cada revisión queda asociada a un commit concreto.
9. **Sin presión por aprobar rápido.** Narrativa de juego y progreso, sí; puntos, rankings o temporizadores, no.

---

## 6. Salidas y alcance aparcado

Cada revisión vive en `.hitl/reviews/<id>/`. El `<id>` combina rama, commit corto, `-dirty` si hay cambios sin commitear y fecha y hora.

| Archivo | Lo genera | Uso |
|---|---|---|
| `context.json` | `context.mjs` | Metadatos, archivos, commits, carpetas de specs, convenciones y avisos |
| `changes.patch` | `context.mjs` | Diff completo sin generados |
| `review.json` | El agente | Estudio, focos, preguntas y evidencias |
| `review.html` | `build.mjs` | Experiencia interactiva local |

`.hitl/` debería estar en `.gitignore`; la Skill avisa si no lo está, pero no lo modifica.

**Dentro del alcance:** copiar las respuestas de los escenarios (sección 3.3), el único canal de vuelta al agente.

**Aparcado:**

- Valoraciones por pregunta («No me convence» / «Discrepo»).
- Ampliar la copia con lo que fallaron o dudaron en el test y las flashcards.
- Informe Markdown (`review-feedback.md`) y un segundo contrato (`feedback.schema.json`). Existió una primera versión; se eliminó para simplificar.

## 7. Estructura de la Skill

```
.claude/skills/la-senda/
├── SKILL.md              Flujo: contexto, análisis, build y entrega
├── references/           analysis-guide.md: criterios de relevancia, evidencias y preguntas
├── schema/               review.schema.json
├── examples/             review.example.json y su review.html
├── templates/            page.html, styles.css, app.js, una plantilla por nivel
│                         y study.html / study.css / study.js (inicio y camino del Aprendiz)
├── assets/               Fondo, avatares, logo, ilustraciones de niveles (WebP) y fuentes
│   └── study/            Ilustraciones del inicio, la crónica, el mapa y el maestro
└── scripts/
    ├── context.mjs       CLI: escribe context.json y changes.patch
    ├── build.mjs         CLI: valida review.json y genera review.html
    └── lib/              repo-context, schema-subset, validate-review, evidence, build-html

tests/                    En la raíz del repo, fuera de la Skill
```

---

## 8. Decisiones acordadas

1. **Orientación: supervisión** de lo importante de una feature, PR o código.
2. **Punto de entrada: una Skill de Claude Code**, `/la-senda`, sin compatibilidad con otros agentes de momento.
3. **Tres componentes:** Skill de entrada, motor de análisis (JSON validado por esquema) y renderizador interactivo.
4. **Tres formatos:** flashcards, test de selección simple o múltiple y escenarios abiertos, con los máximos fijados en el esquema.
5. **Plantilla HTML por formato.** El agente genera solo datos; el HTML sale siempre del build.
6. **Solo evaluación.** El feedback humano y el informe quedan aparcados.
7. **Un solo modo de revisión:** rama actual frente al merge-base, con cambios sin commitear y archivos nuevos; `--base` opcional.
8. **Node.js ≥ 18 sin dependencias**, validador propio y HTML autocontenido.
9. **Desafío del Maestro: «Mapa de misiones»** con tres niveles libres; cada uno abre un modal. Héroe fijo «Padi». Se llega desde la página de inicio.
10. **Test:** si falla se indica por qué y se reintenta; si acierta se muestra la explicación y la evidencia.
11. **Escenarios:** el humano escribe y copia las respuestas al chat; no hay respuesta de referencia en el HTML.
12. **Evidencias verificadas** contra el repositorio al construir.
13. **Sin inventar normas:** las preguntas solo se apoyan en el código, las specs o prácticas generales sin atribución.
14. **El HTML no se abre solo:** la Skill muestra la ruta.
15. **Contrato simplificado (2026-11-27):** sin `requirements`, `generator`, `basis`, `category`, `highlight` ni `language`; las referencias a la spec son evidencias `kind: "spec"`.
16. **Dos fases (2026-11-27):** «El camino del Aprendiz» (estudio) antes de «El desafío del Maestro» (evaluación), con una página de inicio que ofrece ambos caminos.
17. **El estudio explica, no juzga.** Crónica, mapa del conocimiento (flujo, componentes, modelos, decisiones, casos límite y pruebas) y enseñanzas del maestro. Lo discutible sigue en los focos.
18. **El estudio es opcional en el contrato** (`study`, `schemaVersion` `"1.1"`), pero la Skill lo genera siempre.
19. **Las URLs al código las construye la página**, con `repoUrl`, el commit y la `ref`. Solo se enlaza si el commit está publicado y no hay cambios sin commitear.
20. **Los snippets del estudio son excepcionales:** máximo 12 líneas y solo si el código se entiende antes que la explicación.
21. **Nombre de la Skill: La Senda** (`/la-senda`, en `.claude/skills/la-senda/`). Sustituye al nombre provisional `supervise`. Las revisiones guardadas en `.hitl/` con el nombre antiguo no cambian, y las drafts guardadas en el navegador con la clave `supervise:` se pierden al cambiar a `la-senda:`.

---

## 9. Cuestiones abiertas

- **Humano atrapado en el test:** ¿mostrar la respuesta correcta tras 2 fallos?
- **Criterios de «conquistado»** en flashcards (todas volteadas) y escenarios (todos respondidos), y si se exige un mínimo de texto.
- **Texto copiado:** ¿es adecuada la instrucción fija? ¿conviene incluir fragmentos de código o basta con las rutas?
- **Dónde se ven los focos** (el «por qué» de cada pregunta) en la interfaz.
- **Revisión por número de PR** con `gh`, que también daría la descripción del PR como intención.
- **Instalación fuera de este proyecto:** hoy la Skill vive en `.claude/skills/la-senda/`; para otros repositorios habría que instalarla en `~/.claude/skills/`.
- **Independencia del análisis:** el mismo modelo que escribió el código lo revisa. La verificación de evidencias limita los errores de cita, no los de criterio. Valorar una segunda pasada con otro modelo o un subagente.
- **Persistencia:** ¿guardar también el progreso del test y las flashcards, además de los borradores de los escenarios?
- **Progreso del estudio:** hoy no hay estado de «conquistado» en el camino del Aprendiz ni conexión con el desafío. ¿Debería contar para la misión o seguir siendo libre?
- **Fiabilidad del estudio:** el build solo comprueba que las `ref` existen y que las líneas caben, no que el texto describa bien el código. Un estudio inexacto sería peor que ninguno. ¿Hace falta una segunda pasada o marcar lo deducido?
- **Enlaces con cambios sin commitear:** es el caso habitual con código recién escrito por un agente, y ahí no hay enlaces. ¿Basta con la ruta o conviene ofrecer otra vía?
- **Estudio en revisiones grandes:** con un diff de miles de líneas, ¿cómo se elige qué entra en el flujo y los componentes?
- **Proyecto SpecKit de prueba** y criterios de éxito de la demo.

---

## 10. Hoja de ruta

| Etapa | Objetivo | Estado |
|---|---|---|
| 1. Contrato | Esquema, ejemplo, validador y tests | ✅ |
| 2. Renderizador | Plantillas y mapa de misiones | ✅ |
| 3. Motor de análisis | `SKILL.md` + `analysis-guide.md` | ✅ |
| 4. Skill de entrada | `context.mjs` y flujo completo | ✅ Falta probarla con un análisis real |
| 5. Fase de estudio | `study` en el contrato, página de inicio, crónica, mapa y enseñanzas | ✅ Falta probarla con un análisis real |
| 6. Integración SpecKit | Probar con una feature real | Pendiente |
| 7. Evaluación y demo | Medir utilidad y preparar la demostración | Pendiente |

### Indicadores candidatos

- Tiempo total de revisión.
- Problemas o desviaciones conocidos detectados y omitidos. La demo puede incluir una decisión discutible, una desviación de requisitos y un fallo conocido.
- Relevancia de los focos y falsos positivos.
- Utilidad percibida de las preguntas para entender el cambio.
- Si el estudio acorta el tiempo hasta entender el cambio y si su contenido coincide con el código (revisión manual de una muestra).
