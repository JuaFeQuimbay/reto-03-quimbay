# Reto 03 · Agente conversacional "Órdenes de Compra SAP"

Agente que lee el paquete de una solicitud de compra (correo, solicitud, cotización, aprobación y factura), lo valida contra los maestros con las reglas de control RC1–RC10, construye la orden de compra tal como quedaría en SAP, genera la evidencia de aprobación y crea la OC en un SAP simulado. Las excepciones no se fuerzan: se bloquean o se devuelven a la analista para que confirme.

- **Link de prueba:** https://reto-03-quimbay.onrender.com (sin clave de acceso)
- **Planteamiento de la solución:** [SOLUCION.md](SOLUCION.md)
- **Repositorio:** https://github.com/JuaFeQuimbay/reto-03-quimbay

> El link corre en el plan gratuito de Render: tras 15 minutos sin uso se duerme y la primera petición tarda ~1 minuto en despertar. Conviene abrirlo un par de minutos antes de la defensa.

## Requisitos

- [Bun](https://bun.sh) 1.x (recomendado) o Node 20+.
- Una clave de API de Anthropic. Sin clave, la aplicación arranca en **modo simulado** (un guion determinista que imita al modelo, sin costo), útil para probar la interfaz.

## Levantar en local

```bash
bun install
cp .env.example .env        # y completar ANTHROPIC_API_KEY
bun run dev                 # http://localhost:3000
```

`bun run dev` levanta backend y front en un solo proceso. Con Docker: `docker build -t reto-03 . && docker run -p 3000:3000 --env-file .env reto-03`.

## Verificación sin modelo (`demo.ts`)

```bash
bun run demo.ts
```

Limpia `out/`, procesa los 6 casos llamando directamente a las herramientas, repite `sol-001` para demostrar la idempotencia, intenta `sol-004` sin confirmación (la compuerta la rechaza) y luego confirma `sol-004`, `sol-005` y `sol-006`. Compara cada paso con el resultado esperado y termina con `✔ TODO OK · 11 pasos verificados` (código de salida 1 si algo difiere). No requiere ninguna clave.

Salidas: `out/<caso>/payload.json`, `out/<caso>/trazabilidad.json`, `out/<caso>/aprobacion.txt`, `out/sap/ordenes.jsonl`, `out/control.csv`, `out/log.jsonl`.

## Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Para usar el modelo | — | Clave de Anthropic. Nunca se expone en el front, los logs ni la API |
| `LLM_PROVIDER` | No | `anthropic` si hay clave, si no `simulado` | `anthropic` \| `simulado` |
| `LLM_MODEL` | No | `claude-opus-5-5` | Modelo. El despliegue usa `claude-sonnet-5-5` |
| `LLM_EFFORT` | No | `medium` | Esfuerzo de razonamiento (`low`…`max`) |
| `LLM_TIMEOUT_MS` | No | `90000` | Timeout por llamada al modelo |
| `MAX_ITERACIONES` | No | `25` | Tope de iteraciones herramienta → modelo por turno (CA1) |
| `MAX_TOKENS_SESION` | No | `600000` | Tope de tokens por sesión |
| `MAX_TOKENS_GLOBAL` | No | `6000000` | Tope de tokens del servidor mientras esté encendido |
| `MAX_MENSAJES_POR_IP` | No | `40` | Mensajes por IP cada 10 minutos |
| `ACCESS_KEY` | No | — | Si se define, el chat exige esta clave (cabecera `x-access-key`) |
| `PORT` | No | `3000` | Puerto HTTP |

## API

| Método | Ruta | Cuerpo → respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendiente, iteraciones, uso, error? }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión, confirmación pendiente y tokens consumidos |
| `GET` | `/api/health` | `{ ok, provider, model, protegido }` sin exponer claves |

Cada elemento de `toolCalls` trae `nombre`, `argumentos`, `ok`, `resumen`, `ms` y, si aplica, `compuerta: true` (el ciclo anuló un `confirmado=true` que el usuario no había dado).

Ejemplo:

```bash
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":"Procesa la solicitud \"sol-004\". Muéstrame la OC como quedaría en SAP, qué validaciones pasó y cuáles no, y no la crees hasta que yo lo confirme."}'
```

## Estructura

```
agent/prompt.md                 system prompt (comportamiento)
src/knowledge/ordenes-compra.md conocimiento del proceso que el agente consulta
src/tools/oc.ts                 herramientas oc_* (zod); src/tools/index.ts las registra y ejecuta
src/domain/                     reglas RC1–RC10, parseo, payload, evidencia, salidas (sin HTTP ni IA)
src/sap/                        interfaz SapAdapter y mock sobre out/sap/
src/agent/                      ciclo del agente, compuerta de confirmación, sesiones
src/llm/                        adaptador de proveedor LLM (Anthropic, simulado)
src/server.ts                   API HTTP y front estático
web/                            chat en HTML plano
fixtures/reto-03/               casos y maestros entregados por Periferia (sin modificar)
modulo/                         agente empaquetado (agent.md, tools/oc.ts, skill/) · ver modulo/README.md
demo.ts                         verificación sin modelo
```

## Módulo reutilizable (bonus)

`modulo/` contiene el agente empaquetado para otras plataformas: `agent.md` (system prompt con frontmatter), `tools/oc.ts` (re-exporta las mismas herramientas, sin servidor) y `skill/ordenes-compra/SKILL.md` (conocimiento). Los Markdown son espejo byte a byte de `agent/prompt.md` y `src/knowledge/ordenes-compra.md`; `bun run modulo:check` falla si divergen y `bun run modulo:sync` los vuelve a alinear. Detalles en [modulo/README.md](modulo/README.md).

## Scripts

| Comando | Qué hace |
|---|---|
| `bun run dev` | Servidor con recarga automática |
| `bun run start` | Servidor en producción |
| `bun run demo.ts` | Verificación de los 6 casos sin modelo |
| `bun run typecheck` | `tsc --noEmit` (TypeScript estricto, sin `any`) |
| `bun run modulo:check` | Verifica que `modulo/` sea idéntico a su fuente |
| `bun run modulo:sync` | Sincroniza `modulo/` desde la fuente |
