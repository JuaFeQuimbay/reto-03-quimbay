// Convierte los textos de cotización y factura en datos estructurados.
import type { Cotizacion, Factura, ItemCotizacion, Respuesta } from "./tipos.ts"
import { clave, parsearMonto, sumarDias } from "./texto.ts"

function capturar(texto: string, patron: RegExp): string | null {
  return texto.match(patron)?.[1]?.trim() ?? null
}

const PATRON_ITEM =
  /^\s*\d+\.\s*(.+?)\s*\|\s*Cantidad:\s*([\d.,]+)\s*\|\s*Precio unitario[^:]*:\s*[A-Z]{3}\s*([\d.,]+)\s*\|\s*Subtotal:\s*[A-Z]{3}\s*([\d.,]+)/gim

function parsearItems(texto: string): ItemCotizacion[] {
  const items: ItemCotizacion[] = []
  for (const m of texto.matchAll(PATRON_ITEM)) {
    const cantidad = parsearMonto(m[2] ?? "")
    const precio = parsearMonto(m[3] ?? "")
    const subtotal = parsearMonto(m[4] ?? "")
    if (m[1] && cantidad !== null && precio !== null && subtotal !== null) {
      items.push({ descripcion: m[1], cantidad, precio_unitario: precio, subtotal })
    }
  }
  return items
}

export function parsearCotizacion(texto: string): Respuesta<Cotizacion> {
  const proveedor = capturar(texto, /^Proveedor:\s*(.+)$/im)
  const total = texto.match(/TOTAL\s*\(IVA incluido\):\s*([A-Z]{3})\s*([\d.,]+)/i)
  const totalNumero = parsearMonto(total?.[2] ?? "")
  if (!proveedor) return { ok: false, error: "la cotización no indica el proveedor" }
  if (!total || totalNumero === null) return { ok: false, error: "la cotización no tiene un 'TOTAL (IVA incluido)' legible" }

  const fecha = capturar(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)
  const validezDias = capturar(texto, /Validez de la oferta:\s*(\d+)\s*d[ií]as/i)
  const ivaPorcentaje = capturar(texto, /^IVA\s+(\d+(?:[.,]\d+)?)\s*%/im)

  return {
    ok: true,
    data: {
      numero: capturar(texto, /COTIZACI[ÓO]N\s+([A-Z0-9-]+)/i),
      fecha,
      proveedor,
      nit: capturar(texto, /^NIT:\s*([\d.\-]+)/im),
      items: parsearItems(texto),
      iva_tasa: ivaPorcentaje ? Number(ivaPorcentaje.replace(",", ".")) / 100 : null,
      total: totalNumero,
      moneda: total[1] ?? "COP",
      validez_hasta: fecha && validezDias ? sumarDias(fecha, Number(validezDias)) : null,
      texto,
    },
  }
}

export function parsearFactura(texto: string): Respuesta<Factura> {
  const numero = capturar(texto, /FACTURA[^\n]*?No\.\s*([A-Z0-9-]+)/i)
  const fecha = capturar(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i)
  const total = parsearMonto(capturar(texto, /^TOTAL:\s*[A-Z]{3}\s*([\d.,]+)/im) ?? "")
  if (!numero || !fecha || total === null) {
    return { ok: false, error: "la factura no tiene número, fecha de emisión o total legibles" }
  }
  return { ok: true, data: { numero, fecha, total } }
}

/** Contiene "Aprobado/a" y no está negado ("no aprobado", "sin aprobar") ni rechazado. */
export function esAprobado(cuerpo: string): boolean {
  const t = clave(cuerpo)
  const afirma = /\baprobad[oa]\b/.test(t)
  const niega = /\b(no|sin)\s+(ha\s+sido\s+|esta\s+|fue\s+)?aproba(do|da|r)\b/.test(t) || /\brechazad[oa]\b/.test(t)
  return afirma && !niega
}
