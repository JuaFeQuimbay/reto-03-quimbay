// Las MISMAS herramientas que usa la aplicación, importables sin el servidor HTTP ni el ciclo del agente.
// No es una copia: re-exporta src/tools/oc.ts (que solo depende de src/domain y src/sap).
export * from "../../src/tools/oc.ts"
export type { ContextoHerramienta, Herramienta } from "../../src/tools/contrato.ts"
export { definicionesHerramientas, ejecutarHerramienta, HERRAMIENTAS } from "../../src/tools/index.ts"
