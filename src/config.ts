// Configuración desde variables de entorno, validada con zod. La clave NUNCA se expone ni se registra.
import { z } from "zod"
import { describirErroresZod } from "./domain/fuentes.ts"

const EsquemaConfig = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LLM_PROVIDER: z.enum(["anthropic", "simulado"]).optional(),
  LLM_MODEL: z.string().min(1).default("claude-opus-5-5"),
  LLM_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  MAX_ITERACIONES: z.coerce.number().int().min(1).max(50).default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().positive().default(600_000),
  MAX_TOKENS_GLOBAL: z.coerce.number().int().positive().default(6_000_000),
  MAX_MENSAJES_POR_IP: z.coerce.number().int().positive().default(40),
  ACCESS_KEY: z.string().min(1).optional(),
})

export type Config = z.infer<typeof EsquemaConfig>

export function leerConfig(env: Record<string, string | undefined> = process.env): Config {
  // Variables vacías ("") se tratan como no definidas.
  const limpio = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""))
  const r = EsquemaConfig.safeParse(limpio)
  if (!r.success) throw new Error(`Configuración inválida: ${describirErroresZod(r.error)}`)
  return r.data
}
