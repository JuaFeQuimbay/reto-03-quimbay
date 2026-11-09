// Herramientas del agente "Órdenes de Compra SAP". Cada export se expone al modelo como oc_<export>.
// Son la ÚNICA fuente de valores que el agente puede afirmar (CA2).
import { z } from "zod"
import { escribirEvidencia } from "../domain/evidencia.ts"
import { cargarYValidar, prepararOrden, verificarIntegridad } from "../domain/flujo.ts"
import { listarCasos } from "../domain/fuentes.ts"
import { leerPaquete } from "../domain/paquete.ts"
import { valorTotalOrden } from "../domain/payload.ts"
import { escribirArchivoCaso, registrarControl, type ResultadoControl } from "../domain/salidas.ts"
import type { Validacion } from "../domain/tipos.ts"
import { crearAdaptadorSap } from "../sap/index.ts"
import { exito, fallo, herramienta, seguro } from "./contrato.ts"

const caso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo sol-001")

function filaControl(v: Validacion, resultado: ResultadoControl, numero_oc: string | null = null) {
  return {
    solicitud_id: v.solicitud_id,
    resultado,
    numero_oc,
    retroactiva: v.retroactiva,
    bloqueos: v.bloqueos.map((b) => b.regla),
    confirmaciones: v.confirmaciones.map((c) => c.regla),
  }
}

export const listar_casos = herramienta({
  description: "Lista los casos (carpetas de solicitudes de compra) disponibles para procesar.",
  args: {},
  async execute(_args, ctx) {
    return seguro(async () => exito({ casos: await listarCasos(ctx.directory) }))
  },
})

export const leer_paquete = herramienta({
  description: "Lee y normaliza el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso.",
  args: { caso },
  async execute(args, ctx) {
    return seguro(async () => {
      const r = await leerPaquete(ctx.directory, args.caso)
      return r.ok ? exito(r.data) : fallo(r.error)
    })
  },
})

export const validar = herramienta({
  description: "Aplica las reglas de control RC1–RC10 al caso y devuelve apta, bloqueos, confirmaciones, derivados y retroactiva.",
  args: {
    caso,
    paquete: z.unknown().optional().describe("Opcional. Paquete de oc_leer_paquete; si se envía debe ser idéntico a la fuente. Preferible omitirlo."),
  },
  async execute(args, ctx) {
    return seguro(async () => {
      const r = await cargarYValidar(ctx.directory, args.caso)
      if (!r.ok) return fallo(r.error)
      const alterado = verificarIntegridad("paquete", args.paquete, r.data.paquete)
      if (alterado) return fallo(alterado)
      const v = r.data.validacion
      if (!v.apta) await registrarControl(ctx.directory, filaControl(v, "bloqueada"))
      else if (v.confirmaciones.length) await registrarControl(ctx.directory, filaControl(v, "pendiente_confirmacion"))
      return exito(v)
    })
  },
})

export const construir_payload = herramienta({
  description: "Construye la orden de compra tal como quedaría en SAP (validada con zod) y guarda su trazabilidad; solo para casos sin bloqueos.",
  args: {
    caso,
    paquete: z.unknown().optional().describe("Opcional. Paquete de oc_leer_paquete; si se envía debe ser idéntico a la fuente. Preferible omitirlo."),
    derivados: z.unknown().optional().describe("Opcional. Derivados de oc_validar; si se envían deben ser idénticos. Preferible omitirlos."),
  },
  async execute(args, ctx) {
    return seguro(async () => {
      const r = await cargarYValidar(ctx.directory, args.caso)
      if (!r.ok) return fallo(r.error)
      const alterado =
        verificarIntegridad("paquete", args.paquete, r.data.paquete) ?? verificarIntegridad("derivados", args.derivados, r.data.validacion.derivados)
      if (alterado) return fallo(alterado)
      const p = prepararOrden(r.data)
      if (!p.ok) return fallo(p.error)
      const ruta_trazabilidad = await escribirArchivoCaso(ctx.directory, args.caso, "trazabilidad.json", JSON.stringify(p.data.trazabilidad, null, 2))
      await escribirArchivoCaso(ctx.directory, args.caso, "payload.json", JSON.stringify(p.data.orden, null, 2))
      return exito({
        orden: p.data.orden,
        valor_total_oc: valorTotalOrden(p.data.orden),
        ruta_trazabilidad,
        confirmaciones_pendientes: r.data.validacion.confirmaciones.map((c) => c.regla),
      })
    })
  },
})

export const generar_evidencia = herramienta({
  description: "Genera out/<caso>/aprobacion.txt con encabezados y cuerpo del correo de aprobación y su sha256.",
  args: { caso },
  async execute(args, ctx) {
    return seguro(async () => {
      const r = await leerPaquete(ctx.directory, args.caso)
      if (!r.ok) return fallo(r.error)
      const { aprobacion, solicitud } = r.data
      if (!aprobacion || !solicitud) return fallo("El caso no tiene aprobación o solicitud: no hay evidencia que generar.")
      return exito(await escribirEvidencia(ctx.directory, args.caso, solicitud.solicitud_id, aprobacion))
    })
  },
})

export const crear = herramienta({
  description:
    "Crea la orden de compra en SAP; revalida todo, es idempotente por solicitud_id y exige confirmado=true si hay confirmaciones pendientes.",
  args: {
    caso,
    payload: z.unknown().optional().describe("Opcional. Orden de oc_construir_payload; si se envía debe ser idéntica. Preferible omitirla."),
    confirmado: z
      .boolean()
      .default(false)
      .describe("true SOLO si el usuario confirmó explícitamente en su último mensaje las confirmaciones pendientes"),
  },
  async execute(args, ctx) {
    return seguro(async () => {
      const r = await cargarYValidar(ctx.directory, args.caso)
      if (!r.ok) return fallo(r.error)
      const v = r.data.validacion
      const sap = crearAdaptadorSap(ctx.directory)

      if (!v.apta) {
        await registrarControl(ctx.directory, filaControl(v, "bloqueada"))
        return fallo(`No se crea la OC. Bloqueos: ${v.bloqueos.map((b) => `${b.regla}: ${b.mensaje}`).join(" | ")}`)
      }

      const existente = await sap.buscarOrdenPorReferencia(v.solicitud_id)
      if (existente) {
        await registrarControl(ctx.directory, filaControl(v, "idempotente", existente.numero_oc))
        return exito({ ...existente, idempotente: true, solicitud_id: v.solicitud_id, retroactiva: v.retroactiva })
      }

      if (v.confirmaciones.length && !args.confirmado) {
        await registrarControl(ctx.directory, filaControl(v, "pendiente_confirmacion"))
        const lista = v.confirmaciones.map((c) => `${c.regla}: ${c.mensaje}`).join(" | ")
        return fallo(`Requiere confirmación humana explícita antes de crear. ${lista} Pregunta al usuario y vuelve a llamar con confirmado=true solo si confirma.`)
      }

      const p = prepararOrden(r.data)
      if (!p.ok) return fallo(p.error)
      const alterado = verificarIntegridad("payload", args.payload, p.data.orden)
      if (alterado) return fallo(alterado)

      const proveedorSap = await sap.consultarProveedor(p.data.orden.proveedor.nit)
      if (!proveedorSap?.activo) return fallo(`SAP no reporta activo al proveedor NIT ${p.data.orden.proveedor.nit}; no se crea la OC.`)

      const confirmadoPor = args.confirmado ? `analista (sesión ${ctx.sessionId})` : null
      const orden = { ...p.data.orden, excepciones: p.data.orden.excepciones.map((x) => ({ ...x, confirmado_por: confirmadoPor })) }
      const aprobacion = r.data.paquete.aprobacion
      if (!aprobacion) return fallo("El caso no tiene aprobación: no se puede adjuntar evidencia.")
      const evidencia = await escribirEvidencia(ctx.directory, args.caso, v.solicitud_id, aprobacion)
      const creada = await sap.crearOrden(orden)
      await escribirArchivoCaso(ctx.directory, args.caso, "payload.json", JSON.stringify(orden, null, 2))
      await registrarControl(ctx.directory, filaControl(v, "creada", creada.numero_oc))

      return exito({
        ...creada,
        idempotente: false,
        solicitud_id: v.solicitud_id,
        valor_total_oc: valorTotalOrden(orden),
        retroactiva: v.retroactiva,
        excepciones_confirmadas: orden.excepciones.map((x) => x.codigo),
        ruta_evidencia: evidencia.ruta,
        evidencia_sha256: evidencia.sha256,
      })
    })
  },
})
