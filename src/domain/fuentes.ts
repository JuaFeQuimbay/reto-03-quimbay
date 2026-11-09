// Acceso de solo lectura a fixtures/. Todas las rutas se resuelven desde la raíz del proyecto.
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { z } from "zod"
import type { Respuesta } from "./tipos.ts"

export const DIR_SOLICITUDES = join("fixtures", "reto-03", "solicitudes")
export const DIR_MAESTROS = join("fixtures", "reto-03", "maestros")

// Evita path traversal ("../../etc"): el caso es un nombre de carpeta simple.
const PATRON_CASO = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export type Lectura<T> = { estado: "faltante" } | { estado: "ok"; data: T } | { estado: "invalido"; error: string }

export function describirErroresZod(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
}

export async function existe(ruta: string): Promise<boolean> {
  return stat(ruta).then(
    () => true,
    () => false,
  )
}

export async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null
    throw e
  }
}

export async function leerJson<T>(ruta: string, esquema: z.ZodType<T>, nombre: string): Promise<Lectura<T>> {
  const texto = await leerTextoOpcional(ruta)
  if (texto === null) return { estado: "faltante" }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch (e) {
    return { estado: "invalido", error: `${nombre} no es un JSON válido (${e instanceof Error ? e.message : "error de sintaxis"})` }
  }
  const r = esquema.safeParse(crudo)
  return r.success ? { estado: "ok", data: r.data } : { estado: "invalido", error: `${nombre}: ${describirErroresZod(r.error)}` }
}

export async function listarCasos(directory: string): Promise<string[]> {
  const entradas = await readdir(join(directory, DIR_SOLICITUDES), { withFileTypes: true }).catch(() => [])
  return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

export async function rutaCaso(directory: string, caso: string): Promise<Respuesta<string>> {
  if (!PATRON_CASO.test(caso)) return { ok: false, error: `Nombre de caso inválido: "${caso}". Usa el nombre de la carpeta, p. ej. sol-001.` }
  const ruta = join(directory, DIR_SOLICITUDES, caso)
  if (await existe(ruta)) return { ok: true, data: ruta }
  const disponibles = await listarCasos(directory)
  return { ok: false, error: `No existe el caso "${caso}". Casos disponibles: ${disponibles.join(", ") || "ninguno"}.` }
}
