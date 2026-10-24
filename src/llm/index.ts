// Fábrica: elige la implementación según LLM_PROVIDER. Único punto que conoce a los proveedores concretos.
import type { Config } from "../config"
import { ErrorLLM, type ProveedorLLM } from "./adapter"
import { ProveedorAnthropic } from "./anthropic"
import { ProveedorOpenAI } from "./openai"

export function crearProveedor(c: Config): ProveedorLLM | ErrorLLM {
  const opciones = { timeoutMs: c.LLM_TIMEOUT_MS, maxTokens: c.MAX_TOKENS_RESPUESTA }
  try {
    if (c.LLM_PROVIDER === "openai") {
      return new ProveedorOpenAI(c.modelo, c.OPENAI_API_KEY, { ...opciones, baseUrl: c.OPENAI_BASE_URL || "https://api.openai.com/v1" })
    }
    return new ProveedorAnthropic(c.modelo, c.ANTHROPIC_API_KEY, opciones)
  } catch (e) {
    return e instanceof ErrorLLM ? e : new ErrorLLM("configuracion", "No se pudo inicializar el proveedor del modelo.")
  }
}
