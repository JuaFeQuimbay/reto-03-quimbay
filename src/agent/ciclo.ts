// Ciclo del agente (PRD 6.3): prompt → modelo → herramientas → modelo … → respuesta.
// CA1 tope de iteraciones · CA2 valores solo desde herramientas · CA3 compuerta de confirmación
// CA4 cada llamada visible y en out/log.jsonl · CA5 errores en lenguaje claro sin matar la sesión.
import { registrarLog } from "../domain/salidas.ts"
import {
  ErrorLLM,
  sumarUso,
  totalTokens,
  USO_CERO,
  type HerramientaModelo,
  type LlamadaHerramienta,
  type ProveedorLLM,
  type RespuestaModelo,
  type ResultadoHerramienta,
  type Uso,
} from "../llm/adapter.ts"
import { ejecutarHerramienta } from "../tools/index.ts"
import { esConfirmacion, esNegacion } from "./confirmacion.ts"
import { comoValidacion, leerSalida, resumirSalida } from "./salida-herramienta.ts"
import type { Sesion, ToolCallVista } from "./sesiones.ts"

export type LimitesCiclo = { maxIteraciones: number; maxTokensSesion: number }

/** Tope global de tokens del proceso: nadie puede gastar la clave sin límite. */
export class Presupuesto {
  private usado = 0
  readonly maximo: number

  constructor(maximo: number) {
    this.maximo = maximo
  }

  disponible(): boolean {
    return this.usado < this.maximo
  }

  registrar(uso: Uso): void {
    this.usado += totalTokens(uso)
  }

  get consumido(): number {
    return this.usado
  }
}

export type Dependencias = {
  proveedor: ProveedorLLM
  sistema: string
  herramientas: HerramientaModelo[]
  directory: string
  limites: LimitesCiclo
  presupuesto: Presupuesto
}

export type ResultadoTurno = {
  reply: string
  toolCalls: ToolCallVista[]
  needsConfirmation: boolean
  pendiente: Sesion["pendiente"]
  iteraciones: number
  uso: Uso
  error?: string
}

type Contexto = { sesion: Sesion; deps: Dependencias; confirmoEsteTurno: boolean; casoConfirmable: string | null }

function argumento(args: unknown, campo: string): unknown {
  return args !== null && typeof args === "object" && campo in args ? (args as Record<string, unknown>)[campo] : undefined
}

/** CA3 en código: confirmado=true solo vale si el usuario confirmó ESTE caso en su último mensaje. */
function violaCompuerta(ll: LlamadaHerramienta, c: Contexto): boolean {
  if (ll.nombre !== "oc_crear" || argumento(ll.argumentos, "confirmado") !== true) return false
  return !(c.confirmoEsteTurno && argumento(ll.argumentos, "caso") === c.casoConfirmable)
}

/** Neutraliza el flag en vez de rechazar la llamada: oc_crear decide (crea si no hay confirmaciones; si las hay, pide confirmar). */
function sinConfirmado(args: unknown): Record<string, unknown> {
  const base = args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {}
  return { ...base, confirmado: false }
}

/** Mantiene sesion.pendiente según lo que devolvieron las herramientas. */
function actualizarPendiente(sesion: Sesion, ll: LlamadaHerramienta, salida: string): void {
  const caso = argumento(ll.argumentos, "caso")
  const s = leerSalida(salida)
  if (typeof caso !== "string" || !s.ok) return
  if (ll.nombre === "oc_validar") {
    const v = comoValidacion(s.data)
    if (v.apta && v.confirmaciones.length) sesion.pendiente = { caso, reglas: v.confirmaciones.map((x) => x.regla) }
    else if (sesion.pendiente?.caso === caso) sesion.pendiente = null
  }
  if (ll.nombre === "oc_crear" && sesion.pendiente?.caso === caso) sesion.pendiente = null
}

async function ejecutarLlamada(ll: LlamadaHerramienta, c: Contexto): Promise<{ resultado: ResultadoHerramienta; vista: ToolCallVista }> {
  const ctx = { directory: c.deps.directory, sessionId: c.sesion.id }
  const compuerta = violaCompuerta(ll, c)
  const args = compuerta ? sinConfirmado(ll.argumentos) : ll.argumentos
  if (compuerta) {
    await registrarLog(ctx.directory, { ts: new Date().toISOString(), sessionId: ctx.sessionId, evento: "compuerta_CA3", herramienta: ll.nombre, args: ll.argumentos, detalle: "confirmado=true anulado: el usuario no confirmó este caso en su último mensaje" })
  }
  const ej = await ejecutarHerramienta(ll.nombre, args, ctx)
  actualizarPendiente(c.sesion, ll, ej.salida)
  const resumen = `${compuerta ? "⚠ confirmado anulado por la compuerta · " : ""}${resumirSalida(ll.nombre, ej.salida)}`
  return {
    resultado: { id: ll.id, contenido: ej.salida, esError: !ej.ok },
    vista: { nombre: ll.nombre, argumentos: args, ok: ej.ok, resumen, ms: ej.ms, ...(compuerta ? { compuerta: true } : {}) },
  }
}

function resultado(sesion: Sesion, reply: string, toolCalls: ToolCallVista[], iteraciones: number, uso: Uso, error?: string): ResultadoTurno {
  return { reply, toolCalls, needsConfirmation: sesion.pendiente !== null && !error, pendiente: sesion.pendiente, iteraciones, uso, ...(error ? { error } : {}) }
}

function textoTope(max: number, toolCalls: ToolCallVista[]): string {
  const hechas = toolCalls.map((t) => `- ${t.nombre}: ${t.resumen}`).join("\n")
  return `Alcancé el tope de ${max} iteraciones en este turno, así que me detengo aquí.\n\n**Lo que alcancé a hacer:**\n${hechas || "- nada"}\n\n**Lo que falta:** completar el procesamiento. Escribe "continúa" para seguir.`
}

export async function ejecutarTurno(sesion: Sesion, mensaje: string, deps: Dependencias): Promise<ResultadoTurno> {
  const toolCalls: ToolCallVista[] = []
  let uso = USO_CERO

  if (totalTokens(sesion.uso) >= deps.limites.maxTokensSesion) {
    return resultado(sesion, `Esta sesión alcanzó el tope de ${deps.limites.maxTokensSesion.toLocaleString("es-CO")} tokens. Inicia una sesión nueva.`, [], 0, uso, "tope_sesion")
  }
  if (!deps.presupuesto.disponible()) {
    return resultado(sesion, "Se alcanzó el tope global de consumo del servidor. Intenta más tarde.", [], 0, uso, "tope_global")
  }

  const c: Contexto = { sesion, deps, confirmoEsteTurno: sesion.pendiente !== null && esConfirmacion(mensaje), casoConfirmable: sesion.pendiente?.caso ?? null }
  if (sesion.pendiente && esNegacion(mensaje)) sesion.pendiente = null
  sesion.mensajes.push({ rol: "usuario", texto: mensaje })

  for (let iteracion = 1; iteracion <= deps.limites.maxIteraciones; iteracion++) {
    let r: RespuestaModelo
    try {
      r = await deps.proveedor.enviar({ sistema: deps.sistema, mensajes: sesion.mensajes, herramientas: deps.herramientas })
    } catch (e) {
      const msg = e instanceof ErrorLLM ? e.message : "Error inesperado del proveedor LLM."
      return resultado(sesion, `⚠ ${msg} La sesión sigue activa: puedes reintentar.`, toolCalls, iteracion, uso, e instanceof ErrorLLM ? e.tipo : "proveedor")
    }
    uso = sumarUso(uso, r.uso)
    sesion.uso = sumarUso(sesion.uso, r.uso)
    deps.presupuesto.registrar(r.uso)

    if (r.fin === "rechazo") return resultado(sesion, "El modelo declinó responder esta solicitud. Reformula la petición.", toolCalls, iteracion, uso, "rechazo")
    if (r.fin === "limite_tokens" && r.llamadas.length) {
      return resultado(sesion, "La respuesta del modelo se cortó por longitud antes de completar una herramienta. Reintenta.", toolCalls, iteracion, uso, "limite_tokens")
    }

    sesion.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas, nativo: r.nativo })
    if (r.llamadas.length === 0) return resultado(sesion, r.texto || "(El modelo no devolvió texto.)", toolCalls, iteracion, uso)

    const resultados: ResultadoHerramienta[] = []
    for (const ll of r.llamadas) {
      const { resultado: res, vista } = await ejecutarLlamada(ll, c)
      resultados.push(res)
      toolCalls.push(vista)
    }
    sesion.mensajes.push({ rol: "herramientas", resultados })
  }
  return resultado(sesion, textoTope(deps.limites.maxIteraciones, toolCalls), toolCalls, deps.limites.maxIteraciones, uso, "tope_iteraciones")
}
