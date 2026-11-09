import { z } from "zod"

// ---------------------------------------------------------------------------
// Respuesta estándar: toda operación de dominio devuelve ok/data u ok/error.
// ---------------------------------------------------------------------------
export type Respuesta<T> = { ok: true; data: T } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Esquemas de los archivos fuente (fixtures). Validan forma y tipos.
// ---------------------------------------------------------------------------
const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "debe tener formato AAAA-MM-DD")
const monto = (campo: string) => z.number({ error: `${campo} debe ser numérico` })

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().min(1).optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: monto("cantidad").positive("cantidad debe ser mayor que 0"),
  valor_unitario: monto("valor_unitario").nonnegative("valor_unitario no puede ser negativo"),
  valor_total: monto("valor_total").positive("valor_total debe ser mayor que 0"),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().min(1).optional(),
  condiciones_pago: z.string().min(1).optional(),
  fecha_solicitud: fechaISO,
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const CorreoFuenteSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(10),
  adjuntos: z.array(z.string()).default([]),
})

export const AprobacionFuenteSchema = z.object({
  de: z.string().min(1),
  para: z.string().default(""),
  cc: z.array(z.string()).default([]),
  fecha: z.string().min(10),
  asunto: z.string().default(""),
  cuerpo: z.string(),
})

// ---------------------------------------------------------------------------
// Maestros (simulan tablas corporativas de SAP)
// ---------------------------------------------------------------------------
export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string(), tope: z.number() })),
})
export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Proveedor = z.infer<typeof ProveedorSchema>
export type CentroCosto = z.infer<typeof CentroCostoSchema>
export type IndicadorIva = z.infer<typeof IndicadorIvaSchema>
export type CondicionPago = z.infer<typeof CondicionPagoSchema>

export type Maestros = {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: IndicadorIva[]
  condicionesPago: CondicionPago[]
}

// ---------------------------------------------------------------------------
// Paquete normalizado (PRD 7.2, extendido con campos útiles para trazabilidad)
// ---------------------------------------------------------------------------
export type Correo = { id: string; de: string; asunto: string; fecha: string }

export type ItemCotizacion = { descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }

export type Cotizacion = {
  numero: string | null
  fecha: string | null
  proveedor: string
  nit: string | null
  items: ItemCotizacion[]
  iva_tasa: number | null
  total: number
  moneda: string
  validez_hasta: string | null
  texto: string
}

export type Aprobacion = {
  de: string
  para: string
  cc: string[]
  fecha: string
  asunto: string
  aprobado: boolean
  texto: string
}

export type Factura = { numero: string; fecha: string; total: number }

export type Paquete = {
  caso: string
  correo: Correo | null
  solicitud: Solicitud | null
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  faltantes: string[]
  advertencias: string[]
}

// ---------------------------------------------------------------------------
// Resultado de la validación (PRD 7.3)
// ---------------------------------------------------------------------------
export type CodigoRegla = "RC1" | "RC2" | "RC3" | "RC4" | "RC5" | "RC6" | "RC7" | "RC8" | "RC9" | "RC10"

export type Hallazgo = {
  regla: CodigoRegla
  mensaje: string
  accion_sugerida: string
  valores?: Record<string, string | number | null>
}

export type EstadoControl = "ok" | "bloqueo" | "confirmacion" | "derivado" | "no_aplica"

export type Control = { regla: CodigoRegla; descripcion: string; estado: EstadoControl; detalle: string }

export type ValorDerivado = { valor: string; fuente: string; detalle: string }

export type Derivados = { indicador_iva?: ValorDerivado; condiciones_pago?: ValorDerivado }

export type ProveedorResuelto = { codigo_sap: string; nit: string; nombre: string; criterio: "nit" | "nombre" }

export type Validacion = {
  solicitud_id: string
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
  proveedor: ProveedorResuelto | null
  controles: Control[]
}

// ---------------------------------------------------------------------------
// Orden de compra (PRD 7.4) — esquema zod obligatorio
// ---------------------------------------------------------------------------
export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string().min(1),
    correo_id: z.string().min(1),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string().min(1), nit: z.string().min(1), nombre: z.string().min(1) }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().min(1),
  aprobador: z.object({
    email: z.string().includes("@"),
    fecha_aprobacion: z.string().min(10),
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive().multipleOf(10),
        descripcion: z.string().min(1).max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string().min(1),
        subarea: z.string().min(1),
        indicador_iva: z.string().min(1),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>

export type Traza = { campo: string; valor: string | number | null; fuente: string; detalle?: string }
