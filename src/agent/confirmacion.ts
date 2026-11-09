// CA3: ¿el mensaje del usuario es una confirmación explícita? Criterio conservador:
// ante cualquier negación o ambigüedad, NO es confirmación.
import { clave } from "../domain/texto.ts"

const VERBO_CONFIRMA = /\b(confirmo|confirmado|confirmada|apruebo|autorizo|procede|proceder|adelante|creala|crealas|crea la oc|hazlo)\b/
const INICIO_AFIRMA = /^(si|ok|okay|dale|listo|de acuerdo|correcto)\b/
const NEGACION = /\b(no|cancela|cancelar|cancelo|espera|detente|rechazo|todavia|aun no)\b/

export function esConfirmacion(texto: string): boolean {
  const t = clave(texto)
  return (VERBO_CONFIRMA.test(t) || INICIO_AFIRMA.test(t)) && !NEGACION.test(t)
}

export function esNegacion(texto: string): boolean {
  return /^(no|cancela|cancelar|cancelo|rechazo)\b/.test(clave(texto))
}
