// demo.ts — procesa los 6 casos llamando directamente a las herramientas, SIN modelo de lenguaje.
// Uso: bun install && bun run demo.ts       (sale con código 1 si algún resultado no es el esperado)
import { readFile, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { formatoMoneda } from "./src/domain/texto.ts"
import type { OrdenCompra, Paquete, Validacion } from "./src/domain/tipos.ts"
import type { ContextoHerramienta } from "./src/tools/contrato.ts"
import { ejecutarHerramienta } from "./src/tools/index.ts"

const RAIZ = dirname(fileURLToPath(import.meta.url))
const ctx: ContextoHerramienta = { directory: RAIZ, sessionId: "demo" }

type Salida<T> = { ok: true; data: T } | { ok: false; error: string }
type Payload = { orden: OrdenCompra; valor_total_oc: number; ruta_trazabilidad: string }
type Creacion = { numero_oc: string; fecha: string; idempotente: boolean; ruta_evidencia?: string; retroactiva: boolean }

type Resultado = {
  paso: string
  resultado: "creada" | "idempotente" | "bloqueada" | "pendiente" | "error"
  numero_oc: string | null
  bloqueos: string[]
  confirmaciones: string[]
  retroactiva: boolean
}

async function llamar<T>(nombre: string, args: Record<string, unknown>): Promise<Salida<T>> {
  const r = await ejecutarHerramienta(nombre, args, ctx)
  return JSON.parse(r.salida) as Salida<T>
}

const linea = (texto = "") => console.log(texto)
const lista = (items: string[]) => (items.length ? items.join(", ") : "—")

// ---------------------------------------------------------------------------------------
async function procesar(caso: string, paso = caso): Promise<Resultado> {
  const base: Resultado = { paso, resultado: "error", numero_oc: null, bloqueos: [], confirmaciones: [], retroactiva: false }
  const paquete = await llamar<Paquete>("oc_leer_paquete", { caso })
  if (!paquete.ok) return linea(`  ✘ ${paquete.error}`), base
  const s = paquete.data.solicitud
  linea(`\n▶ ${paso}  ${s?.solicitud_id ?? "?"} · ${s?.proveedor_nombre ?? "?"} · ${s ? formatoMoneda(s.valor_total, s.moneda) : "?"}`)
  if (paquete.data.faltantes.length) linea(`  faltantes: ${paquete.data.faltantes.join(", ")}`)

  const val = await llamar<Validacion>("oc_validar", { caso, paquete: paquete.data })
  if (!val.ok) return linea(`  ✘ ${val.error}`), base
  const v = val.data
  const r: Resultado = {
    ...base,
    bloqueos: v.bloqueos.map((b) => b.regla),
    confirmaciones: v.confirmaciones.map((c) => c.regla),
    retroactiva: v.retroactiva,
  }
  linea(`  apta: ${v.apta ? "sí" : "NO"} · retroactiva: ${v.retroactiva ? "SÍ" : "no"}`)
  for (const b of v.bloqueos) linea(`  ⛔ ${b.regla} ${b.mensaje}\n     → ${b.accion_sugerida}`)
  for (const c of v.confirmaciones) linea(`  ⚠  ${c.regla} ${c.mensaje}`)
  for (const [campo, d] of Object.entries(v.derivados)) linea(`  ↳ derivado ${campo} = ${d.valor} (${d.fuente})`)
  if (!v.apta) return linea("  ⇒ BLOQUEADA: no se crea OC"), { ...r, resultado: "bloqueada" }

  const pl = await llamar<Payload>("oc_construir_payload", { caso, paquete: paquete.data, derivados: v.derivados })
  if (!pl.ok) return linea(`  ✘ ${pl.error}`), r
  const pos = pl.data.orden.posiciones[0]
  linea(`  OC: ${pl.data.orden.proveedor.codigo_sap} · "${pos?.descripcion}" · ${pos?.cantidad} ${pos?.unidad} × ${formatoMoneda(pos?.precio_unitario ?? 0)} = ${formatoMoneda(pl.data.valor_total_oc)} · IVA ${pos?.indicador_iva} · pago ${pl.data.orden.condiciones_pago}`)

  const ev = await llamar<{ ruta: string; sha256: string }>("oc_generar_evidencia", { caso })
  if (ev.ok) linea(`  evidencia: ${ev.data.ruta} (sha256 ${ev.data.sha256.slice(0, 12)}…)`)

  if (v.confirmaciones.length) {
    linea(`  ⇒ PENDIENTE: requiere confirmación humana (${lista(r.confirmaciones)})`)
    return { ...r, resultado: "pendiente" }
  }
  return crear(caso, paso, r, pl.data.orden, false)
}

async function crear(caso: string, paso: string, r: Resultado, payload: OrdenCompra | undefined, confirmado: boolean): Promise<Resultado> {
  const c = await llamar<Creacion>("oc_crear", { caso, confirmado, ...(payload ? { payload } : {}) })
  if (!c.ok) {
    linea(`  ✘ oc_crear rechazó: ${c.error}`)
    return { ...r, paso, resultado: c.error.includes("confirmación") ? "pendiente" : "bloqueada" }
  }
  linea(`  ✔ OC ${c.data.numero_oc} (${c.data.fecha}) · idempotente: ${c.data.idempotente}${c.data.ruta_evidencia ? ` · evidencia ${c.data.ruta_evidencia}` : ""}`)
  return { ...r, paso, resultado: c.data.idempotente ? "idempotente" : "creada", numero_oc: c.data.numero_oc, retroactiva: c.data.retroactiva }
}

// ---------------------------------------------------------------------------------------
const ESPERADO: Resultado[] = [
  { paso: "sol-001", resultado: "creada", numero_oc: "4500000001", bloqueos: [], confirmaciones: [], retroactiva: false },
  { paso: "sol-002", resultado: "bloqueada", numero_oc: null, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false },
  { paso: "sol-003", resultado: "bloqueada", numero_oc: null, bloqueos: ["RC2", "RC3"], confirmaciones: [], retroactiva: false },
  { paso: "sol-004", resultado: "pendiente", numero_oc: null, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
  { paso: "sol-005", resultado: "pendiente", numero_oc: null, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true },
  { paso: "sol-006", resultado: "pendiente", numero_oc: null, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false },
  { paso: "sol-001 (2.ª vez)", resultado: "idempotente", numero_oc: "4500000001", bloqueos: [], confirmaciones: [], retroactiva: false },
  { paso: "sol-004 sin confirmar", resultado: "pendiente", numero_oc: null, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
  { paso: "sol-004 confirmada", resultado: "creada", numero_oc: "4500000002", bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
  { paso: "sol-005 confirmada", resultado: "creada", numero_oc: "4500000003", bloqueos: [], confirmaciones: ["RC8"], retroactiva: true },
  { paso: "sol-006 confirmada", resultado: "creada", numero_oc: "4500000004", bloqueos: [], confirmaciones: ["RC6"], retroactiva: false },
]

function coincide(a: Resultado, e: Resultado): boolean {
  return (
    a.resultado === e.resultado &&
    a.numero_oc === e.numero_oc &&
    a.retroactiva === e.retroactiva &&
    a.bloqueos.join() === e.bloqueos.join() &&
    a.confirmaciones.join() === e.confirmaciones.join()
  )
}

async function main(): Promise<void> {
  await rm(join(RAIZ, "out"), { recursive: true, force: true })
  linea("══════ Reto 03 · Órdenes de Compra SAP · demo sin modelo de lenguaje ══════")
  linea("out/ limpio. Cada paso llama a las herramientas oc_* (mismo camino que usa el agente).")

  linea("\n── Fase 1 · procesar los 6 casos ──")
  const obtenidos: Resultado[] = []
  for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) obtenidos.push(await procesar(caso))

  linea("\n── Fase 2 · idempotencia: sol-001 por segunda vez ──")
  obtenidos.push(await procesar("sol-001", "sol-001 (2.ª vez)"))

  linea("\n── Fase 3 · confirmación humana ──")
  const pendiente = (caso: string) => obtenidos.find((o) => o.paso === caso) ?? ESPERADO[0]!
  linea("\n▶ sol-004 · oc_crear SIN confirmado (la compuerta debe rechazar)")
  obtenidos.push(await crear("sol-004", "sol-004 sin confirmar", pendiente("sol-004"), undefined, false))
  for (const caso of ["sol-004", "sol-005", "sol-006"]) {
    linea(`\n▶ ${caso} · la analista responde "confirmo" → oc_crear(confirmado=true)`)
    obtenidos.push(await crear(caso, `${caso} confirmada`, pendiente(caso), undefined, true))
  }

  linea("\n── Verificación contra el resultado esperado ──")
  linea("paso                    resultado     OC           bloqueos   confirm.  retro")
  let fallas = 0
  ESPERADO.forEach((e, i) => {
    const a = obtenidos[i]
    const okFila = a !== undefined && coincide(a, e)
    if (!okFila) fallas++
    const x = a ?? e
    linea(
      `${okFila ? "✔" : "✘"} ${x.paso.padEnd(22)}${x.resultado.padEnd(14)}${(x.numero_oc ?? "—").padEnd(13)}${lista(x.bloqueos).padEnd(11)}${lista(x.confirmaciones).padEnd(10)}${x.retroactiva ? "sí" : "no"}`,
    )
  })

  linea("\n── out/control.csv ──")
  linea((await readFile(join(RAIZ, "out", "control.csv"), "utf8")).trimEnd())
  linea(`\n${fallas === 0 ? "✔ TODO OK" : `✘ ${fallas} diferencia(s)`} · ${ESPERADO.length} pasos verificados`)
  if (fallas) process.exitCode = 1
}

await main()
