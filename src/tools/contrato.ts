// Contrato de herramientas (PRD 6.2): description + args (zod) + execute(args, ctx) → string JSON.
import type { z } from "zod"

export type ContextoHerramienta = {
  /** Raíz del proyecto: todas las rutas se resuelven desde aquí, nunca absolutas. */
  directory: string
  sessionId: string
}

export interface Herramienta {
  description: string
  args: z.ZodRawShape
  execute(args: Record<string, unknown>, ctx: ContextoHerramienta): Promise<string>
}

/** Define una herramienta con inferencia de tipos de sus argumentos. */
export function herramienta<S extends z.ZodRawShape>(def: {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: ContextoHerramienta): Promise<string>
}) {
  return def
}

export function exito(data: unknown): string {
  return JSON.stringify({ ok: true, data })
}

export function fallo(error: string): string {
  return JSON.stringify({ ok: false, error })
}

/** Garantiza que una herramienta nunca lance: cualquier excepción se vuelve { ok: false, error }. */
export async function seguro(cuerpo: () => Promise<string>): Promise<string> {
  try {
    return await cuerpo()
  } catch (e) {
    return fallo(`Error interno: ${e instanceof Error ? e.message : String(e)}`)
  }
}
