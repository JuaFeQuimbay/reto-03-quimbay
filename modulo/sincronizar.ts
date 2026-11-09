// Mantiene modulo/agent.md y modulo/skill/ordenes-compra/SKILL.md idénticos a su fuente única.
//   bun run modulo:sync    copia la fuente al módulo
//   bun run modulo:check   falla (código 1) si el módulo divergió de la fuente
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { RUTA_CONOCIMIENTO, RUTA_PROMPT } from "../src/agent/prompt.ts"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const PIEZAS = [
  { nombre: "system prompt", fuente: RUTA_PROMPT, destino: join("modulo", "agent.md") },
  { nombre: "conocimiento", fuente: RUTA_CONOCIMIENTO, destino: join("modulo", "skill", "ordenes-compra", "SKILL.md") },
]

const soloVerificar = process.argv.includes("--check")
let divergencias = 0

for (const p of PIEZAS) {
  const esperado = await readFile(join(RAIZ, p.fuente), "utf8")
  const actual = await readFile(join(RAIZ, p.destino), "utf8").catch(() => null)
  const igual = actual === esperado
  if (soloVerificar) {
    console.log(`${igual ? "✔" : "✘"} ${p.nombre}: ${p.destino} ${igual ? "idéntico a" : "DIFIERE de"} ${p.fuente}`)
    if (!igual) divergencias++
  } else if (!igual) {
    await mkdir(dirname(join(RAIZ, p.destino)), { recursive: true })
    await writeFile(join(RAIZ, p.destino), esperado, "utf8")
    console.log(`↻ ${p.nombre}: ${p.fuente} → ${p.destino}`)
  } else console.log(`✔ ${p.nombre}: ya estaba sincronizado`)
}

if (divergencias) {
  console.error(`\n${divergencias} pieza(s) del módulo divergen de la fuente. Ejecuta: bun run modulo:sync`)
  process.exitCode = 1
}
