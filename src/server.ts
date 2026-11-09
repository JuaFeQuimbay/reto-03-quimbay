// Servidor HTTP: API del chat + front estático. Un solo proceso (bun run dev).
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { ejecutarTurno, Presupuesto, type Dependencias } from "./agent/ciclo.ts"
import { cargarSistema } from "./agent/prompt.ts"
import { obtenerOCrearSesion, obtenerSesion } from "./agent/sesiones.ts"
import { leerConfig } from "./config.ts"
import { crearProveedor } from "./llm/index.ts"
import { definicionesHerramientas } from "./tools/index.ts"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const config = leerConfig()
const { proveedor, aviso } = crearProveedor(config)
const deps: Dependencias = {
  proveedor,
  sistema: await cargarSistema(RAIZ),
  herramientas: definicionesHerramientas(),
  directory: RAIZ,
  limites: { maxIteraciones: config.MAX_ITERACIONES, maxTokensSesion: config.MAX_TOKENS_SESION },
  presupuesto: new Presupuesto(config.MAX_TOKENS_GLOBAL),
}

const PeticionChat = z.object({
  sessionId: z.string().max(64, "sessionId demasiado largo").nullish(), // null/ausente = sesión nueva
  message: z.string().trim().min(1, "el mensaje está vacío").max(2000, "el mensaje supera 2000 caracteres"),
})

// --- utilidades HTTP -------------------------------------------------------------------
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } })
const error = (mensaje: string, status: number) => json({ error: mensaje }, status)

const ESTATICOS: Record<string, { archivo: string; tipo: string }> = {
  "/": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/app.js": { archivo: "app.js", tipo: "text/javascript; charset=utf-8" },
  "/estilos.css": { archivo: "estilos.css", tipo: "text/css; charset=utf-8" },
}

async function estatico(ruta: string): Promise<Response | null> {
  const e = ESTATICOS[ruta]
  if (!e) return null
  return new Response(await readFile(join(RAIZ, "web", e.archivo)), { headers: { "content-type": e.tipo } })
}

// --- protección del gasto: límite de mensajes por IP en una ventana de 10 minutos --------
const VENTANA_MS = 10 * 60_000
const mensajesPorIp = new Map<string, number[]>()

function permitido(ip: string): boolean {
  const ahora = Date.now()
  const recientes = (mensajesPorIp.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS)
  if (recientes.length >= config.MAX_MENSAJES_POR_IP) return false
  recientes.push(ahora)
  mensajesPorIp.set(ip, recientes)
  return true
}

function autorizado(req: Request): boolean {
  return !config.ACCESS_KEY || req.headers.get("x-access-key") === config.ACCESS_KEY
}

// --- rutas de la API -------------------------------------------------------------------
async function chat(req: Request, ip: string): Promise<Response> {
  if (!autorizado(req)) return error("Clave de acceso inválida.", 401)
  if (!permitido(ip)) return error("Demasiados mensajes desde esta IP. Espera unos minutos.", 429)
  const cuerpo = PeticionChat.safeParse(await req.json().catch(() => null))
  if (!cuerpo.success) return error(cuerpo.error.issues.map((i) => i.message).join("; "), 400)

  const sesion = obtenerOCrearSesion(cuerpo.data.sessionId ?? undefined)
  if (sesion.ocupada) return error("La sesión está procesando otro mensaje.", 409)
  sesion.ocupada = true
  try {
    const ts = new Date().toISOString()
    sesion.historial.push({ rol: "usuario", texto: cuerpo.data.message, ts })
    const r = await ejecutarTurno(sesion, cuerpo.data.message, deps)
    sesion.historial.push({
      rol: "agente",
      texto: r.reply,
      ts: new Date().toISOString(),
      toolCalls: r.toolCalls,
      needsConfirmation: r.needsConfirmation,
      ...(r.error ? { error: true } : {}),
    })
    return json({ sessionId: sesion.id, ...r })
  } finally {
    sesion.ocupada = false
  }
}

function historial(id: string, req: Request): Response {
  if (!autorizado(req)) return error("Clave de acceso inválida.", 401)
  const s = obtenerSesion(id)
  if (!s) return error("Sesión no encontrada.", 404)
  return json({ sessionId: s.id, creada: s.creada, pendiente: s.pendiente, uso: s.uso, historial: s.historial })
}

const servidor = Bun.serve({
  port: config.PORT,
  idleTimeout: 255, // un turno con varias herramientas puede tardar
  async fetch(req, server) {
    const url = new URL(req.url)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || server.requestIP(req)?.address || "desconocida"
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return json({ ok: true, provider: proveedor.proveedor, model: proveedor.modelo, protegido: Boolean(config.ACCESS_KEY) })
      }
      if (req.method === "POST" && url.pathname === "/api/chat") return await chat(req, ip)
      const m = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9-]{1,64})$/)
      if (req.method === "GET" && m?.[1]) return historial(m[1], req)
      if (req.method === "GET") return (await estatico(url.pathname)) ?? error("No encontrado.", 404)
      return error("Método no permitido.", 405)
    } catch (e) {
      console.error("Error no controlado:", e instanceof Error ? e.message : e)
      return error("Error interno del servidor.", 500)
    }
  },
})

console.log(`Agente OC escuchando en http://localhost:${servidor.port} · proveedor ${proveedor.proveedor} · modelo ${proveedor.modelo}`)
if (aviso) console.warn(`⚠ ${aviso}`)
