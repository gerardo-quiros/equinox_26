import json, sys
ROOT = "/Users/id05402/Projects/litellm-gateway"
R = ROOT + "/.hitl/reviews/feature-004-guardrail-platform-mvp-bc6c086-dirty-20261127-0630"
ctx = json.load(open(R + "/context.json"))

def lines_of(f, a, b):
    L = open(f"{ROOT}/{f}", encoding="utf-8").read().split("\n")
    return "\n".join(L[a-1:b])

def ev(kind, f, a, b, note=None):
    e = {"kind": kind, "file": f, "lines": {"start": a, "end": b}, "snippet": lines_of(f, a, b)}
    if note: e["note"] = note
    return e

def ref(f, a=None, b=None, snippet=False):
    r = {"file": f}
    if a:
        r["lines"] = {"start": a, "end": b or a}
        if snippet: r["snippet"] = lines_of(f, a, b or a)
    return r

MAIN = "platform/guardrail_platform/main.py"
ADAPTER = "gateway/platform_adapter.py"
COMPOSE = "docker-compose.yml"
CONFIG = "config.yaml"
DEFS = "platform/definitions/definitions.yaml"
SPEC = "specs/004-guardrail-platform-mvp/spec.md"
CHECK = "scripts/check-platform.sh"
PIPE = "platform/guardrail_platform/pipeline.py"
REGEX = "platform/guardrail_platform/engines/regex_engine.py"
INJ = "platform/guardrail_platform/engines/injection_heuristic.py"
MODELS = "platform/guardrail_platform/models.py"
DEFPY = "platform/guardrail_platform/definitions.py"

meta = dict(ctx["metaDraft"])
meta["summary"] = ("Añade la plataforma de guardrails (FastAPI + motores regex e injection-heuristic) y un adaptador fail-closed en LiteLLM. "
    "Diff grande: ~32 000 de las 34 000 líneas son artefactos de `.hitl/`; se revisó el código de `platform/` y `gateway/`. "
    "Los cambios sin commitear desactivan la autenticación del endpoint y recortan definiciones; el puerto 8000 está publicado.")
meta["missionName"] = "Puerta del Guardián"

focuses = [
 {"id":"F1","type":"risk","priority":"high","title":"Autenticación de /v1/check anulada por un `return`",
  "why":"Un `return` colocado antes de `hmac.compare_digest` hace que `require_token` acepte cualquier petición, con o sin token. Es un cambio sin commitear: parece una prueba temporal, pero rompe FR-004 y el check P02 (401 sin token). Si se commitea, el endpoint queda abierto.",
  "evidence":[ev("diff",MAIN,51,55,"Cambio sin commitear: la línea `return` (53) no está en HEAD."),
              ev("spec",SPEC,126,126)]},
 {"id":"F2","type":"requirement-gap","priority":"high","title":"El puerto 8000 de la plataforma se publica en todas las interfaces",
  "why":"La spec exige que la plataforma no publique ningún puerto (FR-001) y que nada se exponga fuera de `127.0.0.1` (FR-024). El commit `feat: tunnel port in platform` añade `\"8000:8000\"`, que enlaza a `0.0.0.0`. Junto con F1, cualquiera en la red podría llamar a `/v1/check` sin token. Puede ser intencionado para depurar; hay que confirmarlo.",
  "evidence":[ev("config",COMPOSE,36,45),
              ev("config",COMPOSE,54,58,"El servicio litellm sí enlaza a `127.0.0.1`."),
              ev("spec",SPEC,160,160)]},
 {"id":"F3","type":"requirement-gap","priority":"high","title":"Definiciones e IBAN recortados frente a la spec",
  "why":"FR-012 pide exactamente cuatro definiciones; el YAML activo tiene dos (se quitaron el keyword bloqueado y el DNI, este último comentado). Además `iban-mask-input`, que FR-018 obliga a mantener, está comentado en `config.yaml`. Las historias de usuario de DNI, keyword e IBAN y los checks P04, P07, P12 y P14 dejan de cumplirse. La intención (¿experimento temporal?) se infiere.",
  "evidence":[ev("config",DEFS,27,44),
              ev("diff",CONFIG,36,47,"El guardrail `iban-mask-input` pasó a comentarios."),
              ev("spec",SPEC,137,137),
              ev("spec",SPEC,149,149),
              ev("test",CHECK,460,471,"P07 espera que `project-nightfall` se bloquee; esa definición ya no existe.")]},
 {"id":"F4","type":"risk","priority":"medium","title":"Regex sin límite de tamaño y timeout de 2 s",
  "why":"El patrón de email `[A-Za-z0-9._%+-]+@…` es cuadrático en textos largos sin `@`: medido en local, 100 000 caracteres tardan unos 4 s (20 000, 0,2 s). No hay límite de tamaño de petición. Si la plataforma tarda más de 2 s, el adaptador falla cerrado con 503, y mensajes largos podrían degradar el servicio. La medición no pasó por el servicio real.",
  "evidence":[ev("config",DEFS,27,34),
              ev("code",REGEX,52,58),
              ev("code",ADAPTER,20,20,"Timeout fijo de 2 s; al vencer se responde 503.")]},
 {"id":"F5","type":"risk","priority":"medium","title":"Peticiones sin `messages` no pasan por la plataforma",
  "why":"Si `data[\"messages\"]` no es una lista no vacía, el adaptador devuelve `None` sin consultar a la plataforma. Es coherente con «no es chat», pero la spec dice que cada definición se aplica a cada petición. No he comprobado qué rutas de LiteLLM con clave virtual llegan a este hook sin `messages` (completions, embeddings, responses): requiere confirmación.",
  "evidence":[ev("code",ADAPTER,55,57),
              ev("spec",SPEC,132,132)]},
 {"id":"F6","type":"test-gap","priority":"low","title":"Sin pruebas unitarias de motores ni pipeline",
  "why":"La lógica de `evaluate()` y de los motores solo se verifica con scripts de shell que necesitan Docker, Ollama y el stack completo. No hay carpeta de tests ni pytest en `platform/` (búsqueda de `test*` y `pytest` en `platform/` sin resultados). Un cambio en el orden o en el bloqueo solo se detecta con el stack levantado.",
  "evidence":[ev("code",PIPE,43,68,"Núcleo de la decisión, sin pruebas unitarias propias.")]},
 {"id":"F7","type":"decision","priority":"low","title":"`.hitl/` sin ignorar mete miles de líneas en el diff",
  "why":"Los artefactos de revisiones anteriores (`.hitl/`) están sin ignorar y suman unas 32 000 líneas al diff; además `.DS_Store` aparece como nuevo. `.gitignore` añade la ruta de una skill pero sin salto de línea final. Conviene ignorar `.hitl/` y `.DS_Store` antes de commitear.",
  "evidence":[ev("diff",".gitignore",1,5,"El cambio sin commitear añade la última línea.")]},
]
# .gitignore diff snippet: use actual file content marked as code
focuses[6]["evidence"][0]["kind"] = "config"

flashcards = [
 {"id":"C1","focusIds":["F1"],"front":"Si una petición llega a `/v1/check` sin cabecera `Authorization`, ¿qué hace hoy `require_token`?",
  "title":"No comprueba nada","back":"Hace `return` antes de `hmac.compare_digest`, así que acepta cualquier petición. La comprobación de la línea siguiente es código inalcanzable.",
  "evidence":[ev("code",MAIN,51,55)]},
 {"id":"C2","focusIds":["F2"],"front":"¿Cómo se publica el puerto del servicio `platform` en el host y en qué se diferencia del de `litellm`?",
  "title":"`8000:8000`, sin IP","back":"`\"8000:8000\"` enlaza a todas las interfaces. `litellm` usa `127.0.0.1:${LITELLM_PORT}:4000`, solo local. La spec no permite ningún puerto en la plataforma.",
  "evidence":[ev("config",COMPOSE,39,40),ev("config",COMPOSE,56,57)]},
 {"id":"C3","focusIds":["F3"],"front":"¿Cuántas definiciones activas tiene `definitions.yaml` y cuáles son?",
  "title":"Dos: injection y email","back":"`prompt-injection` y `email-mask`. La spec (FR-012) pide cuatro; el keyword bloqueado se eliminó y `es-dni-mask` está comentada.",
  "evidence":[ev("config",DEFS,6,10),ev("spec",SPEC,137,137)]},
 {"id":"C4","focusIds":["F4"],"front":"¿Qué ocurre si la plataforma tarda más que el timeout del adaptador?",
  "title":"503 «timeout», fail-closed","back":"El adaptador captura `httpx.TimeoutException` y lanza `HTTPException` 503 con «Guardrail platform unavailable: timeout». El timeout vale 2,0 s.",
  "evidence":[ev("code",ADAPTER,20,20),ev("code",ADAPTER,66,67)]},
 {"id":"C5","focusIds":["F5"],"front":"¿Qué devuelve `async_pre_call_hook` si `data[\"messages\"]` falta o está vacío?",
  "title":"`None`, sin consultar","back":"Devuelve `None` («nada que comprobar») antes de llamar a la plataforma. La petición sigue su curso sin ningún guardrail de la plataforma.",
  "evidence":[ev("code",ADAPTER,55,57)]},
 {"id":"C6","focusIds":["F6"],"front":"En `evaluate()`, ¿cuándo se detiene la evaluación y qué ve cada definición?",
  "title":"En el primer bloqueo","back":"Las definiciones se recorren por `order`; cada una ve el texto ya enmascarado por las anteriores. La primera que devuelve `block_reason` termina con `decision: block`.",
  "evidence":[ev("code",PIPE,48,62)]},
 {"id":"C7","focusIds":["F7"],"front":"¿Qué línea añade a `.gitignore` el cambio sin commitear y qué carpeta generada sigue sin ignorarse?",
  "title":"Añade la skill; falta `.hitl/`","back":"Añade `.claude/skills/la-senda` (sin salto de línea final). `.hitl/`, donde se guardan las revisiones, no figura, así que sus archivos entran en el diff.",
  "evidence":[ev("config",".gitignore",1,5)]},
]

def opt(i, text, why=None, detail=None):
    o = {"id": i, "text": text}
    if detail: o["detail"] = detail
    if why: o["why"] = why
    return o

quiz = [
 {"id":"Q1","focusIds":["F1","F2"],"kind":"single","title":"Llamada sin token desde otra máquina",
  "prompt":"Con la rama tal como está en disco y el stack levantado, una máquina de la misma red hace `POST http://<host>:8000/v1/check` con un cuerpo válido y sin cabecera `Authorization`. ¿Qué responde la plataforma?",
  "options":[
   opt("a","401 `unauthorized`",why="Eso es lo que espera el check P02, pero el `return` de la línea 53 de `main.py` salta la comprobación."),
   opt("b","200 con una decisión (`allow`, `modify` o `block`)"),
   opt("c","Conexión rechazada: el puerto no está publicado",why="`docker-compose.yml` publica `\"8000:8000\"` en el servicio `platform`."),
   opt("d","422 por falta de cabecera",why="`Authorization` tiene `default=\"\"`; la validación de FastAPI no falla por su ausencia.")],
  "correct":["b"],
  "explanation":"El puerto está publicado en todas las interfaces y `require_token` retorna antes de comparar el token, así que el endpoint procesa el cuerpo y devuelve una decisión.",
  "evidence":[ev("code",MAIN,51,55),ev("config",COMPOSE,36,42)]},
 {"id":"Q2","focusIds":["F3"],"kind":"multiple","title":"Comportamientos que ya no se cumplen",
  "prompt":"¿Qué tres comportamientos que exige la spec dejan de ocurrir con los `config.yaml` y `definitions.yaml` actuales?",
  "options":[
   opt("a","El DNI de la petición se enmascara con `[ES_DNI_MASKED]`"),
   opt("b","`project-nightfall` en cualquier mayúscula se rechaza"),
   opt("c","El email se sustituye por `[EMAIL_MASKED]`",why="`email-mask` sigue activa en `definitions.yaml` (orden 30)."),
   opt("d","«ignore all previous instructions» se rechaza",why="`prompt-injection` sigue activa (orden 10) y contiene esa frase."),
   opt("e","El IBAN español se enmascara antes de llegar al modelo")],
  "correct":["a","b","e"],
  "explanation":"`es-dni-mask` está comentada, `blocked-keyword-nightfall` se eliminó y `iban-mask-input` está comentado en `config.yaml`. Email e injection siguen activas.",
  "evidence":[ev("config",DEFS,6,10),ev("config",DEFS,36,44),ev("diff",CONFIG,36,47)]},
 {"id":"Q3","focusIds":["F4"],"kind":"single","title":"La plataforma tarda más de 2 s",
  "prompt":"Una petición provoca que `/v1/check` tarde 5 s en responder. ¿Qué ve el cliente de LiteLLM?",
  "options":[
   opt("a","La petición llega al modelo con los mensajes originales",why="Sería fail-open; FR-016 y el adaptador exigen rechazar."),
   opt("b","Un 503 «Guardrail platform unavailable: timeout» y no se invoca el modelo"),
   opt("c","Un 400 «Blocked by guardrail platform» con la regla que tardó",why="El 400 solo se emite con `decision == \"block\"`; un timeout no llega a tener decisión."),
   opt("d","El adaptador reintenta una vez y acepta la segunda respuesta",why="No hay reintentos: `post` se llama una sola vez y el timeout lanza `_unavailable(\"timeout\")`.")],
  "correct":["b"],
  "explanation":"El `httpx.AsyncClient` tiene `Timeout(2.0)`; al vencer, `async_pre_call_hook` lanza `_unavailable(\"timeout\")` (503) antes de cualquier llamada al modelo.",
  "evidence":[ev("code",ADAPTER,20,20),ev("code",ADAPTER,60,69),ev("spec",SPEC,144,144)]},
 {"id":"Q4","focusIds":["F5"],"kind":"single","title":"Cuerpo sin `messages`",
  "prompt":"Al hook `async_pre_call_hook` llega un `data` con `prompt` pero sin `messages`. ¿Qué hace el adaptador?",
  "options":[
   opt("a","Responde 503 por cuerpo no reconocible",why="El 503 solo se lanza cuando falta token o falla la llamada a la plataforma."),
   opt("b","Envía todo `data` a `/v1/check` para que decida la plataforma",why="`CheckRequest` exige `messages` con al menos un elemento; el adaptador ni siquiera hace la llamada."),
   opt("c","Devuelve `None` sin llamar a la plataforma"),
   opt("d","Rechaza con 400 «not a chat request»",why="Ese texto solo existe en un comentario; no hay ningún rechazo en esa rama.")],
  "correct":["c"],
  "explanation":"La rama `if not isinstance(messages, list) or not messages: return None` omite la consulta. Que esas rutas lleguen al hook es una deducción por confirmar.",
  "evidence":[ev("code",ADAPTER,55,57)]},
]

scenarios = [
 {"id":"S1","focusIds":["F1","F2"],"title":"Docker Compose en una red compartida",
  "situation":"Supongamos que se commitea la rama tal cual está en disco y alguien ejecuta `docker compose up` en una red compartida (coworking u oficina), con el firewall del equipo abierto.",
  "prompt":"¿Qué podría hacer otra persona de esa red con la plataforma? ¿Aceptarías esto en la entrega y qué pedirías antes?",
  "evidence":[ev("code",MAIN,51,55),ev("config",COMPOSE,36,42)]},
 {"id":"S2","focusIds":["F4"],"title":"Mensajes enormes y checks de salud",
  "situation":"Supongamos que un cliente con clave válida envía, de forma repetida, mensajes de 200 000 caracteres sin ninguna `@`, mientras otros usuarios hacen peticiones normales.",
  "prompt":"¿Qué crees que pasa con el patrón de email, el timeout de 2 s y el resto de peticiones? ¿Lo aceptarías en esta entrega?",
  "evidence":[ev("config",DEFS,27,34),ev("code",ADAPTER,20,20),ev("code","platform/guardrail_platform/main.py",70,75)]},
]

study = {
 "chronicle":{"title":"Puerta del Guardián",
  "text":"La rama construye una plataforma de guardrails en su propio contenedor (FastAPI) con dos motores, `regex` e `injection-heuristic`, y definiciones en un YAML. LiteLLM la consulta antes de cada llamada con un adaptador fino que falla cerrado. Los cambios sin commitear recortan definiciones, anulan el token y el último commit publica el puerto 8000."},
 "map":{
  "flow":[
   {"label":"Guardrail `platform` (config.yaml)","detail":"Pre-call y activo por defecto para toda petición.","ref":ref(CONFIG,48,52)},
   {"label":"PlatformGuardrail.async_pre_call_hook","detail":"Envía `messages` y `team_id` a `/v1/check` con timeout de 2 s.","ref":ref(ADAPTER,44,69)},
   {"label":"POST /v1/check","detail":"Valida el token (hoy anulado) y el cuerpo con `CheckRequest`.","ref":ref(MAIN,70,75)},
   {"label":"evaluate()","detail":"Recorre las definiciones por `order` sobre cada texto de cada mensaje.","ref":ref(PIPE,43,68)},
   {"label":"Motores regex / injection","detail":"`regex` enmascara o bloquea; `injection-heuristic` bloquea por frase normalizada.","ref":ref(REGEX,45,58)},
   {"label":"Decisión aplicada","detail":"`allow` sigue, `block` da 400, `modify` sustituye `messages`; cualquier fallo da 503.","ref":ref(ADAPTER,99,112)}],
  "components":[
   {"name":"gateway/platform_adapter.py","role":"Adaptador","detail":"CustomGuardrail de LiteLLM sin reglas; aplica la decisión y falla cerrado.","ref":ref(ADAPTER)},
   {"name":"guardrail_platform/main.py","role":"API","detail":"FastAPI con `/health` y `/v1/check`; carga ajustes y definiciones en el arranque.","ref":ref(MAIN)},
   {"name":"pipeline.py","role":"Orquestación","detail":"Aplica las definiciones en orden sobre una copia profunda de los mensajes.","ref":ref(PIPE)},
   {"name":"definitions.py","role":"Carga y validación","detail":"Valida el YAML con pydantic y compila cada configuración de motor.","ref":ref(DEFPY)},
   {"name":"engines/regex_engine.py","role":"Motor","detail":"Lista de patrones con acción `mask` o `block`.","ref":ref(REGEX)},
   {"name":"engines/injection_heuristic.py","role":"Motor","detail":"Frases normalizadas (acentos, mayúsculas, espacios) que bloquean.","ref":ref(INJ)},
   {"name":"definitions.yaml","role":"Datos","detail":"Definiciones versionadas: injection y email activas; DNI comentada.","ref":ref(DEFS)},
   {"name":"docker-compose.yml","role":"Infraestructura","detail":"Añade el servicio `platform` (con puerto 8000 publicado) y `PLATFORM_TOKEN`.","ref":ref(COMPOSE,36,52)}],
  "models":[
   {"name":"CheckRequest","role":"Entrada API","detail":"Lo que envía el adaptador; `team_id` se ignora en 004.","fields":["team_id","messages"],"ref":ref(MODELS,10,12)},
   {"name":"Decision","role":"Salida API","detail":"Resultado: allow, block o modify, con los mensajes modificados y lo que actuó.","fields":["decision","reason","messages","acted"],"ref":ref(MODELS,22,26)},
   {"name":"ActedEntry","role":"Salida API","detail":"Definición que actuó: nombre, motor, acción y número de coincidencias.","fields":["name","engine","action","matches"],"ref":ref(MODELS,15,19)},
   {"name":"DefinitionRow","role":"Fila de definición","detail":"Forma del YAML; pensada para convertirse en fila de BD en la 005.","fields":["name","engine","order","config"],"ref":ref(DEFPY,37,45)}],
  "decisions":[
   {"title":"Fail-closed en el adaptador","detail":"Cualquier fallo (red, timeout, 401, respuesta rara) rechaza con 503 en lugar de dejar pasar.","ref":ref(ADAPTER,23,27,True)},
   {"title":"Reglas como datos, motores como código","detail":"Los motores reciben su configuración; las definiciones viven en YAML y se cambian reiniciando solo la plataforma.","focusIds":["F3"]},
   {"title":"Bloqueo antes que enmascarado","detail":"El orden decide qué ve cada definición: `prompt-injection` (10) ve el texto original antes que `email-mask` (30).","ref":ref(DEFS,6,9)},
   {"title":"Errores sin texto del usuario","detail":"`hide_input_in_errors` y mensajes de error propios evitan que token o mensajes acaben en respuestas o logs.","ref":ref(MAIN,58,62)}],
  "edgeCases":[
   {"title":"Plataforma caída o lenta","detail":"El adaptador responde 503 «unavailable» (timeout, unreachable o invalid response) y no llama al modelo.","focusIds":["F4"]},
   {"title":"Definiciones inválidas","detail":"El `lifespan` relanza `DefinitionError`: la plataforma no arranca y el healthcheck falla, así que LiteLLM no sube.","ref":ref(MAIN,40,44,True)},
   {"title":"Contenido como lista de partes","detail":"Solo se evalúan partes `type: text`; las demás pasan sin cambios.","ref":ref(PIPE,14,22)},
   {"title":"Petición sin `messages`","detail":"Se devuelve `None` y no se consulta a la plataforma (por confirmar qué rutas llegan así).","focusIds":["F5"],"ref":ref(ADAPTER,55,57,True)}],
  "tests":[
   {"name":"scripts/check-platform.sh","detail":"Casos P01… con modelo real: token, masking, bloqueo, fail-closed, cambio de definiciones, IBAN. Varios casos ya no coinciden con la configuración.","ref":ref(CHECK)},
   {"name":"scripts/check.sh","detail":"Comprobaciones de la 001 (proxy mínimo) que deben seguir pasando.","ref":ref("scripts/check.sh")},
   {"name":"scripts/check-persistence.sh","detail":"Comprobaciones de la 002 (claves virtuales y persistencia).","ref":ref("scripts/check-persistence.sh")},
   {"name":"scripts/validate-client.sh","detail":"Valida los flujos `/corp/*` del proyecto `../litellm-test`.","ref":ref("scripts/validate-client.sh")}]},
 "teachings":[
  {"title":"Un 503 de «Guardrail platform unavailable» no es un bloqueo","text":"Es fail-closed: el adaptador no pudo obtener una decisión. Mira primero `docker compose logs platform` y el motivo (`timeout`, `unreachable`, `unauthorized`, `invalid response`). Un bloqueo real es un 400 con la regla.","focusIds":["F4"],"ref":ref(ADAPTER,23,27,True)},
  {"title":"Cambiar una definición = reiniciar solo la plataforma","text":"El YAML se lee una vez en el arranque. Si tras editarlo no cambia nada, comprueba que reiniciaste `platform` y que `/health` informa el número de definiciones esperado."},
  {"title":"El orden es parte de la regla","text":"Las definiciones se aplican por `order` y cada una ve el texto ya modificado. Si un bloqueo deja de saltar, mira si una definición anterior enmascaró lo que buscaba.","focusIds":["F3"]},
  {"title":"Antes de commitear, revisa lo que no es tuyo","text":"Esta rama tiene ediciones temporales sin commitear (`return` en la autenticación, definiciones comentadas) y un puerto publicado. Un `git diff` de `main.py`, `config.yaml` y `docker-compose.yml` evita sorpresas.","focusIds":["F1","F2"]}]
}

out = {"schemaVersion":"1.1","meta":meta,"study":study,"focuses":focuses,"flashcards":flashcards,"quiz":quiz,"scenarios":scenarios}
json.dump(out, open(R + "/review.json","w"), ensure_ascii=False, indent=2)
print("ok")
