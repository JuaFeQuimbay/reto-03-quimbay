// Pasos compartidos por las herramientas: cargar el caso, validarlo y preparar la OC.
// Cada herramienta relee la fuente: el modelo nunca es la fuente de un dato.
import { hashEvidencia } from "./evidencia.ts"
import { mismoContenido } from "./integridad.ts"
import { cargarMaestros } from "./maestros.ts"
import { leerPaquete } from "./paquete.ts"
import { construirOrden } from "./payload.ts"
import { validar } from "./reglas.ts"
import type { Maestros, OrdenCompra, Paquete, Respuesta, Traza, Validacion } from "./tipos.ts"

export type CasoValidado = { paquete: Paquete; maestros: Maestros; validacion: Validacion }

export async function cargarYValidar(directory: string, caso: string): Promise<Respuesta<CasoValidado>> {
  const [paquete, maestros] = await Promise.all([leerPaquete(directory, caso), cargarMaestros(directory)])
  if (!paquete.ok) return paquete
  if (!maestros.ok) return maestros
  const validacion = validar(paquete.data, maestros.data)
  if (!validacion.ok) return validacion
  return { ok: true, data: { paquete: paquete.data, maestros: maestros.data, validacion: validacion.data } }
}

/** Si el llamador envía un dato, debe ser idéntico al que sale de la fuente. */
export function verificarIntegridad(nombre: string, recibido: unknown, fuente: unknown): string | null {
  if (recibido === undefined || mismoContenido(recibido, fuente)) return null
  return `El ${nombre} recibido no coincide con el calculado desde la fuente; se rechaza para evitar valores alterados. Llama de nuevo sin enviar "${nombre}" o con el valor exacto devuelto por la herramienta.`
}

export function prepararOrden(c: CasoValidado): Respuesta<{ orden: OrdenCompra; trazabilidad: Traza[] }> {
  const { paquete, validacion } = c
  if (!paquete.aprobacion || !paquete.solicitud) return { ok: false, error: "Falta la aprobación o la solicitud." }
  return construirOrden(paquete, validacion, hashEvidencia(paquete.solicitud.solicitud_id, paquete.aprobacion))
}
