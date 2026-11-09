// Elige la implementación de ProveedorLLM según la configuración.
import type { Config } from "../config.ts"
import type { ProveedorLLM } from "./adapter.ts"
import { ProveedorAnthropic } from "./anthropic.ts"
import { ProveedorSimulado } from "./simulado.ts"

export function crearProveedor(config: Config): { proveedor: ProveedorLLM; aviso?: string } {
  const pedido = config.LLM_PROVIDER ?? (config.ANTHROPIC_API_KEY ? "anthropic" : "simulado")
  if (pedido === "anthropic" && config.ANTHROPIC_API_KEY) {
    return {
      proveedor: new ProveedorAnthropic({
        apiKey: config.ANTHROPIC_API_KEY,
        modelo: config.LLM_MODEL,
        timeoutMs: config.LLM_TIMEOUT_MS,
        esfuerzo: config.LLM_EFFORT,
      }),
    }
  }
  const aviso = pedido === "anthropic" ? "LLM_PROVIDER=anthropic pero falta ANTHROPIC_API_KEY: se usa el proveedor simulado." : undefined
  return { proveedor: new ProveedorSimulado(), ...(aviso ? { aviso } : {}) }
}
