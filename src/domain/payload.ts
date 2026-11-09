// HU-3: construye la OrdenCompra (PRD 7.4) y la trazabilidad de cada valor.
import { describirErroresZod } from "./fuentes.ts"
import { clave, truncarTexto } from "./texto.ts"
import { OrdenCompraSchema, type OrdenCompra, type Paquete, type Respuesta, type Traza, type Validacion } from "./tipos.ts"

export const SOCIEDAD = "1000"
export const ORGANIZACION_COMPRAS = "1000"
export const MAX_TEXTO_BREVE = 40

/** "horas" → H, mensual → MES, resto → UN. "12 meses de vigencia" NO es mensual. */
export function inferirUnidad(...textos: string[]): "UN" | "H" | "MES" {
  const t = clave(textos.join(" "))
  if (/\bhoras?\b/.test(t)) return "H"
  if (/\b(mensual(es|idad)?|por mes)\b/.test(t)) return "MES"
  return "UN"
}

export function construirOrden(paquete: Paquete, validacion: Validacion, evidenciaSha256: string): Respuesta<{ orden: OrdenCompra; trazabilidad: Traza[] }> {
  const { solicitud, aprobacion, cotizacion, correo } = paquete
  const proveedor = validacion.proveedor
  if (!validacion.apta) {
    return { ok: false, error: `La solicitud tiene bloqueos (${validacion.bloqueos.map((b) => b.regla).join(", ")}); no se construye la OC.` }
  }
  if (!solicitud || !aprobacion || !proveedor) return { ok: false, error: "Faltan solicitud, aprobación o proveedor resuelto." }

  const traza: Traza[] = []
  const t = (campo: string, valor: string | number | null, fuente: string, detalle?: string) => {
    traza.push({ campo, valor, fuente, ...(detalle ? { detalle } : {}) })
  }

  // Precio: el de la cotización cuando trae un único ítem con la misma cantidad (es lo que se facturará).
  const item = cotizacion?.items.length === 1 ? cotizacion.items[0] : undefined
  const usarCotizacion = item !== undefined && item.cantidad === solicitud.cantidad
  const precio = usarCotizacion ? item.precio_unitario : solicitud.valor_unitario
  const iva = validacion.derivados.indicador_iva?.valor ?? solicitud.indicador_iva
  const condiciones = validacion.derivados.condiciones_pago?.valor ?? solicitud.condiciones_pago
  if (!iva || !condiciones) return { ok: false, error: "No hay indicador de IVA o condiciones de pago (ni informados ni derivables)." }

  const descripcion = truncarTexto(solicitud.descripcion, MAX_TEXTO_BREVE)
  const unidad = inferirUnidad(solicitud.descripcion, item?.descripcion ?? "")

  const orden: OrdenCompra = {
    referencia: { solicitud_id: solicitud.solicitud_id, correo_id: correo?.id ?? `${paquete.caso}-sin-correo`, cotizacion_ref: cotizacion?.numero ?? null },
    sociedad: SOCIEDAD,
    organizacion_compras: ORGANIZACION_COMPRAS,
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: solicitud.moneda,
    condiciones_pago: condiciones,
    aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: evidenciaSha256 },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: solicitud.cantidad,
        unidad,
        precio_unitario: precio,
        centro_costo: solicitud.centro_costo,
        subarea: solicitud.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: validacion.confirmaciones.map((c) => ({ codigo: c.regla, detalle: c.mensaje, confirmado_por: null })),
  }

  t("referencia.solicitud_id", solicitud.solicitud_id, "solicitud")
  t("referencia.correo_id", orden.referencia.correo_id, correo ? "correo" : "derivado", correo ? undefined : "correo ausente")
  t("referencia.cotizacion_ref", orden.referencia.cotizacion_ref, "cotizacion")
  t("sociedad", SOCIEDAD, "derivado", "constante de configuración de la sociedad")
  t("organizacion_compras", ORGANIZACION_COMPRAS, "derivado", "constante de configuración de compras")
  t("proveedor.codigo_sap", proveedor.codigo_sap, "maestro.proveedores", `resuelto por ${proveedor.criterio}`)
  t("proveedor.nit", proveedor.nit, "maestro.proveedores")
  t("proveedor.nombre", proveedor.nombre, "maestro.proveedores")
  t("moneda", solicitud.moneda, "solicitud")
  t("condiciones_pago", condiciones, validacion.derivados.condiciones_pago ? "derivado" : "solicitud", validacion.derivados.condiciones_pago?.detalle)
  t("aprobador.email", aprobacion.de, "aprobacion")
  t("aprobador.fecha_aprobacion", aprobacion.fecha, "aprobacion")
  t("aprobador.evidencia_sha256", evidenciaSha256, "derivado", "sha256 del contenido de out/<caso>/aprobacion.txt")
  t("posiciones[0].numero", 10, "derivado", "primera posición SAP")
  t("posiciones[0].descripcion", descripcion, "solicitud", descripcion === solicitud.descripcion ? undefined : `truncada a ${MAX_TEXTO_BREVE} caracteres; original: "${solicitud.descripcion}"`)
  t("posiciones[0].cantidad", solicitud.cantidad, "solicitud")
  t("posiciones[0].unidad", unidad, "derivado", "inferida de la descripción (horas → H, mensual → MES, resto → UN)")
  t(
    "posiciones[0].precio_unitario",
    precio,
    usarCotizacion ? "cotizacion" : "solicitud",
    usarCotizacion && precio !== solicitud.valor_unitario ? `la solicitud indicaba ${solicitud.valor_unitario}` : "valor con IVA incluido",
  )
  t("posiciones[0].centro_costo", solicitud.centro_costo, "solicitud")
  t("posiciones[0].subarea", solicitud.subarea, "solicitud")
  t("posiciones[0].indicador_iva", iva, validacion.derivados.indicador_iva ? "derivado" : "solicitud", validacion.derivados.indicador_iva?.detalle)

  const verificada = OrdenCompraSchema.safeParse(orden)
  if (!verificada.success) return { ok: false, error: `La OC no cumple el esquema: ${describirErroresZod(verificada.error)}` }
  return { ok: true, data: { orden: verificada.data, trazabilidad: traza } }
}

export function valorTotalOrden(orden: OrdenCompra): number {
  return orden.posiciones.reduce((suma, p) => suma + p.cantidad * p.precio_unitario, 0)
}
