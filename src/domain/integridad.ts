// Hash y comparación canónica: detectan si un dato que vuelve del modelo fue alterado.
import { createHash } from "node:crypto"

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** Representación estable: claves ordenadas, sin `undefined`. */
export function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico)
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonico(v)]),
    )
  }
  return valor
}

export function mismoContenido(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonico(a)) === JSON.stringify(canonico(b))
}
