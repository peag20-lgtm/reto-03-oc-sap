// Sesiones en memoria con tope de cantidad (se descarta la menos reciente).
import type { Mensaje } from "../llm/adapter"

export type VistaLlamada = {
  nombre: string
  argumentos: Record<string, unknown>
  ok: boolean
  resumen: string
  compuerta: boolean // true si el control de confirmación humana detuvo la llamada
}

export type Evento =
  | { tipo: "usuario"; texto: string; ts: string }
  | { tipo: "agente"; texto: string; necesitaConfirmacion: boolean; ts: string }
  | ({ tipo: "herramienta"; ts: string } & VistaLlamada)
  | { tipo: "error"; texto: string; ts: string }

export type Sesion = {
  id: string
  mensajes: Mensaje[] // historial que ve el modelo
  eventos: Evento[] // historial que ve el usuario
  tokens: number
  pendientes: Set<string> // casos esperando confirmación humana
  confirmadosTurno: Set<string> // casos que el usuario confirmó en su ÚLTIMO mensaje
  ocupada: boolean
  actualizada: number
}

export const PATRON_ID_SESION = /^[a-zA-Z0-9-]{8,64}$/

export class AlmacenSesiones {
  private readonly sesiones = new Map<string, Sesion>()
  constructor(private readonly maximo: number) {}

  obtener(id: string): Sesion | undefined {
    return this.sesiones.get(id)
  }

  obtenerOCrear(id?: string): Sesion {
    const existente = id ? this.sesiones.get(id) : undefined
    if (existente) return existente
    if (this.sesiones.size >= this.maximo) {
      const masVieja = [...this.sesiones.values()].sort((a, b) => a.actualizada - b.actualizada)[0]
      if (masVieja) this.sesiones.delete(masVieja.id)
    }
    const nueva: Sesion = {
      id: id && PATRON_ID_SESION.test(id) ? id : crypto.randomUUID(),
      mensajes: [], eventos: [], tokens: 0,
      pendientes: new Set(), confirmadosTurno: new Set(),
      ocupada: false, actualizada: Date.now(),
    }
    this.sesiones.set(nueva.id, nueva)
    return nueva
  }
}
