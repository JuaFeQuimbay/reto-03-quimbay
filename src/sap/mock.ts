// SAP simulado sobre archivos: out/sap/ordenes.jsonl. Numeración secuencial desde 4500000001.
import { appendFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { enSerie } from "../domain/cola.ts"
import { leerTextoOpcional } from "../domain/fuentes.ts"
import { cargarMaestros } from "../domain/maestros.ts"
import { DIR_SALIDA } from "../domain/salidas.ts"
import { normalizarNit } from "../domain/texto.ts"
import type { OrdenCompra } from "../domain/tipos.ts"
import type { SapAdapter } from "./adapter.ts"

export const PRIMER_NUMERO_OC = 4_500_000_001

type Registro = { numero_oc: string; fecha: string; creada_en: string; orden: OrdenCompra }

export class SapMock implements SapAdapter {
  private readonly directory: string

  constructor(directory: string) {
    this.directory = directory
  }

  private get ruta(): string {
    return join(this.directory, DIR_SALIDA, "sap", "ordenes.jsonl")
  }

  private async leerRegistros(): Promise<Registro[]> {
    const texto = await leerTextoOpcional(this.ruta)
    if (!texto) return []
    return texto
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as Registro)
  }

  async consultarProveedor(nit: string) {
    const maestros = await cargarMaestros(this.directory)
    if (!maestros.ok) return null
    const p = maestros.data.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit))
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = (await this.leerRegistros()).find((x) => x.orden.referencia.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null
  }

  async crearOrden(orden: OrdenCompra) {
    // Búsqueda + creación atómicas: dos llamadas simultáneas no generan dos OC.
    return enSerie(async () => {
      const registros = await this.leerRegistros()
      const existente = registros.find((x) => x.orden.referencia.solicitud_id === orden.referencia.solicitud_id)
      if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }

      const ultimo = registros.reduce((max, x) => Math.max(max, Number(x.numero_oc)), PRIMER_NUMERO_OC - 1)
      const ahora = new Date().toISOString()
      const registro: Registro = { numero_oc: String(ultimo + 1), fecha: ahora.slice(0, 10), creada_en: ahora, orden }
      await mkdir(dirname(this.ruta), { recursive: true })
      await appendFile(this.ruta, `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
  }
}
