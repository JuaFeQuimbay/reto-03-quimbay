// HU-4: evidencia de aprobación (P0: .txt con sha256). El contenido es determinista.
import { sha256 } from "./integridad.ts"
import { escribirArchivoCaso } from "./salidas.ts"
import type { Aprobacion } from "./tipos.ts"

export function contenidoEvidencia(solicitudId: string, a: Aprobacion): string {
  return [
    `EVIDENCIA DE APROBACIÓN · ${solicitudId}`,
    `De: ${a.de}`,
    `Para: ${a.para || "—"}`,
    `CC: ${a.cc.length ? a.cc.join(", ") : "—"}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto || "—"}`,
    "",
    a.texto,
    "",
  ].join("\n")
}

export function hashEvidencia(solicitudId: string, a: Aprobacion): string {
  return sha256(contenidoEvidencia(solicitudId, a))
}

/** Escribe out/<caso>/aprobacion.txt: contenido + línea final con el sha256 de ese contenido. */
export async function escribirEvidencia(directory: string, caso: string, solicitudId: string, a: Aprobacion) {
  const contenido = contenidoEvidencia(solicitudId, a)
  const hash = sha256(contenido)
  const ruta = await escribirArchivoCaso(directory, caso, "aprobacion.txt", `${contenido}\n----\nSHA-256 del contenido anterior: ${hash}\n`)
  return { ruta, sha256: hash }
}
