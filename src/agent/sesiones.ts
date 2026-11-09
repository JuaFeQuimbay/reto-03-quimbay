// Sesiones en memoria (PRD 3.2: sin base de datos). Acotadas para no crecer sin límite.
import { randomUUID } from "node:crypto"
import { USO_CERO, type Mensaje, type Uso } from "../llm/adapter.ts"

export type ToolCallVista = {
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  ms: number
  bloqueadaPorCompuerta?: boolean
}

export type EntradaHistorial = {
  rol: "usuario" | "agente"
  texto: string
  ts: string
  toolCalls?: ToolCallVista[]
  needsConfirmation?: boolean
  error?: boolean
}

export type Pendiente = { caso: string; reglas: string[] }

export type Sesion = {
  id: string
  creada: string
  /** Conversación en formato neutral para el modelo (append-only). */
  mensajes: Mensaje[]
  /** Historial visible para el front. */
  historial: EntradaHistorial[]
  pendiente: Pendiente | null
  uso: Uso
  ocupada: boolean
  ultimoUso: number
}

const MAX_SESIONES = 200
const PATRON_ID = /^[A-Za-z0-9-]{8,64}$/
const sesiones = new Map<string, Sesion>()

function nueva(id: string): Sesion {
  return { id, creada: new Date().toISOString(), mensajes: [], historial: [], pendiente: null, uso: USO_CERO, ocupada: false, ultimoUso: Date.now() }
}

function desalojarAntiguas(): void {
  if (sesiones.size < MAX_SESIONES) return
  const masAntigua = [...sesiones.values()].filter((s) => !s.ocupada).sort((a, b) => a.ultimoUso - b.ultimoUso)[0]
  if (masAntigua) sesiones.delete(masAntigua.id)
}

export function obtenerSesion(id: string): Sesion | undefined {
  return sesiones.get(id)
}

export function obtenerOCrearSesion(id: string | undefined): Sesion {
  const existente = id ? sesiones.get(id) : undefined
  if (existente) {
    existente.ultimoUso = Date.now()
    return existente
  }
  desalojarAntiguas()
  const s = nueva(id && PATRON_ID.test(id) ? id : randomUUID())
  sesiones.set(s.id, s)
  return s
}
