# Simplificación de la skill `supervise`

> Tareas acordadas tras la revisión de sobrediseño. Marca `[x]` al completar cada una.
> Antes de cada cambio, ejecutar los tests (`tests/`) y actualizarlos junto con el código.

## Fase 1 · Limpieza del repositorio (riesgo mínimo)

- [x] **1.1** Eliminar `scripts/validate.mjs` (lo duplica `build.mjs`, que ya valida y verifica evidencias). Ajustar `tests/evidence.test.mjs` y `tests/validate.test.mjs`, que lo invocan.

## Fase 2 · Recortar el contrato (esquema y validación)

> Antes de empezar: comprobar en `templates/app.js` qué campos usa realmente la UI.

- [x] **2.1** Eliminar `requirements`, `focus.requirementIds` y `meta.specs`; las referencias a la spec pasan a ser evidencias `kind: "spec"`. Actualizar esquema, validador, plantillas, ejemplo, `analysis-guide.md` y `SKILL.md`.
- [x] **2.2** Quitar campos poco útiles: `category` (flashcards), `generator`, `highlight`, y valorar `language`, `note`, `basis` y `missionName`. Conservar `type` y `priority` en los focos.
- [x] **2.3** Dejar una única fuente para los límites de cantidad (esquema o validador, no ambos ni `SKILL.md`). Solo los máximos son duros; eliminar los avisos de cuota `RECOMMENDED` que contradicen «no rellenes cuotas».
- [x] **2.4** (descartada: se mantiene el validador propio) Decidir y ejecutar una de estas opciones:
  - [ ] ~~a) Eliminar el esquema y dejar solo el validador semántico en código; borrar `schema-subset.mjs`.~~
  - [ ] ~~b) Mantener el esquema y sustituir `schema-subset.mjs` por `ajv`.~~ Descartada: ajv 8 + `ajv-formats` + 4 dependencias transitivas obligarían a vendorizar `node_modules` en una skill sin dependencias, para ahorrar ~136 líneas ya probadas.

## Fase 3 · Simplificar la recogida de contexto (`repo-context.mjs`)

- [x] **3.1** Sustituir la heurística de asociación de specs (regex nombre de rama ↔ carpeta) por pasar al agente la lista de carpetas de `specs/` y que decida; eliminar los avisos de «specs no asociadas».
- [x] **3.2** Reducir a un solo modo: diff de la rama actual contra el merge-base, incluido lo sin commitear. Retirar `/supervise <rama>` y simplificar `-dirty`, avisos y casos de prueba asociados. Actualizar `SKILL.md` y el documento de contexto.
- [x] **3.3** Consolidar los límites en un único umbral de «diff grande»; eliminar `untrackedBytes`, el tope de commits y los casos poco probables.

## Fase 4 · Simplificar la generación del HTML

- [x] **4.1** Quitar `findExternalReferences` del build; convertirlo en un test.
- [x] **4.2** Eliminar la incrustación de `scenario-export.mjs` con regex (`replace(/^export /gm, '')`): mover la función a `app.js` o importarla de forma normal.

## Fase 5 · Documentación

- [x] **5.1** Eliminar reglas repetidas entre `SKILL.md`, `analysis-guide.md` y `HUMAN-IN-THE-LOOP-PROJECT-CONTEXT.md` (invocación, límites, flujo); dejar una fuente por tema.
- [x] **5.2** Actualizar `HUMAN-IN-THE-LOOP-PROJECT-CONTEXT.md` (456 líneas) con las decisiones tomadas y recortarlo.

## Se mantiene (no tocar)

- `verifyEvidence`: comprobar que cada snippet existe en el archivo.
- `safeJson` y el escape de `<` en el JSON incrustado.
- El flujo de 6 pasos de `SKILL.md`.

## Criterio de terminado

- [x] Todos los tests pasan (`node --test tests/`).
- [ ] Se genera un `review.html` de ejemplo de principio a fin con `/supervise`.

## Notas de ejecución

- 2.1/2.2: eliminados `requirements`, `requirementIds`, `meta.specs`, `meta.generator`, `basis`, `category` (con su chip en la UI), `highlight` (con su estilo) y `language`. Se mantienen `note` y `missionName`, que la UI sí pinta.
- 2.3: los máximos viven solo en el esquema; `RECOMMENDED` y sus avisos eliminados. Sigue el aviso de focos sin preguntas.
- `examples/review.example.json` y `examples/review.html` regenerados. `HUMAN-IN-THE-LOOP-PROJECT-CONTEXT.md` aún menciona campos antiguos (pendiente, fuera del alcance actual).
- Tests: 79 pasan.
- 3.1: `specs` pasa a ser la lista `{ dir, files }` de todas las carpetas de `specs/`; el agente lee las que encajan. Sin títulos, sin contenido embebido y sin avisos de «no asociadas».
- 3.3: `LIMITS` queda en `conventionsBytes`, `readmeBytes` y `largePatchLines`. Eliminados el límite de archivos nuevos grandes, el de bytes del parche y el tope de commits.
- 4.1: `findExternalReferences` salió del build; vive como helper en `tests/build.test.mjs`.
- 4.2: `buildScenarioExport` está ahora dentro de `templates/app.js` y `scenario-export.mjs` se borró. Sus tests unitarios pasaron al e2e en Chrome (captura lo que se copia). Se perdió la prueba del texto con «cambios sin commitear».
- 3.2: `/supervise <rama>` eliminado. `collectContext` ya no tiene `mode` ni `branch`; `dirty` es un booleano. Para revisar otra rama hay que hacer checkout.
- 5.1/5.2: `HUMAN-IN-THE-LOOP-PROJECT-CONTEXT.md` pasó de 456 a ~250 líneas: quita las tablas de UI, el listado del esquema y el árbol detallado, y enlaza al código en su lugar. Corrige referencias obsoletas (`design/`, `validate.mjs`, respuesta de referencia).
- Tests: 70 pasan.
- Queda sin marcar solo la prueba extremo a extremo de `/supervise` con un análisis real del agente.
