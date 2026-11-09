// Interfaz propia del proveedor LLM (PRD 6.1). El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor = escribir otra implementación de ProveedorLLM, sin tocar el ciclo.

export type HerramientaModelo = { nombre: string; descripcion: string; parametros: Record<string, unknown> }

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: unknown }
export type ResultadoHerramienta = { id: string; contenido: string; esError: boolean }

export type Mensaje =
  | { rol: "usuario"; texto: string }
  /** `nativo`: contenido exacto devuelto por el proveedor; se reenvía sin modificar (append-only). */
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[]; nativo?: unknown }
  | { rol: "herramientas"; resultados: ResultadoHerramienta[] }

export type MotivoFin = "fin_turno" | "herramientas" | "limite_tokens" | "rechazo" | "otro"

export type Uso = { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }

export type RespuestaModelo = {
  texto: string
  llamadas: LlamadaHerramienta[]
  fin: MotivoFin
  uso: Uso
  modelo: string
  nativo: unknown
}

export type PeticionModelo = { sistema: string; mensajes: Mensaje[]; herramientas: HerramientaModelo[] }

export interface ProveedorLLM {
  readonly proveedor: string
  readonly modelo: string
  enviar(peticion: PeticionModelo): Promise<RespuestaModelo>
}

export type TipoErrorLLM = "timeout" | "autenticacion" | "limite_tasa" | "solicitud_invalida" | "conexion" | "proveedor"

/** Error del proveedor ya traducido a lenguaje claro (CA5). Nunca incluye la clave. */
export class ErrorLLM extends Error {
  readonly tipo: TipoErrorLLM

  constructor(tipo: TipoErrorLLM, mensaje: string) {
    super(mensaje)
    this.name = "ErrorLLM"
    this.tipo = tipo
  }
}

export const USO_CERO: Uso = { entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0 }

export function sumarUso(a: Uso, b: Uso): Uso {
  return {
    entrada: a.entrada + b.entrada,
    salida: a.salida + b.salida,
    cacheLectura: a.cacheLectura + b.cacheLectura,
    cacheEscritura: a.cacheEscritura + b.cacheEscritura,
  }
}

export function totalTokens(u: Uso): number {
  return u.entrada + u.salida + u.cacheLectura + u.cacheEscritura
}
