// Utilidades puras de normalización y formato. Sin dependencias ni efectos.

const PALABRAS_SOCIETARIAS = new Set(["sas", "sa", "ltda", "sl", "eu", "inc", "ltd", "cia"])
const CONECTORES_FINALES = new Set(["de", "del", "la", "el", "los", "las", "para", "con", "y", "a", "en", "por"])

export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

/** Clave de comparación: sin tildes, minúsculas, sin espacios extremos. */
export function clave(texto: string): string {
  return sinTildes(texto).toLowerCase().trim()
}

/** "TecnoSuministros S.A.S." → "tecnosuministros" (sin razón social ni puntuación). */
export function normalizarNombre(nombre: string): string {
  return clave(nombre)
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p !== "" && !PALABRAS_SOCIETARIAS.has(p))
    .join(" ")
}

/** "900.555.111-2" → "900555111" (sin puntos ni dígito de verificación). */
export function normalizarNit(nit: string): string {
  const base = nit.includes("-") ? (nit.split("-")[0] ?? "") : nit
  return base.replace(/\D/g, "")
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Monto en formato colombiano ("11.400.000" o "1.234,50") → número. null si no es numérico. */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, "").replace(",", ".")
  return /^\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : null
}

/** 11400000 → "COP 11.400.000" (formato determinista, sin depender de ICU). */
export function formatoMoneda(valor: number, moneda = "COP"): string {
  const [entero = "0", decimales = "00"] = Math.abs(valor).toFixed(2).split(".")
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const signo = valor < 0 ? "-" : ""
  return `${moneda} ${signo}${miles}${decimales === "00" ? "" : `,${decimales}`}`
}

/** 0.06 → "6,00 %" */
export function formatoPorcentaje(fraccion: number): string {
  return `${(fraccion * 100).toFixed(2).replace(".", ",")} %`
}

/** Fecha calendario tal como fue escrita (respeta la zona horaria del emisor). */
export function soloFecha(iso: string): string {
  return iso.slice(0, 10)
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

/** Recorta a `max` caracteres en límite de palabra, sin dejar conectores colgando. */
export function truncarTexto(texto: string, max: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim()
  if (limpio.length <= max) return limpio
  const corte = limpio.slice(0, max)
  const ultimoEspacio = corte.lastIndexOf(" ")
  const base = ultimoEspacio >= max * 0.5 ? corte.slice(0, ultimoEspacio) : corte
  const palabras = base.replace(/[,;:.\-]+$/, "").split(" ")
  while (palabras.length > 1 && CONECTORES_FINALES.has(clave(palabras.at(-1) ?? ""))) palabras.pop()
  return palabras.join(" ")
}
