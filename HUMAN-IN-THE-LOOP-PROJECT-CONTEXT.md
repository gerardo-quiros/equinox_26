# Human-in-the-Loop: contexto, alcance y hoja de ruta

> Documento de contexto del proyecto del hackathon. Recoge el objetivo, el alcance acordado, las decisiones y los asuntos abiertos, para retomar el trabajo en futuras conversaciones. **No es una especificación técnica**: el detalle vive en el código, en `SKILL.md`, en `references/analysis-guide.md` y en `schema/review.schema.json`, y aquí solo se enlaza.
>
> Última actualización: 2026-11-27 (tras la simplificación de la Skill, ver `SIMPLIFICACION-TAREAS.md`). **Alcance actual: solo la parte de evaluación** (análisis, contrato de datos y experiencia interactiva). El feedback humano y el informe Markdown están aparcados (sección 6).

---

## 1. Problema y propuesta de valor

Los agentes de IA producen grandes cantidades de especificaciones, planes, código y pruebas. Revisarlo todo a mano es costoso, y no revisarlo lleva a aprobar a ciegas. El desarrollador pierde comprensión y control sobre las decisiones relevantes del software.

> Ayudar al desarrollador a comprender y supervisar lo importante de una feature, PR o cambio de código: el agente detecta qué merece criterio humano y lo convierte en una revisión breve, interactiva y basada en evidencias.

Las flashcards, los test y las preguntas abiertas son **el medio**, no el fin: cada pregunta existe porque apunta a algo que el humano debería mirar.

## 2. Qué es el proyecto

Una **Skill para Claude Code** (`/supervise`) que el desarrollador invoca para evaluar una feature o un conjunto de cambios. La Skill:

1. Reúne el contexto: git diff, commits, especificaciones y convenciones.
2. Analiza los cambios y decide **qué merece revisión humana** (los *focos*).
3. Convierte esos focos en flashcards, test y escenarios, con evidencias del repositorio.
4. Genera un `review.html` interactivo y sin conexión a partir de plantillas fijas.
5. El desarrollador responde y consulta las evidencias. En el test ve al momento la corrección. En los escenarios escribe sus respuestas y las copia al chat para que el agente las evalúe.

### Alcance del MVP

| Dentro | Fuera |
|---|---|
| Uso desde Claude Code | Compatibilidad con otros agentes |
| Revisión **postimplementación** del diff de la rama | Revisión previa a la implementación (spec/plan) |
| Specs de SpecKit, README y `CLAUDE.md` como contexto | Soporte de OpenSpec |
| Flashcards, test y escenarios | Spot the bug, Architecture Explorer, mapas mentales |
| HTML local autocontenido, sin backend | Backend, autenticación, histórico |
| Copiar al portapapeles las respuestas de los escenarios | Informe Markdown, valoraciones por pregunta y reimportación de feedback |
| | Corrección del código desde la interfaz, puntos o rankings |
| | Revisión por número de PR (`/supervise pr <n>`) |

---

## 3. Arquitectura

```
 /supervise ─► context.mjs ─► agente (analysis-guide) ─► review.json ─► build.mjs ─► review.html
              (git + specs)                              (validado)    (valida + ensambla)
```

### 3.1 Skill de entrada

Instrucciones en `.claude/skills/supervise/SKILL.md`. Un único comando:

| Comando | Qué revisa |
|---|---|
| `/supervise` | La rama actual frente a su base, **incluidos los cambios sin commitear** y los archivos nuevos |
| `--base <rama>` (opcional) | Cambia la rama base |

- **Rama base por defecto:** `origin/HEAD`; si no existe, `main` y después `master`.
- **Por qué el merge-base:** solo aparecen los cambios propios de la rama.
- **Por qué incluir lo no commiteado:** el código que acaba de escribir un agente suele estar sin commitear. La revisión lo marca (`dirty`).
- **Para revisar otra rama**, hay que cambiarse a ella antes. Se retiró `/supervise <rama>` para tener un solo modo.
- **Specs:** `context.json` lista todas las carpetas `specs/<NNN-nombre>/` (SpecKit) sin asociarlas a la rama; el agente lee las que encajan con el cambio. Sin specs, se usa el README.
- **Excluidos:** lockfiles y archivos generados se listan pero no entran en el diff.
- **Diff grande** (más de 3000 líneas): se avisa y el agente lo lee por archivos.
- **Más adelante:** `/supervise pr <n>` mediante `gh`.

### 3.2 Motor de análisis

Lo ejecuta el propio agente siguiendo `references/analysis-guide.md`. Salida: un JSON que cumple `schema/review.schema.json`. El agente nunca escribe HTML.

1. **Focos de revisión.** Cada foco tiene un tipo (cambio, decisión, riesgo, desviación de requisito, hueco de pruebas), una prioridad orientativa, un motivo y evidencias.
2. **Preguntas.** **Cada pregunta referencia al menos un foco**, así no son trivia sobre el código.

### 3.3 Renderizador interactivo

Una plantilla contenedora y una por nivel (`templates/`). `build.mjs` inyecta el JSON validado como datos (no como HTML) y escribe un único `review.html`.

**Pantalla principal: «Mapa de misiones»** (diseño aportado por el equipo, estética de RPG ilustrado):

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
- **HTML de un solo archivo y sin conexión:** estilos, scripts, fuentes (Cinzel y Outfit, OFL) e imágenes incrustados (~440 KB). Sin servidor, `fetch` ni recursos externos; un test lo comprueba.

---

## 4. Contrato de datos

Un único contrato: `.claude/skills/supervise/schema/review.schema.json`, con un ejemplo completo en `examples/review.example.json`. Estructura: `meta`, `focuses`, `flashcards`, `quiz` y `scenarios`; todas las evidencias llevan `snippet`.

Reglas principales:

- **Textos en texto plano**, con límites de longitud. Solo se admite `código` y **negrita**. Nunca HTML.
- **`additionalProperties: false`**: una errata del agente es un error, no un campo ignorado.
- **Snippet obligatorio** en cada evidencia, porque el HTML no puede leer el repositorio. Máximo 60 líneas.
- **Rutas relativas seguras:** sin `/` inicial, sin unidades de Windows y sin `..`.
- **Cantidades:** los máximos viven solo en el esquema (12 focos, 10 flashcards, 4 test, 2 escenarios) y son techos, no objetivos. Mínimo duro: 1 por grupo.
- **Test:** las opciones incorrectas llevan `why` obligatorio; `detail` se ve antes de responder y debe ser neutro.

Validación: `build.mjs` valida la estructura y la semántica (ids únicos, referencias a focos, reglas del test, rangos de líneas) y avisa de los focos que ninguna pregunta trabaja. Tests: `node --test tests/` (contrato, ensamblado, evidencias, contexto con repositorios temporales, coherencia de la Skill y un recorrido completo en Chrome, que se omite si no hay Chrome).

---

## 5. Principios de diseño

1. **Supervisión antes que aprendizaje.** Se prioriza revisar decisiones, riesgos y conformidad con requisitos.
2. **Toda pregunta nace de un foco** y toda afirmación lleva evidencia.
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
| `review.json` | El agente | Focos, preguntas y evidencias |
| `review.html` | `build.mjs` | Experiencia interactiva local |

`.hitl/` debería estar en `.gitignore`; la Skill avisa si no lo está, pero no lo modifica.

**Dentro del alcance:** copiar las respuestas de los escenarios (sección 3.3), el único canal de vuelta al agente.

**Aparcado:**

- Valoraciones por pregunta («No me convence» / «Discrepo»).
- Ampliar la copia con lo que fallaron o dudaron en el test y las flashcards.
- Informe Markdown (`review-feedback.md`) y un segundo contrato (`feedback.schema.json`). Existió una primera versión; se eliminó para simplificar.

## 7. Estructura de la Skill

```
.claude/skills/supervise/
├── SKILL.md              Flujo: contexto, análisis, build y entrega
├── references/           analysis-guide.md: criterios de relevancia, evidencias y preguntas
├── schema/               review.schema.json
├── examples/             review.example.json y su review.html
├── templates/            page.html, styles.css, app.js y una plantilla por nivel
├── assets/               Fondo, avatares y fuentes
└── scripts/
    ├── context.mjs       CLI: escribe context.json y changes.patch
    ├── build.mjs         CLI: valida review.json y genera review.html
    └── lib/              repo-context, schema-subset, validate-review, evidence, build-html

tests/                    En la raíz del repo, fuera de la Skill
```

---

## 8. Decisiones acordadas

1. **Orientación: supervisión** de lo importante de una feature, PR o código.
2. **Punto de entrada: una Skill de Claude Code**, `/supervise`, sin compatibilidad con otros agentes de momento.
3. **Tres componentes:** Skill de entrada, motor de análisis (JSON validado por esquema) y renderizador interactivo.
4. **Tres formatos:** flashcards, test de selección simple o múltiple y escenarios abiertos, con los máximos fijados en el esquema.
5. **Plantilla HTML por formato.** El agente genera solo datos; el HTML sale siempre del build.
6. **Solo evaluación.** El feedback humano y el informe quedan aparcados.
7. **Un solo modo de revisión:** rama actual frente al merge-base, con cambios sin commitear y archivos nuevos; `--base` opcional.
8. **Node.js ≥ 18 sin dependencias**, validador propio y HTML autocontenido.
9. **Pantalla principal «Mapa de misiones»** con tres niveles libres; cada uno abre un modal. Héroe fijo «Padi».
10. **Test:** si falla se indica por qué y se reintenta; si acierta se muestra la explicación y la evidencia.
11. **Escenarios:** el humano escribe y copia las respuestas al chat; no hay respuesta de referencia en el HTML.
12. **Evidencias verificadas** contra el repositorio al construir.
13. **Sin inventar normas:** las preguntas solo se apoyan en el código, las specs o prácticas generales sin atribución.
14. **El HTML no se abre solo:** la Skill muestra la ruta.
15. **Contrato simplificado (2026-11-27):** sin `requirements`, `generator`, `basis`, `category`, `highlight` ni `language`; las referencias a la spec son evidencias `kind: "spec"`.

---

## 9. Cuestiones abiertas

- **Humano atrapado en el test:** ¿mostrar la respuesta correcta tras 2 fallos?
- **Criterios de «conquistado»** en flashcards (todas volteadas) y escenarios (todos respondidos), y si se exige un mínimo de texto.
- **Texto copiado:** ¿es adecuada la instrucción fija? ¿conviene incluir fragmentos de código o basta con las rutas?
- **Dónde se ven los focos** (el «por qué» de cada pregunta) en la interfaz.
- **Revisión por número de PR** con `gh`, que también daría la descripción del PR como intención.
- **Instalación fuera de este proyecto:** hoy la Skill vive en `.claude/skills/supervise/`; para otros repositorios habría que instalarla en `~/.claude/skills/`.
- **Independencia del análisis:** el mismo modelo que escribió el código lo revisa. La verificación de evidencias limita los errores de cita, no los de criterio. Valorar una segunda pasada con otro modelo o un subagente.
- **Persistencia:** ¿guardar también el progreso del test y las flashcards, además de los borradores de los escenarios?
- **Proyecto SpecKit de prueba** y criterios de éxito de la demo.

---

## 10. Hoja de ruta

| Etapa | Objetivo | Estado |
|---|---|---|
| 1. Contrato | Esquema, ejemplo, validador y tests | ✅ |
| 2. Renderizador | Plantillas y mapa de misiones | ✅ |
| 3. Motor de análisis | `SKILL.md` + `analysis-guide.md` | ✅ |
| 4. Skill de entrada | `context.mjs` y flujo completo | ✅ Falta probarla con un análisis real |
| 5. Integración SpecKit | Probar con una feature real | Pendiente |
| 6. Evaluación y demo | Medir utilidad y preparar la demostración | Pendiente |

### Indicadores candidatos

- Tiempo total de revisión.
- Problemas o desviaciones conocidos detectados y omitidos. La demo puede incluir una decisión discutible, una desviación de requisitos y un fallo conocido.
- Relevancia de los focos y falsos positivos.
- Utilidad percibida de las preguntas para entender el cambio.
