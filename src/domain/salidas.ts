// Escritura en out/: archivos por caso, control de auditoría y log de herramientas.
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { enSerie } from "./cola.ts"
import { leerTextoOpcional } from "./fuentes.ts"

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

type OpcionesAnexar = { encabezado?: string; omitirSi?: (contenidoActual: string) => boolean }

async function anexar(directory: string, archivo: string, linea: string, opciones: OpcionesAnexar = {}): Promise<void> {
  await enSerie(async () => {
    const ruta = join(directory, DIR_SALIDA, archivo)
    await mkdir(dirname(ruta), { recursive: true })
    const actual = (await leerTextoOpcional(ruta)) ?? ""
    if (opciones.omitirSi?.(actual)) return
    const nuevo = opciones.encabezado !== undefined && actual === ""
    await appendFile(ruta, `${nuevo ? `${opciones.encabezado}\n` : ""}${linea}\n`, "utf8")
  })
}

/** Último resultado registrado para una solicitud (segunda columna de su última fila). */
function ultimoResultado(csv: string, solicitudId: string): string | null {
  const filas = csv.split("\n").filter((l) => l.startsWith(`${solicitudId},`))
  return filas.at(-1)?.split(",")[1] ?? null
}

/**
 * Agrega una fila por intento. Con `omitirSiRepetido`, no repite el mismo desenlace consecutivo
 * del mismo caso (p. ej. validación "pendiente" seguida de un oc_crear rechazado por lo mismo).
 */
export async function registrarControl(directory: string, fila: FilaControl, opciones: { omitirSiRepetido?: boolean } = {}): Promise<void> {
  const valores = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ]
  await anexar(directory, "control.csv", valores.map(celda).join(","), {
    encabezado: COLUMNAS.join(","),
    ...(opciones.omitirSiRepetido ? { omitirSi: (csv: string) => ultimoResultado(csv, fila.solicitud_id) === fila.resultado } : {}),
  })
}

// --- out/log.jsonl (CA4): cada llamada a herramienta --------------------------------------
export async function registrarLog(directory: string, entrada: Record<string, unknown>): Promise<void> {
  await anexar(directory, "log.jsonl", JSON.stringify(entrada))
}
