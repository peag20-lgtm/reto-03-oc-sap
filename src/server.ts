// API HTTP + front estático. El ciclo del agente vive en src/agent/ciclo.ts; aquí solo hay transporte y controles.
import { timingSafeEqual } from "node:crypto"
import { join, normalize, resolve, sep } from "node:path"
import { z } from "zod"
import { ejecutarTurno, type DependenciasAgente } from "./agent/ciclo"
import { cargarSistema } from "./agent/prompt"
import { AlmacenSesiones, PATRON_ID_SESION } from "./agent/sesiones"
import { cargarConfig } from "./config"
import { ErrorLLM } from "./llm/adapter"
import { crearProveedor } from "./llm"

const RAIZ = resolve(import.meta.dir, "..")
const WEB = join(RAIZ, "web")
const config = cargarConfig()
const proveedor = crearProveedor(config)
const sesiones = new AlmacenSesiones(config.MAX_SESIONES)
const deps: DependenciasAgente = {
  proveedor,
  sistema: await cargarSistema(RAIZ),
  directory: RAIZ,
  maxIteraciones: config.MAX_ITERACIONES,
  maxTokensSesion: config.MAX_TOKENS_SESION,
}

const CABECERAS_SEGURIDAD = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json; charset=utf-8", ...CABECERAS_SEGURIDAD } })

function autorizado(req: Request): boolean {
  if (!config.APP_ACCESS_KEY) return true
  const dada = Buffer.from(req.headers.get("x-access-key") ?? "")
  const esperada = Buffer.from(config.APP_ACCESS_KEY)
  return dada.length === esperada.length && timingSafeEqual(dada, esperada)
}

const CuerpoChat = z.object({
  sessionId: z.string().regex(PATRON_ID_SESION).optional(),
  message: z.string().trim().min(1).max(config.MAX_LARGO_MENSAJE),
})

async function chat(req: Request): Promise<Response> {
  const cuerpo = CuerpoChat.safeParse(await req.json().catch(() => null))
  if (!cuerpo.success) return json({ error: `Solicitud inválida: se espera { sessionId?, message } con mensaje de 1 a ${config.MAX_LARGO_MENSAJE} caracteres.` }, 400)
  const sesion = sesiones.obtenerOCrear(cuerpo.data.sessionId)
  if (sesion.ocupada) return json({ error: "La sesión está procesando otro mensaje. Espera la respuesta." }, 409)
  sesion.ocupada = true
  try {
    return json(await ejecutarTurno(deps, sesion, cuerpo.data.message))
  } finally {
    sesion.ocupada = false
  }
}

async function estatico(pathname: string): Promise<Response> {
  const relativo = normalize(pathname === "/" ? "index.html" : pathname.slice(1))
  const ruta = resolve(WEB, relativo)
  if (!ruta.startsWith(WEB + sep)) return new Response("No encontrado", { status: 404 })
  const archivo = Bun.file(ruta)
  return (await archivo.exists()) ? new Response(archivo, { headers: CABECERAS_SEGURIDAD }) : new Response("No encontrado", { status: 404 })
}

const servidor = Bun.serve({
  port: config.PORT,
  idleTimeout: 120, // los turnos con varias herramientas pueden tardar
  async fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname === "/api/health") {
      return json({ ok: true, provider: config.LLM_PROVIDER, model: config.modelo, llm_configurado: !(proveedor instanceof ErrorLLM), requiere_clave_acceso: Boolean(config.APP_ACCESS_KEY) })
    }
    if (pathname.startsWith("/api/") && !autorizado(req)) return json({ error: "Clave de acceso inválida." }, 401)
    if (pathname === "/api/chat" && req.method === "POST") return chat(req)
    const m = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (m && req.method === "GET") {
      const s = m[1] ? sesiones.obtener(m[1]) : undefined
      return s ? json({ id: s.id, eventos: s.eventos, pendientes: [...s.pendientes], tokens: s.tokens }) : json({ error: "Sesión no encontrada." }, 404)
    }
    if (pathname.startsWith("/api/")) return json({ error: "Ruta no encontrada." }, 404)
    return estatico(pathname)
  },
})

console.log(`Agente OC listo en http://localhost:${servidor.port} · proveedor=${config.LLM_PROVIDER} modelo=${config.modelo}${proveedor instanceof ErrorLLM ? ` · ⚠️ ${proveedor.message}` : ""}`)
