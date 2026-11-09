// HU-1: lee y normaliza las piezas de un caso. Lo ausente se reporta como null + faltantes.
import { join } from "node:path"
import { leerJson, leerTextoOpcional, rutaCaso } from "./fuentes.ts"
import { esAprobado, parsearCotizacion, parsearFactura } from "./parsers.ts"
import {
  AprobacionFuenteSchema,
  CorreoFuenteSchema,
  SolicitudSchema,
  type Aprobacion,
  type Correo,
  type Cotizacion,
  type Factura,
  type Paquete,
  type Respuesta,
  type Solicitud,
} from "./tipos.ts"

const SUGERENCIA = "Pide al solicitante que reenvíe el archivo corregido."

export async function leerPaquete(directory: string, caso: string): Promise<Respuesta<Paquete>> {
  const ruta = await rutaCaso(directory, caso)
  if (!ruta.ok) return ruta
  const dir = ruta.data
  const faltantes: string[] = []
  const advertencias: string[] = []

  // JSON: un archivo ausente es "faltante"; uno malformado es error (HU-6).
  const correoL = await leerJson(join(dir, "correo.json"), CorreoFuenteSchema, "correo.json")
  const solicitudL = await leerJson(join(dir, "solicitud.json"), SolicitudSchema, "solicitud.json")
  const aprobacionL = await leerJson(join(dir, "aprobacion.json"), AprobacionFuenteSchema, "aprobacion.json")
  for (const l of [correoL, solicitudL, aprobacionL]) {
    if (l.estado === "invalido") return { ok: false, error: `${l.error}. ${SUGERENCIA}` }
  }

  let correo: Correo | null = null
  let adjuntos: string[] = []
  if (correoL.estado === "ok") {
    const { id, de, asunto, fecha } = correoL.data
    correo = { id, de, asunto, fecha }
    adjuntos = correoL.data.adjuntos
  } else faltantes.push("correo.json")

  let solicitud: Solicitud | null = null
  if (solicitudL.estado === "ok") solicitud = solicitudL.data
  else faltantes.push("solicitud.json")

  let aprobacion: Aprobacion | null = null
  if (aprobacionL.estado === "ok") {
    const a = aprobacionL.data
    aprobacion = { de: a.de, para: a.para, cc: a.cc, fecha: a.fecha, asunto: a.asunto, aprobado: esAprobado(a.cuerpo), texto: a.cuerpo }
  } else faltantes.push("aprobacion.json")

  // Textos: la cotización es esperada; la factura solo aparece en compras retroactivas.
  let cotizacion: Cotizacion | null = null
  const cotTexto = await leerTextoOpcional(join(dir, "cotizacion.txt"))
  if (cotTexto === null) faltantes.push("cotizacion.txt")
  else {
    const c = parsearCotizacion(cotTexto)
    if (c.ok) cotizacion = c.data
    else advertencias.push(`cotizacion.txt ilegible: ${c.error}`)
  }

  let factura: Factura | null = null
  const facTexto = await leerTextoOpcional(join(dir, "factura.txt"))
  if (facTexto !== null) {
    const f = parsearFactura(facTexto)
    if (f.ok) factura = f.data
    else advertencias.push(`factura.txt ilegible: ${f.error}`)
  } else if (adjuntos.some((a) => a.toLowerCase().startsWith("factura"))) {
    advertencias.push("El correo menciona una factura adjunta, pero no se encontró factura.txt")
  }

  return { ok: true, data: { caso, correo, solicitud, cotizacion, aprobacion, factura, faltantes, advertencias } }
}
