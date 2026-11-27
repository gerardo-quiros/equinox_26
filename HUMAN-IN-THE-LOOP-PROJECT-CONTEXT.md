# Human-in-the-Loop: contexto, alcance y hoja de ruta

> Documento de contexto del proyecto del hackathon. Recoge el objetivo, el alcance acordado, la arquitectura y los asuntos abiertos. Sirve para retomar el trabajo en futuras conversaciones. **No es todavía una especificación técnica cerrada**: lo marcado como *propuesta* o *abierto* está pendiente de confirmar.
>
> Última actualización: 2026-11-26. **Alcance actual: solo la parte de evaluación** (análisis, contrato de datos y experiencia interactiva). El feedback humano y el informe Markdown quedan aparcados (sección 7).

---

## 1. Problema

Los agentes de IA producen grandes cantidades de especificaciones, planes, código y pruebas. Revisarlo todo a mano es costoso, y no revisarlo lleva a aprobar a ciegas. El desarrollador pierde comprensión y control sobre las decisiones relevantes del software.

### Propuesta de valor

> Ayudar al desarrollador a comprender y supervisar lo importante de una feature, PR o cambio de código: el agente detecta qué merece criterio humano y lo convierte en una revisión breve, interactiva y basada en evidencias.

Las flashcards, los test y las preguntas abiertas son **el medio**, no el fin: cada pregunta existe porque apunta a algo que el humano debería mirar.

---

## 2. Qué es el proyecto

Una **Skill para Claude Code** que el desarrollador invoca cuando quiere evaluar una feature, un PR o un conjunto de cambios. La Skill:

1. Detecta el proyecto y reúne el contexto: especificaciones, Git diff y código relacionado.
2. Analiza los cambios y decide **qué es importante o relevante para que lo revise un humano**.
3. Convierte esos puntos en un conjunto de preguntas (flashcards, test y preguntas abiertas) con evidencias asociadas.
4. Genera una página HTML interactiva a partir de plantillas fijas.
5. El desarrollador responde las preguntas y consulta las evidencias. En el test ve al momento la corrección y la explicación. En los escenarios escribe sus respuestas y las copia al chat para que el agente las evalúe.

Las respuestas del test y de las flashcards no se guardan ni se exportan. Las de los **escenarios** sí se copian al portapapeles al final del nivel, para pegarlas en el chat con el agente (sección 3.3). El resto del feedback humano está aparcado (sección 7).

### Alcance del MVP

| Dentro | Fuera |
|---|---|
| Uso desde Claude Code | Compatibilidad con otros agentes desde el primer día |
| Revisión **postimplementación**: feature, PR o diff | Revisión previa a la implementación (spec/plan) |
| Detección de specs comunes (SpecKit, README, descripción del PR) | Soporte completo de SpecKit y OpenSpec a la vez |
| Tres formatos: flashcards, test y preguntas abiertas | Spot the bug, Architecture Explorer, comparación de alternativas, mapas mentales |
| HTML local autocontenido, sin backend | Backend multiusuario, autenticación, base de datos, histórico |
| Progreso simple de la sesión (solo en pantalla) | Informe Markdown, valoraciones por pregunta y reimportación de feedback (aparcado) |
| Copiar al portapapeles las respuestas de los escenarios | |
| | Corrección automática del código desde la interfaz |
| | Puntos, rankings o logros |
| | Análisis de seguridad exhaustivo o certificación de calidad |

---

## 3. Arquitectura

```
 /skill  ──►  1. Skill de entrada  ──►  2. Motor de análisis  ──►  review.json (validado por esquema)
                                                                         │
                                                                         ▼
                                            3. Renderizador: plantillas HTML + datos ──►  review.html
                                                                         │
                                                             el humano responde y consulta evidencias
```

### 3.1 Skill de entrada (orquestador) ✅

Implementada en `.claude/skills/supervise/` (instrucciones en `SKILL.md`). Se usa desde Claude Code con `/supervise`.

Responsabilidades y cómo se resuelven:

- **Detectar el proyecto:** raíz del repositorio git y nombre (de `package.json` o de la carpeta). Sin git, se para con un mensaje claro.
- **Recopilar especificaciones:** SpecKit (`specs/<NNN-nombre>/spec.md`, `plan.md`, `tasks.md`). Una spec se asocia a la rama si el nombre de la carpeta aparece en el nombre de la rama (`feature/001-auth` con `001-auth` o `auth`), o si la propia rama la modifica. Las specs de otras features se listan como aviso. Sin specs: se usa `README.md`. `CLAUDE.md` siempre se incluye como convenciones.
- **Obtener el diff:** ver *Invocación*. Es el diff del merge-base, con cambios sin commitear y archivos nuevos sin seguimiento. Los lockfiles y generados se excluyen y se listan.
- **Invocar el análisis:** el propio agente sigue `references/analysis-guide.md` y escribe `review.json`.
- **Generar el artefacto:** `build.mjs` valida el JSON y comprueba que cada evidencia coincide con el archivo; después ensambla `review.html`.

Se usará inicialmente desde Claude Code.

#### Invocación

| Comando | Qué revisa | Git |
|---|---|---|
| `/supervise` | La rama actual frente a su rama base, **incluidos los cambios sin commitear** | `git diff <merge-base>` + archivos nuevos |
| `/supervise <rama>` | Solo los commits de esa rama desde que se separó de la base | `git diff <merge-base> <rama>` |
| `--base <rama>` (opcional) | Cambia la rama base | — |

- **Rama base por defecto:** `origin/HEAD` si existe; si no, `main` y después `master`. Si ninguna existe, se pide `--base`.
- **Por qué el merge-base:** solo aparecen los cambios propios de la rama. Los cambios que hayan entrado en `main` después no ensucian la revisión.
- **Por qué incluir lo no commiteado:** el código que acaba de escribir un agente suele estar sin commitear. La revisión lo indica (`dirty`).
- **Diff grande** (más de 3000 líneas o 300 KB): se avisa y el agente lo lee por archivos, empezando por los que más cambian.
- **Archivos nuevos sin seguimiento** de más de 1 MB no se incluyen, y se avisa.
- **Más adelante:** `/supervise pr <n>` mediante `gh`.

### 3.2 Motor de análisis

Lo ejecuta el propio agente siguiendo las instrucciones de la Skill. Responsabilidades:

- Identificar los cambios importantes.
- Relacionarlos con los requisitos.
- Extraer las decisiones arquitectónicas.
- Identificar riesgos potenciales.
- Generar preguntas o misiones.
- Asociar evidencias: archivo, líneas, fragmento de diff o requisito.

**Salida:** un JSON que cumple un esquema (`review.schema.json`). El agente nunca escribe HTML. Los criterios (qué es un foco, cómo redactar preguntas, qué no inventar) están en `references/analysis-guide.md`.

**Propuesta de funcionamiento en dos pasos:**

1. **Focos de revisión.** El motor identifica primero los puntos relevantes. Cada foco tiene un tipo (cambio relevante, decisión arquitectónica, riesgo, desviación de requisito, hueco de pruebas…), una prioridad orientativa, un motivo y evidencias.
2. **Preguntas.** Después genera las flashcards, los test y las preguntas abiertas. **Cada pregunta referencia al menos un foco.** Así las preguntas no son trivia sobre el código: se derivan de lo que importa revisar.

### 3.3 Renderizador interactivo

Aplicación HTML/JavaScript reutilizable. Hay una plantilla por formato y una plantilla contenedora. Un script toma el JSON validado, lo inyecta como datos (no como HTML) y genera un único `review.html` autocontenido.

Responsabilidades:

- Mostrar las tarjetas.
- Presentar las preguntas.
- Permitir consultar las evidencias (fragmentos de código o diff y referencias a requisitos).
- Registrar las respuestas durante la sesión para calcular el progreso y los estados de los niveles. De momento no se guardan ni se exportan.

**Diseño visual:** lo proporcionará el equipo. Primero una vista de la pantalla principal y después la de cada componente; el desarrollo se hará a partir de ellas. Hasta entonces no se toma como referencia el prototipo `supervise/`.

#### Pantalla principal: «Mapa de misiones»

Vista aportada por el equipo (2026-11-26). Tiene estética de RPG ilustrado: paisaje de aldea, paneles de pergamino y madera con remaches y tipografía de fantasía.

| Elemento | Contenido | Origen del dato |
|---|---|---|
| Insignia «Supervise» (arriba a la izquierda) | Marca de la herramienta | Fijo |
| Cartel central | «Mapa de misiones: niveles por conquistar». Subtítulo adaptado: «Guía a tu héroe por los senderos del código, descubre lo que merece tu atención y conquista cada nivel.» | Fijo (plantilla) |
| Panel de misión (arriba a la derecha) | «Misión: Valle de la Autenticación» y barra «1 de 3 conquistadas (33 %)» | `meta.missionName` (si falta, `meta.title`). El progreso se calcula en el navegador |
| Héroe | Avatar y etiqueta «Padi · Guardián de PR», unido a los niveles por caminos | **Fijo** |
| Nivel 01 · Iniciación | **Flashcards** | `flashcards[]` |
| Nivel 02 · Intermedio | **Test con opciones** (selección simple y múltiple) | `quiz[]` |
| Nivel 03 · Final | **Escenarios** (preguntas abiertas) | `scenarios[]` |
| ~~Barra inferior~~ | Se elimina | — |

**Orden libre:** los niveles se pueden hacer **en cualquier orden**. No hay niveles bloqueados.

**Estados de un nivel:**

| Estado | Cuándo | Aspecto en la vista |
|---|---|---|
| *Por explorar* | Ninguna pregunta resuelta | Neutro (el que en la vista aparecía con candado, ahora sin candado) |
| *En encuentro* | Alguna resuelta, pero no todas | Resaltado con la etiqueta «En encuentro» |
| *Conquistado* | Todas las preguntas resueltas | Verde con ✓ |

**Final de la revisión:** al conquistar los tres niveles, el **maestro Padi** (`master_padi`) sustituye a Padi en el mapa, su etiqueta pasa a «Maestro Padi · Revisión completada» y aparece el mensaje «¡Has finalizado la revisión!», que recuerda copiar las respuestas de los escenarios y pegarlas en el chat con el agente. Terminar un nivel no muestra ninguna pantalla intermedia: el modal se cierra y el mapa actualiza su estado.

**Interacción:** cada nivel abre un **modal que contiene solo la tarjeta del nivel**. El mapa queda detrás, atenuado; la cabecera y el héroe no se repiten. Se implementa con el elemento nativo `<dialog>` (gestiona el foco, `Esc` y el fondo inerte, sin dependencias). Se puede cerrar en cualquier momento: las preguntas ya respondidas se mantienen y el mapa actualiza el estado del nivel. Al responder la última pregunta, el modal se cierra y el nivel queda *conquistado*.

Vistas recibidas: **test** y **flashcards** (el marco con héroe y cabecera de las capturas se descarta, solo se usa la tarjeta). Propuestas de diseño: cara delantera de las flashcards, escenarios y estados del test.

#### Vista del nivel 02: test

Es la misma tarjeta para selección simple y múltiple.

| Elemento | Contenido | Origen del dato |
|---|---|---|
| Etiquetas superiores | «Nivel 02 · Intermedio»; en multiple, además «Selección múltiple» | Fijo; el tipo viene de `quiz[].kind` |
| Progreso | «Pregunta 1 de 3» | Posición en `quiz[]` |
| Título | «Desafío de arquitectura: mitigación de XSS» | `quiz[].title` |
| Enunciado | Texto con `código` y **negrita** | `quiz[].prompt` |
| Aviso (solo multiple) | «Selecciona exactamente 2 respuestas válidas» y contador «1 / 2 seleccionadas» | Se calcula con `correct.length` |
| Opciones | Letra (A, B, C…), título en negrita y descripción debajo. Radio en simple, casilla en multiple | `options[].id`, `.text`, `.detail` (neutro: se ve antes de responder) |
| Botón | «Confirmar decisión» (simple) / «Confirmar selección» (multiple) | Fijo |
| Atajos | Teclas A, B… para seleccionar | Fijo |

**Comportamiento al confirmar (acordado):**

- **Incorrecta:** se indica que está mal y por qué (el `why` de la opción elegida). El humano **reintenta hasta acertar**; no se avanza sin acertar.
- **Correcta:** se muestra la explicación de por qué lo es (`explanation`). Un botón «Ver por qué» despliega la evidencia (fragmento de código o de la spec). Después, «Siguiente».
- En selección múltiple, un acierto parcial cuenta como incorrecto: solo se marcan las opciones erróneas elegidas (con su `why`) y se bloquean; las demás se conservan y se completa la selección.
- El último «Siguiente» cierra el modal y el nivel queda conquistado.
- **Conquistado = todas las preguntas resueltas.** Se puede fallar las veces que haga falta: no hay puntuación.

**Riesgo abierto:** la respuesta «correcta» la escribe el mismo agente que hizo el código. Si se equivoca, el humano no podría avanzar. Propuesta: tras 2 fallos en la misma pregunta se muestra la respuesta correcta con su explicación y se permite avanzar. Así tampoco se acierta por simple eliminación.

**Diseño de los estados:** propuesta visual en `design/quiz-states.html` (sin conexión). Reglas:

- El color nunca es la única señal: cada estado lleva icono (✓ / ✕) y texto («¡Correcto!» / «Incorrecto» / «Descartada»).
- Verde del marco para acierto y terracota (no el rojo brillante de la cinta «En encuentro») para error.
- Al fallar, la opción queda bloqueada y el botón de confirmar se deshabilita hasta elegir otra.
- Tras acertar, las opciones no elegidas se atenúan. «Siguiente» es verde, como en las flashcards.
- El panel de resultado usa `role="status"` para que lo anuncien los lectores de pantalla.
- La evidencia reutiliza `lines` y `highlight` del JSON.

#### Nivel 01: flashcards

Vista recibida: cara trasera. La cara delantera y los estados son **propuesta** en `design/flashcards-scenarios.html`.

| Elemento | Contenido | Origen del dato |
|---|---|---|
| Cinta superior | «Modo flashcards» (violeta) | Fija; cada nivel tiene la suya |
| Etiquetas | «Nivel 01 · Iniciación» y «Flashcards» | Fijo |
| Progreso | «Tarjeta 1 de 8» y una fila de puntos (verde = ya volteada) | Posición en `flashcards[]` |
| Cara delantera | Etiqueta «Pregunta», categoría en una pastilla, pregunta centrada y botón «Voltear tarjeta» | `category` (con su nombre en español) y `front` |
| Cara trasera | Etiqueta «Respuesta / Explicación», marca «Revelado», título, texto y un bloque de código | `title`, `back` y `evidence[0]` |
| Pie | «← Anterior», «Espacio para voltear» y «Siguiente» | Fijo |

- Navegación libre entre tarjetas. Voltear se puede hacer con clic, con el botón y con la tecla Espacio (la animación respeta `prefers-reduced-motion`).
- **Se conquista cuando todas las tarjetas se han volteado** (propuesta). En la última, «Siguiente» pasa a «Terminar nivel».
- El esquema pide `title` (titular de la respuesta) y limita la evidencia a 1–2 fragmentos, que es lo que cabe en la tarjeta.

#### Nivel 03: escenarios

Propuesta en `design/flashcards-scenarios.html`. No hay vista del equipo todavía.

**Idea (acordada):** el desarrollador escribe sus respuestas, recorre todos los escenarios y, al final, pulsa **«Copiar respuestas»**. Se copian al portapapeles las preguntas y sus respuestas, y las pega en el chat con el agente para que las evalúe. El HTML **no muestra ninguna respuesta de referencia**: la evaluación la hace el agente.

Por qué funciona: evita corregir en el navegador (no hay backend), mantiene al humano pensando por su cuenta (no puede copiar la respuesta del agente) y cierra el ciclo con el agente sin ficheros ni integraciones. Las respuestas también pueden revelar preocupaciones que requieran cambios en el código, por eso el texto copiado lo pide.

Pantallas:

| Pantalla | Contenido | Origen del dato |
|---|---|---|
| Escribir | Cinta «Escenario final», etiquetas «Nivel 03 · Final» y «Escenario», progreso «Escenario 1 de 2», título, situación (recuadro con borde dorado), pregunta, área de texto con contador y «Borrador guardado», fila de puntos | `title`, `situation`, `prompt` |
| Pie de «Escribir» | «← Anterior», «Ver en el código» (evidencia, opcional) y «Siguiente» (en el último, «Revisar y copiar») | `evidence` |
| Resumen | «Tus respuestas están listas», lista numerada con extracto de cada respuesta y «Editar», y el botón grande «Copiar respuestas» | Respuestas del humano |
| Tras copiar | El botón pasa a «¡Copiado! Pégalo en el chat» (verde, con `role="status"`) y vuelve al estado inicial a los 3 s | — |

- Navegación libre entre escenarios; las respuestas se pueden editar hasta copiar.
- **Se conquista cuando todos los escenarios tienen respuesta**; copiar no es obligatorio. Al reabrir el nivel se puede volver a copiar.
- **Borrador:** se guarda en el navegador (`localStorage`, protegido con `try/catch`, con `meta.reviewId` como clave) para no perder lo escrito si se recarga la página.
- **Copia:** `navigator.clipboard.writeText` con alternativa `document.execCommand('copy')` y, si ambas fallan, el texto en un cuadro seleccionable. El HTML se abre por `file://`, así que hay que probarlo en Chrome, Safari y Firefox.

**Texto copiado** (función `scripts/lib/scenario-export.mjs`, con tests): una línea con la misión, la rama y el commit (y «con cambios sin commitear» si procede); una instrucción fija pidiendo evaluar las respuestas, señalar lo que falta y decir si alguna implica cambiar el código; y, por escenario, su título, la situación, la pregunta, la respuesta del humano y los archivos de evidencia (ruta y líneas). **No incluye fragmentos de código ni respuestas del agente**: el agente lee el repositorio. Un escenario sin respuesta se marca «(sin respuesta)».

### 3.4 Tecnología de los scripts

**Decisión: Node.js (≥ 18) usando solo módulos nativos, sin `npm install`.**

- Es el mismo lenguaje que el renderizador, así que el validador puede ser un único archivo JS que sirva en Node (al montar) y en el navegador (comprobación al cargar).
- No hay dependencias que instalar ni versiones que mantener.
- La validación es un **validador propio escrito a mano** para nuestro esquema, no una librería de JSON Schema. Devuelve errores legibles (`flashcards[3].evidence[0].file: falta`) para que el agente los corrija y vuelva a lanzar el montaje.
- `review.schema.json` se mantiene como contrato documental y para los editores. Ambos deben estar sincronizados.
- **Inyección segura:** el JSON se incrusta en `<script type="application/json">` escapando `<` como `\u003c`. La página lo lee con `JSON.parse` y pinta siempre con `textContent`. El título de la pestaña se escapa como HTML.
- **HTML de un solo archivo y sin conexión:** estilos, scripts, fuentes e imágenes van incrustados. Se abre con doble clic (`file://`), sin servidor, sin `fetch` y sin ningún recurso externo.
- **Ensamblado:** `node scripts/build.mjs <review.json> [--out review.html]` valida los datos (si hay errores, no genera nada) y escribe un único HTML de unos 440 KB. Las plantillas son archivos separados: `page.html` (estructura), `styles.css`, `app.js` y una por nivel. Los `asset:…` de CSS y HTML se sustituyen por los recursos incrustados en base64.
- **Comprobación automática:** el ensamblado falla si el HTML contiene `src`, `href`, `url()`, `@import` o `<link>` hacia fuera.
- **Adaptación de las vistas del equipo** (usan Tailwind por CDN, Google Fonts e imágenes alojadas fuera):
  - El CDN de Tailwind se sustituyó por CSS propio.
  - Las fuentes Cinzel y Outfit (licencia OFL) están en `assets/fonts/` como `woff2` del subconjunto latino (26 y 32 KB).
  - Las imágenes se optimizaron: fondo a 1280 px en JPEG (160 KB) y los dos avatares recortados al medallón en 320 px (28 y 37 KB).
- Si Node no está disponible, la Skill lo avisa y se detiene.

Alternativa descartada: no tener ningún script y que el agente copie las plantillas y escriba un `data.js`. Funciona sin dependencias, pero pierde la validación previa, y el agente no se entera de los errores.

---

## 4. Formatos de revisión

| Formato | Cantidad | Para qué | Ejemplos | Cómo se responde |
|---|---|---|---|---|
| **Flashcards** (pregunta delante, respuesta detrás) | 6–10 | Conocer lo concreto de la implementación | Métodos utilizados, detalle de código, valores por defecto, dónde se valida X | Gira la tarjeta y ve la respuesta |
| **Test** de selección simple o múltiple | 3–4 | Comprobar la comprensión de decisiones y conceptos | Verdadero/Falso, preguntas conceptuales, «¿qué ocurre si…?» con opciones | Elige opción(es); después se muestran la respuesta correcta, la explicación y la evidencia |
| **Preguntas abiertas** | 1–2 | Explorar consecuencias y casos límite | What if, escenarios de fallo, cambios de requisitos | Texto libre; después ve la respuesta de referencia del agente |

**Cantidades (propuesta):** son rangos orientativos. Si el cambio es pequeño, el motor puede generar menos preguntas; el esquema fija los máximos. No se rellena por rellenar.

**Las preguntas abiertas no se corrigen automáticamente** (no hay backend): tras responder, el humano compara su texto con la respuesta de referencia del agente.

---

## 5. Modelo de datos (v1.0, implementado)

Un único contrato: `.claude/skills/supervise/schema/review.schema.json`. Lo produce el motor de análisis (agente) y lo consume el renderizador. Hay un ejemplo completo y válido en `examples/review.example.json`.

### `review.json`

```
schemaVersion: "1.0"
meta            reviewId, project, title, missionName?, summary, generatedAt, generator?,
                source{type:"branch", base, head, mergeBase, commit, dirty}, stats?, specs[]?
requirements[]? R1…  source, ref? (p. ej. "AC-4"), text
focuses[]  1–12 F1…  type (change|decision|risk|requirement-gap|test-gap), priority (high|medium|low),
                     basis (observed|inferred), title, why, requirementIds[]?, evidence[1–5]
flashcards[] 1–10 C1…  focusIds[1–3], category?, front, title, back, evidence[1–2]
quiz[]       1–4  Q1…  focusIds, kind (single|multiple), title, prompt, options[{id,text,detail?,why?*}],
                       correct[ids], explanation, evidence    (* why obligatorio en las incorrectas)
scenarios[]  1–2  S1…  focusIds, title, situation, prompt, evidence

evidence:  kind (code|diff|spec|test|config|doc), file (ruta relativa segura), lines{start,end}?,
           highlight[]?, language?, snippet (obligatorio, ≤ 60 líneas), note?
```

Reglas principales:

- **Textos en texto plano**, con límites de longitud. Formato en línea permitido: `código` con comillas invertidas y **negrita** con dobles asteriscos. Nunca HTML.
- **`additionalProperties: false` en todos los objetos**: una errata del agente (`answer` en vez de `back`) es un error, no un campo que se ignora.
- **Snippet obligatorio** en cada evidencia, porque el HTML no puede leer el repositorio.
- **Rutas relativas seguras**: sin `/` inicial, sin unidades de Windows (`C:`) y sin `..`.
- **Test** (`quiz[]`): cada pregunta tiene `title`, `prompt` y opciones con `text` y un `detail` opcional. `single` tiene de 2 a 6 opciones y una correcta (verdadero/falso es un `single` con dos opciones). `multiple` tiene de 3 a 6 opciones y 2 o más correctas, sin que lo sean todas. Los ids de opción son `a`–`f` y la interfaz los muestra en mayúsculas. `detail` se ve antes de responder, así que debe ser neutro. Las opciones **incorrectas llevan `why` obligatorio** (por qué lo son), que se muestra si el humano las elige.
- El **mínimo duro es 1 pregunta por nivel**. Los rangos recomendados (6–10 / 3–4 / 1–2) generan *avisos*, no errores.

### Validación

`node scripts/validate.mjs <review.json> [--repo <raíz>]`. Termina con 0 si es válido, 1 si hay errores y 2 si el uso es incorrecto.

1. **Estructura:** `lib/schema-subset.mjs` interpreta un subconjunto de JSON Schema. Si el schema usa una palabra clave no soportada, **lanza una excepción**, de modo que schema y validador no pueden divergir. El schema es la única fuente de verdad.
2. **Semántica:** `lib/validate-review.mjs` comprueba IDs únicos, referencias a focos y requisitos, reglas de las preguntas de test, rangos de líneas y *highlight*, y el máximo de 60 líneas por snippet. Además emite **avisos de calidad**: pocas preguntas o focos (sobre todo los de prioridad alta) sin ninguna pregunta.
3. **Evidencias** (`lib/evidence.mjs`, solo con `--repo`): cada fragmento debe coincidir con las líneas del archivo. Si no, el error indica la línea real. Las evidencias de diff no se verifican línea a línea. Las rutas que salen del repositorio se rechazan.
4. Las librerías no usan `fs`: se pueden incrustar en el HTML para validar también en el navegador.

Tests: `node --test tests/` (83 casos: contrato, ensamblado, verificación de evidencias, recolección de contexto con repositorios temporales, coherencia de la Skill y un recorrido completo en Chrome sin interfaz, que se omite si no hay Chrome).

---

## 6. Principios de diseño

1. **Supervisión antes que aprendizaje.** Se prioriza revisar decisiones, riesgos y conformidad con requisitos. El aprendizaje es un efecto secundario.
2. **Toda pregunta nace de un foco** y toda afirmación lleva evidencia (archivo/líneas, diff o requisito).
3. **Hechos, inferencias y riesgos, separados.** La prioridad o el riesgo que sugiere el LLM es orientativa, no una garantía.
4. **El agente no se evalúa a sí mismo sin contraste.** La respuesta «correcta» la genera el mismo LLM que implementó. Por eso cada pregunta lleva su evidencia: el humano puede comprobar la respuesta en el código en lugar de fiarse del agente.
5. **Interacción informativa.** Responder no aprueba técnicamente el código ni dispara cambios en el repositorio.
6. **Separar contenido y presentación.** El LLM produce JSON validado. Las plantillas HTML son fijas y reutilizables.
7. **Contenido del repositorio no confiable.** Los datos se insertan como texto (`textContent`) y nunca como HTML o JS ejecutable.
8. **Trazabilidad.** Cada revisión queda asociada a un commit o diff concreto.
9. **Sin presión por aprobar rápido.** Se acepta la narrativa de juego (misiones, niveles, héroe) y el progreso, pero no puntos, rankings ni temporizadores. *Completar* un nivel significa haber llegado a la respuesta correcta, con los intentos que hagan falta. Los fallos no puntúan ni penalizan.

---

## 7. Salidas

Cada revisión vive en `.hitl/reviews/<id>/` dentro del proyecto revisado. El `<id>` combina rama, commit corto, `-dirty` si hay cambios sin commitear y fecha y hora, p. ej. `feature-001-auth-a4dd0da-dirty-20261127-0038`.

| Archivo | Quién lo genera | Uso |
|---|---|---|
| `context.json` | `context.mjs` | Metadatos, archivos, commits, especificaciones, convenciones y avisos |
| `changes.patch` | `context.mjs` | Diff completo sin generados |
| `review.json` | El agente | Focos, preguntas y evidencias, validados por esquema |
| `review.html` | `build.mjs` | Experiencia interactiva local, sin conexión |

La carpeta `.hitl/` debería estar en `.gitignore`. La Skill avisa si no lo está, pero no lo modifica.

**Al final del mapa**, los escenarios se copian al portapapeles para pegarlos en el chat con el agente. Es la única vuelta de información al agente. El resto del feedback humano queda aparcado (sección 7, *Aparcado*).

### Aparcado: resto del feedback humano

**Dentro del alcance:** copiar al portapapeles las respuestas de los escenarios (sección 3.3). Es el único canal de vuelta al agente y no usa ficheros ni esquema propio.

**Fuera del alcance actual**, para retomar cuando la evaluación esté cerrada:

- Valoraciones por pregunta (p. ej. «No me convence» / «Discrepo») para señalar que el fallo puede estar en el código o en la respuesta del agente.
- Ampliar la copia al portapapeles con lo que fallaron o dudaron en el test y las flashcards. Sería la extensión natural del mecanismo de los escenarios.
- Exportar un informe Markdown (`review-feedback.md`) y un segundo contrato (`feedback.schema.json`). Existió una primera versión; se eliminó para simplificar.

## 8. Estructura de la Skill

Ubicación: `.claude/skills/supervise/`. ✅ = ya existe.

```
.claude/skills/supervise/
├── SKILL.md                        ✅ Flujo completo: contexto, análisis, build y entrega
├── references/
│   └── analysis-guide.md           ✅ Criterios de relevancia, evidencias, preguntas y calibración
├── schema/
│   └── review.schema.json          ✅ Contrato del análisis
├── examples/
│   └── review.example.json         ✅ Revisión completa de ejemplo (auth con sesiones)
├── templates/                      ✅ Lo que se ensambla en review.html
│   ├── page.html                   #   Mapa de misiones, modal, iconos y marcadores de ensamblado
│   ├── styles.css                  #   Estilos (sin recursos externos)
│   ├── app.js                      #   Comportamiento: mapa, tres niveles, copia y final
│   ├── flashcards.html             #   Nivel 01
│   ├── quiz.html                   #   Nivel 02
│   └── scenarios.html              #   Nivel 03 (escribir y resumen)
├── assets/                         ✅ background.jpg, padi.jpg, master_padi.jpg y fuentes (Cinzel y Outfit, OFL)
└── scripts/
    ├── lib/
    │   ├── schema-subset.mjs       ✅ Intérprete de JSON Schema (subconjunto), sin dependencias
    │   ├── validate-review.mjs     ✅ Validación estructural + semántica
    │   ├── scenario-export.mjs     ✅ Texto que se copia al portapapeles (también se incrusta en el HTML)
    │   ├── evidence.mjs            ✅ Comprueba que las evidencias coinciden con el archivo
    │   ├── repo-context.mjs        ✅ Rama base, merge-base, diff, commits, specs y convenciones
    │   └── build-html.mjs          ✅ Ensamblado y comprobación de que no hay recursos externos
    ├── validate.mjs                ✅ CLI de validación
    ├── build.mjs                   ✅ CLI: valida review.json y genera review.html
    └── context.mjs                 ✅ CLI de contexto: escribe context.json y changes.patch

tests/                              ✅ validate · build · evidence · context · skill · e2e (en la raíz del repo, fuera de la Skill)
design/                             ✅ Propuestas visuales (test, flashcards y escenarios)
```

> La carpeta `supervise/` de la raíz del repo es un prototipo visual anterior. No choca con la Skill, que vive en `.claude/skills/supervise/`.

---

## 9. Decisiones acordadas

1. **Orientación principal: supervisión** de lo importante de una feature, PR o código.
2. **Punto de entrada: una Skill de Claude Code.** No se busca compatibilidad con todos los agentes desde el inicio.
3. **Tres componentes:** Skill de entrada, motor de análisis (salida JSON validada por esquema) y renderizador interactivo.
4. **Tres formatos de pregunta:** flashcards (6–10), test de selección simple o múltiple (3–4) y preguntas abiertas (1–2).
5. **Plantilla HTML por formato.** El agente genera solo los datos y el HTML final se ensambla a partir de las plantillas.
6. **Interacción informativa.** El feedback humano y el informe quedan aparcados (sección 7, *Aparcado*).
7. **Validación posterior en un proyecto pequeño con SpecKit.**
8. **Diseño incremental.**
9. **Nombre: `/supervise`.** Por defecto revisa la rama actual frente a su base (merge-base) e incluye los cambios sin commitear. Acepta `/supervise <rama>` y `--base` (sección 3.1).
10. **Scripts en Node.js ≥ 18 sin dependencias**, con un validador propio y un HTML autocontenido (sección 3.4).
11. **Las pantallas las define el equipo:** primero la vista de la pantalla principal y después la de cada componente.
12. **Pantalla principal = «Mapa de misiones»** con tres niveles: Flashcards, Test con opciones y Escenarios. Cada nivel abre un modal que contiene solo la tarjeta del nivel (sección 3.3).
13. **Los niveles se hacen en cualquier orden**, sin bloqueos. Un nivel se conquista al resolver todas sus preguntas. Sin barra inferior.
14. **Héroe fijo:** «Padi · Guardián de PR». Los recursos gráficos están en `assets/`.
15. **Contrato v1.0:** `review.schema.json` (sección 5).
16. **El HTML funciona sin conexión** y sin recursos externos (sección 3.4).
17. **Test:** si falla, se indica por qué y se reintenta hasta acertar; si acierta, se muestra la explicación y «Ver por qué» despliega la evidencia.
18. **Escenarios:** el humano escribe, recorre todos y copia preguntas y respuestas al portapapeles para que el agente las evalúe. No hay respuesta de referencia en el HTML.
19. **Final:** al conquistar los tres niveles aparece el maestro Padi con el mensaje «¡Has finalizado la revisión!».
20. **Solo evaluación.** Se elimina `feedback.schema.json`, su ejemplo y su validación.
21. **Skill `/supervise` en Claude Code:** `SKILL.md` + `references/analysis-guide.md` + `scripts/context.mjs`. El agente hace el análisis con esa guía; el HTML sale siempre del build.
22. **Evidencias verificadas:** `build.mjs --repo` rechaza cualquier fragmento que no coincida con el archivo. Así el agente no puede citar líneas inventadas.
23. **Sin inventar normas:** las preguntas solo pueden apoyarse en el código, las specs o prácticas generales sin atribución a ninguna organización.
24. **Revisión por defecto:** rama actual frente al merge-base, incluidos cambios sin commitear y archivos nuevos. Lockfiles y generados se excluyen y se listan.
25. **El HTML no se abre solo:** la Skill muestra la ruta y el usuario decide.

---

## 10. Cuestiones abiertas

- **Pantallas pendientes de validar:** estados del test, flashcards y escenarios (propuestas en `design/`). ¿Dónde se ven los focos de revisión (el «por qué» de cada pregunta)?
- **Salida para el humano atrapado** (sección 3.3): ¿mostrar la respuesta correcta tras 2 fallos?
- **Flashcards y escenarios:** validar la propuesta visual y los criterios de «conquistado» (todas volteadas / todos comparados).
- **Escenarios:** ¿se exige un mínimo de texto para dar un escenario por respondido?
- **Texto copiado:** ¿la instrucción fija es la adecuada? ¿conviene incluir los fragmentos de código o basta con las rutas?
- **Revisión por número de PR** (`/supervise pr 123`) con `gh`, que también daría la descripción del PR como intención.
- **Instalación fuera de este proyecto:** hoy la Skill vive en `.claude/skills/supervise/`. Para usarla en otros repositorios hay que instalarla en `~/.claude/skills/`; las rutas `<skill>` del SKILL.md ya son relativas a su carpeta.
- **Independencia del análisis:** el mismo modelo que escribió el código lo revisa. La verificación de evidencias limita los errores de cita, pero no los de criterio. Valorar una segunda pasada con otro modelo o un subagente.
- **Persistencia:** los borradores de los escenarios se guardan en `localStorage` (propuesta). ¿También el progreso del test y las flashcards?
- **Proyecto SpecKit de prueba** y criterios de éxito de la demo.

---

## 11. Hoja de ruta

| Etapa | Objetivo | Entregable |
|---|---|---|
| 1. Contrato ✅ | Esquema JSON y un `review.json` de ejemplo hecho a mano | `review.schema.json`, ejemplo, validador y tests |
| 2. Renderizador ✅ | Plantillas por formato + mapa de misiones, probadas con el ejemplo | `templates/` + `scripts/build` |
| 3. Motor de análisis ✅ | Instrucciones y guía para que el agente produzca JSON válido y relevante | `SKILL.md` + `analysis-guide.md` |
| 4. Skill de entrada ✅ | Detección de proyecto y specs, obtención del diff y flujo completo | `context.mjs` + `SKILL.md`. Falta probarla con un análisis real del agente |
| 5. Integración SpecKit | Probar con una feature real | Flujo extremo a extremo |
| 6. Evaluación y demo | Medir utilidad y preparar la demostración | Demo reproducible |

Las etapas 1 y 2 se pueden avanzar con datos de ejemplo, sin depender del motor. Las etapas 3 y 4 se pueden iterar en paralelo una vez fijado el contrato.

### Indicadores candidatos para la evaluación

- Tiempo total de revisión.
- Problemas o desviaciones conocidos detectados y omitidos. La demo puede incluir una decisión discutible, una desviación de requisitos y un fallo conocido.
- Relevancia de los focos y falsos positivos.
- Utilidad percibida de las preguntas para entender el cambio.

---

### Procedencia

Consolida `propuesta-hackathon-human-in-the-loop.md` (propuesta original), el análisis de una conversación previa y la redefinición del 2026-11-26. Diferencias principales con la versión anterior: los formatos de pregunta (flashcards, test y abiertas) pasan de «no prioritarios» a ser el núcleo del MVP, siempre anclados a focos de revisión. El alcance se concreta en postimplementación y Claude Code.
