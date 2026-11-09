// Escritura en out/: archivos por caso, control de auditoría y log de herramientas.
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { enSerie } from "./cola.ts"
import { existe } from "./fuentes.ts"

export const DIR_SALIDA = "out"

/** Ruta relativa legible (siempre con "/") para mostrar al usuario. */
export function rutaRelativa(...partes: string[]): string {
  return [DIR_SALIDA, ...partes].join("/")
}

export async function escribirArchivoCaso(directory: string, caso: string, archivo: string, contenido: string): Promise<string> {
  const ruta = join(directory, DIR_SALIDA, caso, archivo)
  await mkdir(dirname(ruta), { recursive: true })
  await writeFile(ruta, contenido, "utf8")
  return rutaRelativa(caso, archivo)
}

// --- out/control.csv (HU-5): una fila por intento -------------------------------------
export type ResultadoControl = "creada" | "idempotente" | "bloqueada" | "pendiente_confirmacion"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const COLUMNAS = ["solicitud_id", "resultado", "numero_oc", "retroactiva", "bloqueos", "confirmaciones", "ts"]

function celda(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

async function anexar(directory: string, archivo: string, linea: string, encabezado?: string): Promise<void> {
  await enSerie(async () => {
    const ruta = join(directory, DIR_SALIDA, archivo)
    await mkdir(dirname(ruta), { recursive: true })
    const nuevo = encabezado !== undefined && !(await existe(ruta))
    await appendFile(ruta, `${nuevo ? `${encabezado}\n` : ""}${linea}\n`, "utf8")
  })
}

export async function registrarControl(directory: string, fila: FilaControl): Promise<void> {
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ]
  await anexar(directory, "control.csv", valores.map(celda).join(","), COLUMNAS.join(","))
}

// --- out/log.jsonl (CA4): cada llamada a herramienta --------------------------------------
export async function registrarLog(directory: string, entrada: Record<string, unknown>): Promise<void> {
  await anexar(directory, "log.jsonl", JSON.stringify(entrada))
}
