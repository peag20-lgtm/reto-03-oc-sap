// Interfaz propia del proveedor LLM. El ciclo del agente solo conoce estos tipos:
// cambiar de proveedor = otra implementación de ProveedorLLM, sin tocar el ciclo.

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: Record<string, unknown> }

export type Mensaje =
  | { rol: "sistema"; texto: string }
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[] }
  | { rol: "herramienta"; llamadaId: string; nombre: string; resultado: string }

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  parametros: Record<string, unknown> // JSON Schema generado desde zod
}

export type RespuestaLLM = {
  texto: string
  llamadas: LlamadaHerramienta[]
  uso: { entrada: number; salida: number }
}

export type TipoErrorLLM = "configuracion" | "autenticacion" | "limite" | "timeout" | "proveedor"

export class ErrorLLM extends Error {
  constructor(
    readonly tipo: TipoErrorLLM,
    message: string,
  ) {
    super(message)
  }
}

export interface ProveedorLLM {
  readonly nombre: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM>
}

/** Traduce errores HTTP/red a mensajes claros sin filtrar cabeceras ni claves. */
export function clasificarError(estado: number | null, e?: unknown): ErrorLLM {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new ErrorLLM("timeout", "El modelo no respondió a tiempo. Intenta de nuevo en unos segundos.")
  }
  if (estado === 401 || estado === 403) return new ErrorLLM("autenticacion", "El proveedor del modelo rechazó la credencial configurada en el servidor.")
  if (estado === 429) return new ErrorLLM("limite", "El proveedor del modelo aplicó límite de uso. Espera un momento y reintenta.")
  if (estado !== null) return new ErrorLLM("proveedor", `El proveedor del modelo respondió con error HTTP ${estado}.`)
  return new ErrorLLM("proveedor", "No fue posible comunicarse con el proveedor del modelo.")
}
