// Front de chat sin framework. El texto del modelo se renderiza como Markdown SANEADO (DOMPurify):
// la salida del modelo puede arrastrar contenido de documentos externos y no se confía en ella.
const $ = (id) => document.getElementById(id)
const chat = $("chat")
const estado = { sessionId: null, clave: "", ocupado: false }

const guardar = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch {} }
const leer = (k) => { try { return localStorage.getItem(k) } catch { return null } }

function markdown(texto) {
  if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(texto ?? ""))
  const div = document.createElement("div"); div.textContent = texto ?? ""; return div.innerHTML
}

function agregar(clase, html, esTexto = false) {
  const el = document.createElement("div")
  el.className = `msg ${clase}`
  if (esTexto) el.textContent = html; else el.innerHTML = html
  chat.appendChild(el)
  el.scrollIntoView({ behavior: "smooth", block: "end" })
  return el
}

function herramienta(t) {
  const d = document.createElement("details")
  d.className = "herr"
  const s = document.createElement("summary")
  const marca = document.createElement("span")
  const espera = !t.ok && String(t.resumen).startsWith("[pendiente_confirmacion]")
  marca.className = t.compuerta || espera ? "gate" : t.ok ? "ok" : "ko"
  marca.textContent = t.compuerta ? "⏸ compuerta" : espera ? "⏸ espera confirmación" : t.ok ? "✔" : "✘"
  const n = document.createElement("span"); n.className = "n"; n.textContent = `🔧 ${t.nombre}`
  const r = document.createElement("span"); r.className = "r"; r.textContent = t.resumen
  s.append(marca, n, r)
  const pre = document.createElement("pre")
  pre.textContent = `argumentos: ${JSON.stringify(t.argumentos, null, 2)}`
  d.append(s, pre)
  chat.appendChild(d)
}

function mostrarConfirmacion(activa, pendientes = []) {
  $("confirmacion").hidden = !activa
  $("pendientes").textContent = activa ? `Casos pendientes: ${pendientes.join(", ")}` : ""
}

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, { ...opciones, headers: { "content-type": "application/json", ...(estado.clave ? { "x-access-key": estado.clave } : {}) } })
  const cuerpo = await res.json().catch(() => ({ error: "Respuesta no válida del servidor." }))
  if (res.status === 401) { estado.clave = ""; guardar("oc-clave", null) }
  if (!res.ok) throw new Error(cuerpo.error || `Error HTTP ${res.status}`)
  return cuerpo
}

async function enviar(texto) {
  if (estado.ocupado || !texto.trim()) return
  estado.ocupado = true
  $("enviar").disabled = true
  agregar("usuario", texto, true)
  const pensando = agregar("pensando", "El agente está pensando y llamando herramientas…", true)
  try {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ sessionId: estado.sessionId ?? undefined, message: texto }) })
    estado.sessionId = r.sessionId
    guardar("oc-sesion", r.sessionId)
    pensando.remove()
    r.toolCalls.forEach(herramienta)
    agregar(`agente${r.needsConfirmation ? " espera" : ""}`, markdown(r.reply))
    mostrarConfirmacion(r.needsConfirmation, r.pendientes)
  } catch (e) {
    pensando.remove()
    agregar("error", `⚠️ ${e.message}`, true)
  } finally {
    estado.ocupado = false
    $("enviar").disabled = false
  }
}

async function restaurar(id) {
  try {
    const s = await api(`/api/sessions/${encodeURIComponent(id)}`)
    estado.sessionId = s.id
    for (const ev of s.eventos) {
      if (ev.tipo === "usuario") agregar("usuario", ev.texto, true)
      if (ev.tipo === "herramienta") herramienta(ev)
      if (ev.tipo === "agente") agregar(`agente${ev.necesitaConfirmacion ? " espera" : ""}`, markdown(ev.texto))
      if (ev.tipo === "error") agregar("error", `⚠️ ${ev.texto}`, true)
    }
    mostrarConfirmacion(s.pendientes.length > 0, s.pendientes)
  } catch { guardar("oc-sesion", null) }
}

async function iniciar() {
  estado.clave = leer("oc-clave") ?? ""
  try {
    const h = await api("/api/health")
    $("modelo").textContent = h.llm_configurado ? `${h.provider} · ${h.model}` : `${h.provider} · sin clave configurada`
    if (h.requiere_clave_acceso && !estado.clave) {
      estado.clave = prompt("Este agente está protegido. Ingresa la clave de acceso:") ?? ""
      guardar("oc-clave", estado.clave)
    }
  } catch { $("modelo").textContent = "servidor no disponible" }
  $("atajos").innerHTML = ""
  ;["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"].forEach((c) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "sec"; b.textContent = `Procesar ${c}`
    b.onclick = () => enviar(`Procesa la solicitud "${c}".`)
    $("atajos").appendChild(b)
  })
  const previa = leer("oc-sesion")
  if (previa) await restaurar(previa)
  if (!chat.children.length) agregar("agente", markdown("Hola. Dime qué solicitud procesar, por ejemplo **sol-001**. Te mostraré la OC tal como quedaría en SAP, las validaciones RC1–RC10 y te pediré confirmación cuando haya excepciones."))
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); const t = $("mensaje").value; $("mensaje").value = ""; enviar(t) })
$("mensaje").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit() } })
$("si").onclick = () => enviar("Sí, confirmo. Procede a crear la OC.")
$("no").onclick = () => enviar("No, no la crees por ahora.")
$("nueva").onclick = () => { guardar("oc-sesion", null); estado.sessionId = null; chat.innerHTML = ""; mostrarConfirmacion(false); iniciar() }
iniciar()
