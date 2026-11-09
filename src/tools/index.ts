// Registro y ejecución de herramientas. Lo usan el ciclo del agente y demo.ts (mismo camino).
// Valida argumentos con zod antes de ejecutar y deja cada llamada en out/log.jsonl (CA4).
import { z } from "zod"
import { describirErroresZod } from "../domain/fuentes.ts"
import { registrarLog } from "../domain/salidas.ts"
import { fallo, type ContextoHerramienta, type Herramienta } from "./contrato.ts"
import * as oc from "./oc.ts"

// Nombre visible para el modelo: <archivo>_<export>
const MODULOS: Record<string, Record<string, Herramienta>> = { oc }

export const HERRAMIENTAS: ReadonlyMap<string, Herramienta> = new Map(
  Object.entries(MODULOS).flatMap(([archivo, modulo]) => Object.entries(modulo).map(([nombre, h]) => [`${archivo}_${nombre}`, h] as const)),
)

export type DefinicionHerramienta = { nombre: string; descripcion: string; parametros: Record<string, unknown> }

/** Definiciones en JSON Schema, neutrales respecto al proveedor LLM. */
export function definicionesHerramientas(): DefinicionHerramienta[] {
  return [...HERRAMIENTAS].map(([nombre, h]) => {
    const { $schema: _omitido, ...parametros } = z.toJSONSchema(z.object(h.args), { io: "input" }) as Record<string, unknown>
    return { nombre, descripcion: h.description, parametros }
  })
}

export type EjecucionHerramienta = { nombre: string; args: unknown; ok: boolean; salida: string; ms: number }

function leerEstado(salida: string): { ok: boolean; error?: string } {
  try {
    const r = JSON.parse(salida) as { ok?: unknown; error?: unknown }
    return { ok: r.ok === true, ...(typeof r.error === "string" ? { error: r.error } : {}) }
  } catch {
    return { ok: false, error: "salida no es JSON" }
  }
}

async function correr(nombre: string, args: unknown, ctx: ContextoHerramienta): Promise<string> {
  const h = HERRAMIENTAS.get(nombre)
  if (!h) return fallo(`Herramienta desconocida: ${nombre}. Disponibles: ${[...HERRAMIENTAS.keys()].join(", ")}`)
  const parseado = z.object(h.args).safeParse(args ?? {})
  if (!parseado.success) return fallo(`Argumentos inválidos para ${nombre}: ${describirErroresZod(parseado.error)}`)
  try {
    return await h.execute(parseado.data, ctx)
  } catch (e) {
    return fallo(`Error interno en ${nombre}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: ContextoHerramienta): Promise<EjecucionHerramienta> {
  const inicio = Date.now()
  const salida = await correr(nombre, args, ctx)
  const ms = Date.now() - inicio
  const estado = leerEstado(salida)
  await registrarLog(ctx.directory, { ts: new Date().toISOString(), sessionId: ctx.sessionId, herramienta: nombre, args, ms, ...estado })
  return { nombre, args, ok: estado.ok, salida, ms }
}
