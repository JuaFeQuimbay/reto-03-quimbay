// Carga y valida los maestros. En producción vendrían de SAP en tiempo real.
import { join } from "node:path"
import { z } from "zod"
import { DIR_MAESTROS, leerJson } from "./fuentes.ts"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  type Maestros,
  type Respuesta,
} from "./tipos.ts"

async function cargar<T>(directory: string, archivo: string, esquema: z.ZodType<T>): Promise<Respuesta<T[]>> {
  const r = await leerJson(join(directory, DIR_MAESTROS, archivo), z.array(esquema), archivo)
  if (r.estado === "ok") return { ok: true, data: r.data }
  return { ok: false, error: r.estado === "faltante" ? `Falta el maestro ${archivo}` : r.error }
}

export async function cargarMaestros(directory: string): Promise<Respuesta<Maestros>> {
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    cargar(directory, "proveedores.json", ProveedorSchema),
    cargar(directory, "centros-costo.json", CentroCostoSchema),
    cargar(directory, "indicadores-iva.json", IndicadorIvaSchema),
    cargar(directory, "condiciones-pago.json", CondicionPagoSchema),
  ])
  if (!proveedores.ok || !centrosCosto.ok || !indicadoresIva.ok || !condicionesPago.ok) {
    const errores = [proveedores, centrosCosto, indicadoresIva, condicionesPago].flatMap((r) => (r.ok ? [] : [r.error]))
    return { ok: false, error: errores.join("; ") }
  }
  return {
    ok: true,
    data: {
      proveedores: proveedores.data,
      centrosCosto: centrosCosto.data,
      indicadoresIva: indicadoresIva.data,
      condicionesPago: condicionesPago.data,
    },
  }
}
