# `modulo/` · agente empaquetado como módulo reutilizable

Las tres piezas del agente, listas para integrarse en otra plataforma de agentes sin depender del servidor de este repositorio:

| Pieza | Archivo | Relación con la aplicación |
|---|---|---|
| System prompt | `agent.md` | Byte a byte idéntico a `agent/prompt.md` (frontmatter: `description`, `mode: primary`, `permission: {edit: deny, bash: deny}`) |
| Herramientas | `tools/oc.ts` | Re-exporta `src/tools/oc.ts`: es el mismo código, no una copia |
| Conocimiento | `skill/ordenes-compra/SKILL.md` | Byte a byte idéntico a `src/knowledge/ordenes-compra.md` (frontmatter: `name`, `description`) |

La aplicación lee `agent/prompt.md` y `src/knowledge/ordenes-compra.md` quitando el frontmatter (`sinFrontmatter` en `src/agent/prompt.ts`), así que la **fuente única** es esa y el módulo es su espejo:

```bash
bun run modulo:sync    # copia la fuente al módulo
bun run modulo:check   # sale con código 1 si el módulo divergió de la fuente
```

## Usar las herramientas desde otro host

```ts
import { ejecutarHerramienta, definicionesHerramientas } from "./modulo/tools/oc.ts"

// Definiciones en JSON Schema (nombre, descripción, parámetros) para registrarlas en cualquier proveedor LLM
const defs = definicionesHerramientas()

// Ejecución: valida los argumentos con zod, nunca lanza, deja traza en out/log.jsonl
const r = await ejecutarHerramienta("oc_validar", { caso: "sol-004" }, { directory: process.cwd(), sessionId: "mi-host" })
console.log(JSON.parse(r.salida)) // { ok: true, data: { apta, bloqueos, confirmaciones, derivados, retroactiva, ... } }
```

`directory` es la raíz donde viven `fixtures/` (lectura) y `out/` (escritura). Las herramientas requieren `zod` y un runtime que ejecute TypeScript (Bun, o Node 20+ con `tsx`).

Contrato de cada herramienta exportada (`leer_paquete`, `validar`, `construir_payload`, `generar_evidencia`, `crear`, `listar_casos`): `{ description, args (zod), execute(args, ctx) → string JSON }`. El nombre visible para el modelo es `oc_<export>`.
