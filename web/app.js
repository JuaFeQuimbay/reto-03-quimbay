// Front del chat: historial, llamadas a herramientas visibles y resaltado de confirmación (PRD 6.1).
const $ = (id) => document.getElementById(id)
const chat = $("chat")
const form = $("formulario")
const entrada = $("mensaje")
const enviar = $("enviar")
const banner = $("confirmar")
const clave = $("clave")

const almacen = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* sin almacenamiento */ } },
}
let sessionId = almacen.get("oc-session") || null

// ---------- Markdown mínimo y seguro (escapa HTML primero) ----------
const escapar = (t) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const enLinea = (t) =>
  escapar(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,]|$)/g, "$1<em>$2</em>")

function markdown(texto) {
  const lineas = texto.replace(/\r/g, "").split("\n")
  const html = []
  let i = 0
  while (i < lineas.length) {
    const l = lineas[i]
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lineas[i + 1] || "")) {
      const celdas = (f) => f.trim().replace(/^\||\|$/g, "").split("|").map((c) => enLinea(c.trim()))
      const cabecera = celdas(l)
      i += 2
      const filas = []
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]))
      html.push(`<div class="tabla"><table><thead><tr>${cabecera.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`)
      continue
    }
    if (/^\s*[-*]\s+/.test(l)) {
      const items = []
      while (i < lineas.length && /^\s*[-*]\s+/.test(lineas[i])) items.push(`<li>${enLinea(lineas[i++].replace(/^\s*[-*]\s+/, ""))}</li>`)
      html.push(`<ul>${items.join("")}</ul>`)
      continue
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/)
    if (h) html.push(`<h4>${enLinea(h[2])}</h4>`)
    else if (l.trim()) html.push(`<p>${enLinea(l)}</p>`)
    i++
  }
  return html.join("")
}

// ---------- Render ----------
function ocultarBienvenida() { $("bienvenida")?.remove() }
function bajar() { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }) }

function agregarUsuario(texto) {
  ocultarBienvenida()
  const div = document.createElement("div")
  div.className = "msg usuario"
  div.textContent = texto
  chat.appendChild(div)
  bajar()
}

function tarjetaHerramienta(t) {
  const d = document.createElement("details")
  d.className = `herramienta${t.bloqueadaPorCompuerta ? " compuerta" : ""}`
  const estado = t.ok ? '<span class="ok">✔</span>' : '<span class="fallo">✘</span>'
  d.innerHTML = `<summary>${estado}<span class="nombre">${escapar(t.nombre)}</span><span class="resumen">${escapar(t.resumen)}</span><span class="resumen">${t.ms} ms</span></summary><pre>${escapar(JSON.stringify(t.argumentos ?? {}, null, 2))}</pre>`
  return d
}

function agregarAgente(r) {
  ocultarBienvenida()
  const div = document.createElement("div")
  div.className = `msg agente${r.error ? " error" : ""}${r.needsConfirmation ? " pide" : ""}`
  const n = (r.toolCalls || []).length
  div.innerHTML = `<div class="etiqueta">Agente · ${n} llamada${n === 1 ? "" : "s"} a herramientas${r.needsConfirmation ? '<span class="pregunta">· requiere tu confirmación</span>' : ""}</div>`
  if (n) {
    const cont = document.createElement("div")
    cont.className = "herramientas"
    r.toolCalls.forEach((t) => cont.appendChild(tarjetaHerramienta(t)))
    div.appendChild(cont)
  }
  const cuerpo = document.createElement("div")
  cuerpo.className = "contenido"
  cuerpo.innerHTML = markdown(r.reply || r.texto || "")
  div.appendChild(cuerpo)
  chat.appendChild(div)
  bajar()
}

function mostrarConfirmacion(pendiente) {
  banner.hidden = !pendiente
  $("confirmar-detalle").textContent = pendiente ? `Caso ${pendiente.caso} · ${pendiente.reglas.join(", ")}` : ""
}

function pensando(activo) {
  enviar.disabled = activo
  $("btn-confirmo").disabled = activo
  $("btn-cancelo").disabled = activo
  document.querySelector(".pensando")?.remove()
  if (activo) {
    const p = document.createElement("div")
    p.className = "pensando"
    p.textContent = "El agente está pensando y llamando herramientas"
    chat.appendChild(p)
    bajar()
  }
}

// ---------- API ----------
const cabeceras = () => ({ "content-type": "application/json", ...(clave.value ? { "x-access-key": clave.value } : {}) })

async function mandar(texto) {
  if (!texto.trim() || enviar.disabled) return
  agregarUsuario(texto)
  pensando(true)
  try {
    const res = await fetch("/api/chat", { method: "POST", headers: cabeceras(), body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), message: texto }) })
    const r = await res.json().catch(() => ({ error: "Respuesta inválida del servidor" }))
    if (!res.ok) {
      agregarAgente({ reply: `⚠ ${r.error || `Error ${res.status}`}`, error: true })
      return
    }
    sessionId = r.sessionId
    almacen.set("oc-session", sessionId)
    agregarAgente(r)
    mostrarConfirmacion(r.needsConfirmation ? r.pendiente : null)
  } catch {
    agregarAgente({ reply: "⚠ No hay conexión con el servidor. Intenta de nuevo.", error: true })
  } finally {
    pensando(false)
    entrada.focus()
  }
}

async function restaurar() {
  if (!sessionId) return
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { headers: cabeceras() }).catch(() => null)
  if (!res || !res.ok) { sessionId = null; almacen.del("oc-session"); return }
  const s = await res.json()
  for (const e of s.historial) e.rol === "usuario" ? agregarUsuario(e.texto) : agregarAgente({ ...e, reply: e.texto })
  mostrarConfirmacion(s.pendiente)
}

async function salud() {
  const estado = $("estado")
  try {
    const h = await (await fetch("/api/health")).json()
    estado.textContent = `${h.provider} · ${h.model}`
    estado.classList.toggle("simulado", h.provider === "simulado")
    if (h.protegido) { clave.hidden = false; clave.value = almacen.get("oc-clave") || "" }
  } catch {
    estado.textContent = "sin conexión"
  }
}

// ---------- Eventos ----------
form.addEventListener("submit", (e) => { e.preventDefault(); const t = entrada.value; entrada.value = ""; mandar(t) })
entrada.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit() } })
document.addEventListener("click", (e) => { const chip = e.target.closest(".chip"); if (chip) mandar(chip.dataset.msg) })
$("btn-confirmo").addEventListener("click", () => mandar("Confirmo"))
$("btn-cancelo").addEventListener("click", () => mandar("No, cancela la creación de esta OC"))
clave.addEventListener("change", () => almacen.set("oc-clave", clave.value))
$("nueva").addEventListener("click", () => { almacen.del("oc-session"); location.reload() })

salud().then(restaurar)
