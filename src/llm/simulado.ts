// Proveedor SIMULADO: guion determinista que imita a un modelo (sin clave ni costo).
// Sirve para probar el ciclo y el front, y como respaldo si no hay clave configurada.
// Sigue el mismo procedimiento que agent/prompt.md le pide al modelo real.
import { esConfirmacion } from "../agent/confirmacion.ts"
import {
  comoCreacion,
  comoPayload,
  comoValidacion,
  leerSalida,
  type DatosPayload,
  type SalidaHerramienta,
} from "../agent/salida-herramienta.ts"
import { formatoMoneda } from "../domain/texto.ts"
import type { Validacion } from "../domain/tipos.ts"
import { USO_CERO, type LlamadaHerramienta, type Mensaje, type PeticionModelo, type ProveedorLLM, type RespuestaModelo } from "./adapter.ts"

type Paso = { llamada: LlamadaHerramienta; salida: SalidaHerramienta }

const AVISO = "\n\n_(Modo simulado: respuesta generada por guion, sin modelo de lenguaje.)_"
const PIDE_ESPERAR = /no la crees|hasta que (yo )?(lo |la )?confirme|sin crear|no crear/i

function pasos(mensajes: Mensaje[], desde: number): Paso[] {
  const r: Paso[] = []
  for (let i = desde; i < mensajes.length; i++) {
    const m = mensajes[i]
    const sig = mensajes[i + 1]
    if (m?.rol !== "asistente" || sig?.rol !== "herramientas") continue
    for (const ll of m.llamadas) {
      const res = sig.resultados.find((x) => x.id === ll.id)
      if (res) r.push({ llamada: ll, salida: leerSalida(res.contenido) })
    }
  }
  return r
}

function casoDe(p: Paso): string {
  const a = p.llamada.argumentos
  return a !== null && typeof a === "object" && "caso" in a && typeof a.caso === "string" ? a.caso : ""
}

/** Caso con confirmación pendiente en todo el historial (validado con confirmaciones y aún no creado). */
function casoPendiente(mensajes: Mensaje[]): string | null {
  let pendiente: string | null = null
  for (const p of pasos(mensajes, 0)) {
    if (p.llamada.nombre === "oc_validar" && p.salida.ok) {
      const v = comoValidacion(p.salida.data)
      pendiente = v.apta && v.confirmaciones.length ? casoDe(p) : pendiente === casoDe(p) ? null : pendiente
    }
    if (p.llamada.nombre === "oc_crear" && p.salida.ok && pendiente === casoDe(p)) pendiente = null
  }
  return pendiente
}

let contador = 0
const llamar = (nombre: string, argumentos: Record<string, unknown>): RespuestaModelo => {
  const llamada = { id: `sim-${++contador}`, nombre, argumentos }
  return { texto: "", llamadas: [llamada], fin: "herramientas", uso: USO_CERO, modelo: "guion", nativo: null }
}
const responder = (texto: string): RespuestaModelo => ({ texto: texto + AVISO, llamadas: [], fin: "fin_turno", uso: USO_CERO, modelo: "guion", nativo: null })

function textoBloqueo(caso: string, v: Validacion): string {
  const filas = v.bloqueos.map((b) => `| ${b.regla} | ${b.mensaje} | ${b.accion_sugerida} |`)
  const pasaron = v.controles.filter((c) => c.estado === "ok").map((c) => c.regla)
  return [
    `**${caso} · ${v.solicitud_id}: no se puede crear la OC.**`,
    "",
    "| Regla | Motivo | Acción sugerida |",
    "|---|---|---|",
    ...filas,
    "",
    `Controles que sí pasaron: ${pasaron.join(", ") || "ninguno"}.`,
  ].join("\n")
}

function textoOrden(caso: string, v: Validacion, p: DatosPayload, pregunta: boolean): string {
  const o = p.orden
  const pos = o.posiciones[0]
  const lineas = [
    `**${caso} · ${v.solicitud_id}** — así quedaría la OC en SAP:`,
    "",
    "| Campo | Valor |",
    "|---|---|",
    `| Proveedor | ${o.proveedor.codigo_sap} · ${o.proveedor.nombre} |`,
    `| Posición 10 | ${pos?.descripcion} · ${pos?.cantidad} ${pos?.unidad} × ${formatoMoneda(pos?.precio_unitario ?? 0, o.moneda)} |`,
    `| Valor total | **${formatoMoneda(p.valor_total_oc, o.moneda)}** |`,
    `| Centro / subárea | ${pos?.centro_costo} / ${pos?.subarea} |`,
    `| IVA · condiciones de pago | ${pos?.indicador_iva} · ${o.condiciones_pago} |`,
    `| Aprobador | ${o.aprobador.email} |`,
    "",
    `Validaciones: ${v.controles.map((c) => `${c.regla} ${c.estado === "ok" ? "✅" : c.estado === "confirmacion" ? "⚠" : c.estado === "derivado" ? "ℹ" : "➖"}`).join(" · ")}`,
  ]
  for (const [campo, d] of Object.entries(v.derivados)) lineas.push(`- ℹ Derivado ${campo} = **${d.valor}** (${d.detalle}).`)
  if (v.confirmaciones.length) {
    lineas.push("", "**Requiere tu confirmación:**")
    for (const c of v.confirmaciones) lineas.push(`- **${c.regla}**: ${c.mensaje} ${c.accion_sugerida}`)
  }
  if (pregunta) lineas.push("", `¿Confirmas la creación de la OC por ${formatoMoneda(p.valor_total_oc, o.moneda)}? Responde **confirmo** para crearla.`)
  return lineas.join("\n")
}

export class ProveedorSimulado implements ProveedorLLM {
  readonly proveedor = "simulado"
  readonly modelo = "guion-determinista"

  async enviar({ mensajes }: PeticionModelo): Promise<RespuestaModelo> {
    let inicio = mensajes.length - 1
    while (inicio >= 0 && mensajes[inicio]?.rol !== "usuario") inicio--
    const usuario = mensajes[inicio]
    const texto = usuario?.rol === "usuario" ? usuario.texto : ""
    const turno = pasos(mensajes, inicio + 1)
    const ultimo = turno.at(-1)
    const caso = ultimo ? casoDe(ultimo) : (texto.match(/sol-\d{3}/i)?.[0]?.toLowerCase() ?? "")

    if (!ultimo) {
      const pendiente = casoPendiente(mensajes)
      if (pendiente && esConfirmacion(texto)) return llamar("oc_crear", { caso: pendiente, confirmado: true })
      if (caso) return llamar("oc_validar", { caso })
      if (/caso|solicitud|lista/i.test(texto)) return llamar("oc_listar_casos", {})
      return responder("Indícame qué solicitud procesar, por ejemplo: **procesa sol-004**.")
    }

    if (!ultimo.salida.ok) return responder(`No pude completar **${ultimo.llamada.nombre}** para ${caso || "la solicitud"}: ${ultimo.salida.error}`)
    const validacion = turno.find((p) => p.llamada.nombre === "oc_validar" && p.salida.ok)
    const v = validacion?.salida.ok ? comoValidacion(validacion.salida.data) : null

    switch (ultimo.llamada.nombre) {
      case "oc_listar_casos":
        return responder(`Casos disponibles: ${(ultimo.salida.data as { casos: string[] }).casos.join(", ")}.`)
      case "oc_validar":
        if (v && !v.apta) return responder(textoBloqueo(caso, v))
        return llamar("oc_construir_payload", { caso })
      case "oc_construir_payload":
        return llamar("oc_generar_evidencia", { caso })
      case "oc_generar_evidencia": {
        const pl = turno.find((p) => p.llamada.nombre === "oc_construir_payload" && p.salida.ok)
        if (!v || !pl?.salida.ok) return responder("Faltan datos de la validación o del payload.")
        const payload = comoPayload(pl.salida.data)
        if (v.confirmaciones.length || PIDE_ESPERAR.test(texto)) return responder(textoOrden(caso, v, payload, true))
        return llamar("oc_crear", { caso })
      }
      case "oc_crear": {
        const c = comoCreacion(ultimo.salida.data)
        const extra = c.idempotente ? " Ya existía: no se creó una segunda OC (idempotencia)." : ""
        const retro = c.retroactiva ? " Quedó marcada **retroactiva = true** en el control." : ""
        const evidencia = c.ruta_evidencia ? ` Evidencia: \`${c.ruta_evidencia}\`.` : ""
        return responder(`✅ OC **${c.numero_oc}** (${c.fecha}) para ${c.solicitud_id}.${extra}${evidencia}${retro}`)
      }
      default:
        return responder("Listo.")
    }
  }
}
