// Lectura tipada de la salida JSON de una herramienta y resumen corto para el front (CA4).
import { formatoMoneda } from "../domain/texto.ts"
import type { OrdenCompra, Paquete, Validacion } from "../domain/tipos.ts"

export type SalidaHerramienta = { ok: true; data: unknown } | { ok: false; error: string }

export type DatosPayload = { orden: OrdenCompra; valor_total_oc: number; ruta_trazabilidad: string; confirmaciones_pendientes: string[] }
export type DatosCreacion = {
  numero_oc: string
  fecha: string
  idempotente: boolean
  solicitud_id: string
  retroactiva: boolean
  valor_total_oc?: number
  ruta_evidencia?: string
}

export function leerSalida(texto: string): SalidaHerramienta {
  try {
    const r = JSON.parse(texto) as { ok?: unknown; data?: unknown; error?: unknown }
    if (r.ok === true) return { ok: true, data: r.data }
    return { ok: false, error: typeof r.error === "string" ? r.error : "error sin descripción" }
  } catch {
    return { ok: false, error: "salida no es JSON" }
  }
}

// Las herramientas son nuestras: la forma de `data` está garantizada por su contrato.
export const comoValidacion = (d: unknown) => d as Validacion
export const comoPaquete = (d: unknown) => d as Paquete
export const comoPayload = (d: unknown) => d as DatosPayload
export const comoCreacion = (d: unknown) => d as DatosCreacion

const lista = (xs: string[]) => (xs.length ? xs.join(", ") : "—")
const recortar = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

export function resumirSalida(nombre: string, texto: string): string {
  const s = leerSalida(texto)
  if (!s.ok) return `Error: ${recortar(s.error, 220)}`
  switch (nombre) {
    case "oc_listar_casos":
      return `casos: ${lista((s.data as { casos: string[] }).casos)}`
    case "oc_leer_paquete": {
      const p = comoPaquete(s.data)
      const sol = p.solicitud
      return `${sol?.solicitud_id ?? "sin solicitud"} · ${sol?.proveedor_nombre ?? "?"} · ${sol ? formatoMoneda(sol.valor_total, sol.moneda) : "?"} · faltantes: ${lista(p.faltantes)}${p.factura ? " · trae factura" : ""}`
    }
    case "oc_validar": {
      const v = comoValidacion(s.data)
      return `apta: ${v.apta ? "sí" : "NO"} · bloqueos: ${lista(v.bloqueos.map((b) => b.regla))} · confirmaciones: ${lista(v.confirmaciones.map((c) => c.regla))} · retroactiva: ${v.retroactiva ? "SÍ" : "no"}`
    }
    case "oc_construir_payload": {
      const p = comoPayload(s.data)
      return `OC lista: ${p.orden.proveedor.nombre} · ${formatoMoneda(p.valor_total_oc, p.orden.moneda)} · excepciones: ${lista(p.orden.excepciones.map((e) => e.codigo))}`
    }
    case "oc_generar_evidencia": {
      const e = s.data as { ruta: string; sha256: string }
      return `${e.ruta} · sha256 ${e.sha256.slice(0, 12)}…`
    }
    case "oc_crear": {
      const c = comoCreacion(s.data)
      return `OC ${c.numero_oc} (${c.fecha})${c.idempotente ? " · ya existía (idempotente)" : " · creada"}${c.retroactiva ? " · RETROACTIVA" : ""}`
    }
    default:
      return "ok"
  }
}
