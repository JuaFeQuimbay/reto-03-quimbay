// Implementación de ProveedorLLM para Claude (API de Anthropic, SDK oficial).
import Anthropic from "@anthropic-ai/sdk"
import {
  ErrorLLM,
  type LlamadaHerramienta,
  type Mensaje,
  type MotivoFin,
  type PeticionModelo,
  type ProveedorLLM,
  type RespuestaModelo,
} from "./adapter.ts"

export type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max"

type OpcionesAnthropic = { apiKey: string; modelo: string; timeoutMs: number; esfuerzo: Esfuerzo; maxTokens?: number }

// Modelos que aceptan el respaldo automático del servidor ante un rechazo por políticas.
const ACEPTAN_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"])

const FIN: Record<string, MotivoFin> = {
  end_turn: "fin_turno",
  tool_use: "herramientas",
  max_tokens: "limite_tokens",
  refusal: "rechazo",
}

export function aMensajeAnthropic(m: Mensaje): Anthropic.Beta.BetaMessageParam {
  if (m.rol === "usuario") return { role: "user", content: m.texto }
  if (m.rol === "herramientas") {
    return {
      role: "user",
      content: m.resultados.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.contenido, is_error: r.esError })),
    }
  }
  // Se reenvía el contenido original (incluye bloques de razonamiento) sin modificarlo.
  if (Array.isArray(m.nativo)) return { role: "assistant", content: m.nativo as Anthropic.Beta.BetaContentBlock[] }
  return {
    role: "assistant",
    content: [
      ...(m.texto ? [{ type: "text" as const, text: m.texto }] : []),
      ...m.llamadas.map((l) => ({ type: "tool_use" as const, id: l.id, name: l.nombre, input: l.argumentos })),
    ],
  }
}

function traducirError(e: unknown): ErrorLLM {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ErrorLLM("timeout", "El modelo de lenguaje tardó demasiado en responder (timeout). Intenta de nuevo.")
  if (e instanceof Anthropic.AuthenticationError) return new ErrorLLM("autenticacion", "La clave del proveedor LLM no es válida o no está configurada en el servidor.")
  if (e instanceof Anthropic.RateLimitError) return new ErrorLLM("limite_tasa", "El proveedor LLM está limitando las solicitudes. Espera un momento y reintenta.")
  if (e instanceof Anthropic.BadRequestError) return new ErrorLLM("solicitud_invalida", `El proveedor rechazó la solicitud: ${e.message}`)
  if (e instanceof Anthropic.APIError) return new ErrorLLM("proveedor", `El proveedor LLM respondió con error ${e.status ?? "desconocido"}.`)
  if (e instanceof Anthropic.APIConnectionError) return new ErrorLLM("conexion", "No fue posible conectar con el proveedor LLM.")
  return new ErrorLLM("proveedor", "Error inesperado al llamar al modelo de lenguaje.")
}

export class ProveedorAnthropic implements ProveedorLLM {
  readonly proveedor = "anthropic"
  readonly modelo: string
  private readonly cliente: Anthropic
  private readonly esfuerzo: Esfuerzo
  private readonly maxTokens: number

  constructor(o: OpcionesAnthropic) {
    this.modelo = o.modelo
    this.esfuerzo = o.esfuerzo
    this.maxTokens = o.maxTokens ?? 16_000
    this.cliente = new Anthropic({ apiKey: o.apiKey, timeout: o.timeoutMs, maxRetries: 1 })
  }

  async enviar({ sistema, mensajes, herramientas }: PeticionModelo): Promise<RespuestaModelo> {
    const conFallback = ACEPTAN_FALLBACK.has(this.modelo)
    let r: Anthropic.Beta.BetaMessage
    try {
      r = await this.cliente.beta.messages.create({
        model: this.modelo,
        max_tokens: this.maxTokens,
        output_config: { effort: this.esfuerzo },
        cache_control: { type: "ephemeral" }, // prompt + herramientas son estables: se cachean
        system: sistema,
        tools: herramientas.map((h) => ({
          name: h.nombre,
          description: h.descripcion,
          input_schema: h.parametros as Anthropic.Beta.BetaTool.InputSchema,
        })),
        messages: mensajes.map(aMensajeAnthropic),
        ...(conFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      })
    } catch (e) {
      throw traducirError(e)
    }

    const llamadas: LlamadaHerramienta[] = []
    const textos: string[] = []
    for (const b of r.content) {
      if (b.type === "text") textos.push(b.text)
      else if (b.type === "tool_use") llamadas.push({ id: b.id, nombre: b.name, argumentos: b.input })
    }
    return {
      texto: textos.join("\n").trim(),
      llamadas,
      fin: FIN[r.stop_reason ?? ""] ?? "otro",
      uso: {
        entrada: r.usage.input_tokens,
        salida: r.usage.output_tokens,
        cacheLectura: r.usage.cache_read_input_tokens ?? 0,
        cacheEscritura: r.usage.cache_creation_input_tokens ?? 0,
      },
      modelo: r.model,
      nativo: r.content,
    }
  }
}
