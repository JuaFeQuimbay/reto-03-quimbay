// Fábrica del adaptador SAP. Hoy solo existe el mock; el real se agregaría aquí (ver SOLUCION.md).
import type { SapAdapter } from "./adapter.ts"
import { SapMock } from "./mock.ts"

export function crearAdaptadorSap(directory: string): SapAdapter {
  const tipo = process.env.SAP_ADAPTER ?? "mock"
  if (tipo !== "mock") throw new Error(`Adaptador SAP "${tipo}" no implementado; usa SAP_ADAPTER=mock`)
  return new SapMock(directory)
}
