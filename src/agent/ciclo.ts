// Ciclo del agente: prompt → modelo → herramientas → modelo … hasta respuesta final o tope (CA1–CA5).
import { ErrorLLM, type LlamadaHerramienta, type ProveedorLLM } from "../llm/adapter"
import { casosConfirmados } from "./confirmacion"
import { registrarLog } from "./log"
import { HERRAMIENTAS, POR_NOMBRE } from "./registro"
import { resumir } from "./resumen"
import type { Sesion, VistaLlamada } from "./sesiones"

export type DependenciasAgente = {
  proveedor: ProveedorLLM | ErrorLLM // ErrorLLM si no hay clave: el servidor arranca igual y lo informa en el chat
  sistema: string
  directory: string
  maxIteraciones: number
  maxTokensSesion: number
}

export type RespuestaTurno = {
  sessionId: string
  reply: string
  toolCalls: VistaLlamada[]
  needsConfirmation: boolean
  pendientes: string[]
  tokens: { sesion: number; limite: number }
}

const ahora = () => new Date().toISOString()

function casoDe(argumentos: Record<string, unknown>): string {
  return typeof argumentos.caso === "string" ? argumentos.caso.toLowerCase() : ""
}

/** Compuerta de confirmación humana: oc_crear con confirmado=true solo pasa si el usuario lo confirmó en ESTE turno. */
function compuerta(s: Sesion, l: LlamadaHerramienta): string | null {
  if (l.nombre !== "oc_crear" || l.argumentos.confirmado !== true) return null
  if (s.confirmadosTurno.has(casoDe(l.argumentos))) return null
  return JSON.stringify({
    ok: false,
    estado: "pendiente_confirmacion",
    error: "CONTROL DE CONFIRMACIÓN HUMANA: el usuario no confirmó este caso en su último mensaje. No reintentes: termina el turno mostrando las excepciones y preguntando explícitamente si confirma.",
  })
}

/** Actualiza qué casos esperan confirmación según lo que devolvieron las herramientas. */
function actualizarPendientes(s: Sesion, nombre: string, caso: string, resultado: string): void {
  let r: { ok?: boolean; estado?: string; data?: { apta?: boolean; confirmaciones?: unknown[] } }
  try {
    r = JSON.parse(resultado)
  } catch {
    return
  }
  if (nombre === "oc_validar" && r.ok && r.data?.apta && (r.data.confirmaciones?.length ?? 0) > 0) s.pendientes.add(caso)
  if (nombre === "oc_crear") {
    if (r.estado === "pendiente_confirmacion") s.pendientes.add(caso)
    else s.pendientes.delete(caso) // creada, existente o bloqueada: ya no espera confirmación
  }
}

async function ejecutarLlamada(deps: DependenciasAgente, s: Sesion, l: LlamadaHerramienta): Promise<{ resultado: string; vista: VistaLlamada }> {
  const inicio = Date.now()
  const detenida = compuerta(s, l)
  const herramienta = POR_NOMBRE.get(l.nombre)
  const resultado =
    detenida ??
    (herramienta
      ? await herramienta.ejecutar(l.argumentos, { directory: deps.directory, sessionId: s.id })
      : JSON.stringify({ ok: false, error: `Herramienta desconocida: ${l.nombre}` }))
  const caso = casoDe(l.argumentos)
  actualizarPendientes(s, l.nombre, caso, resultado)
  const { ok, resumen } = resumir(l.nombre, resultado)
  const vista: VistaLlamada = { nombre: l.nombre, argumentos: l.argumentos, ok, resumen, compuerta: detenida !== null }
  await registrarLog(deps.directory, { sessionId: s.id, tipo: "herramienta", herramienta: l.nombre, argumentos: l.argumentos, ok, compuerta: vista.compuerta, ms: Date.now() - inicio, resultado: JSON.parse(resultado) as unknown })
  return { resultado, vista }
}

export async function ejecutarTurno(deps: DependenciasAgente, s: Sesion, texto: string): Promise<RespuestaTurno> {
  s.actualizada = Date.now()
  s.confirmadosTurno = casosConfirmados(texto, s.pendientes)
  s.mensajes.push({ rol: "usuario", texto })
  s.eventos.push({ tipo: "usuario", texto, ts: ahora() })
  const llamadas: VistaLlamada[] = []
  let reply = ""

  try {
    if (deps.proveedor instanceof ErrorLLM) throw deps.proveedor
    const proveedor = deps.proveedor
    for (let i = 0; i < deps.maxIteraciones; i++) {
      if (s.tokens >= deps.maxTokensSesion) {
        reply = `Se alcanzó el tope de tokens de esta sesión (${deps.maxTokensSesion.toLocaleString("es-CO")}). Abre una sesión nueva para continuar.`
        break
      }
      const r = await proveedor.enviar([{ rol: "sistema", texto: deps.sistema }, ...s.mensajes], HERRAMIENTAS)
      s.tokens += r.uso.entrada + r.uso.salida
      s.mensajes.push({ rol: "asistente", texto: r.texto, llamadas: r.llamadas })
      if (r.llamadas.length === 0) {
        reply = r.texto
        break
      }
      if (r.texto) reply = r.texto
      for (const l of r.llamadas) {
        const { resultado, vista } = await ejecutarLlamada(deps, s, l)
        s.mensajes.push({ rol: "herramienta", llamadaId: l.id, nombre: l.nombre, resultado })
        s.eventos.push({ tipo: "herramienta", ts: ahora(), ...vista })
        llamadas.push(vista)
      }
      if (i === deps.maxIteraciones - 1) {
        reply = `Alcancé el tope de ${deps.maxIteraciones} iteraciones en este turno. Lo hecho está en las llamadas a herramientas de arriba; pídeme continuar para completar lo que falta.`
      }
    }
  } catch (e) {
    const msg = e instanceof ErrorLLM ? e.message : "Ocurrió un error inesperado al procesar el turno."
    reply = `⚠️ ${msg} La sesión sigue activa: puedes reintentar.`
    s.eventos.push({ tipo: "error", texto: msg, ts: ahora() })
    await registrarLog(deps.directory, { sessionId: s.id, tipo: "error_llm", detalle: msg })
  } finally {
    s.confirmadosTurno = new Set() // una confirmación vale solo para el turno en que se dio
  }

  const needsConfirmation = s.pendientes.size > 0
  s.eventos.push({ tipo: "agente", texto: reply, necesitaConfirmacion: needsConfirmation, ts: ahora() })
  return { sessionId: s.id, reply, toolCalls: llamadas, needsConfirmation, pendientes: [...s.pendientes], tokens: { sesion: s.tokens, limite: deps.maxTokensSesion } }
}
