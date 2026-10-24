// Implementación de ProveedorLLM para la API Messages de Anthropic (fetch directo, sin SDK).
import { z } from "zod"
import { clasificarError, type DefinicionHerramienta, ErrorLLM, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "./adapter"

type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string }
type MensajeApi = { role: "user" | "assistant"; content: Bloque[] }

const RespuestaApi = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).loose(),
})

/** Convierte el historial neutro al formato Anthropic; une turnos consecutivos del mismo rol. */
export function aFormatoAnthropic(mensajes: Mensaje[]): { system: string; messages: MensajeApi[] } {
  const system = mensajes.filter((m) => m.rol === "sistema").map((m) => m.texto).join("\n\n")
  const messages: MensajeApi[] = []
  const agregar = (role: MensajeApi["role"], bloques: Bloque[]) => {
    const ultimo = messages.at(-1)
    if (ultimo && ultimo.role === role) ultimo.content.push(...bloques)
    else messages.push({ role, content: bloques })
  }
  for (const m of mensajes) {
    if (m.rol === "usuario") agregar("user", [{ type: "text", text: m.texto }])
    if (m.rol === "herramienta") agregar("user", [{ type: "tool_result", tool_use_id: m.llamadaId, content: m.resultado }])
    if (m.rol === "asistente") {
      const bloques: Bloque[] = m.texto ? [{ type: "text", text: m.texto }] : []
      for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos })
      if (bloques.length > 0) agregar("assistant", bloques)
    }
  }
  return { system, messages }
}

export class ProveedorAnthropic implements ProveedorLLM {
  readonly nombre = "anthropic"
  constructor(
    readonly modelo: string,
    private readonly clave: string,
    private readonly opciones: { timeoutMs: number; maxTokens: number },
  ) {
    if (!clave) throw new ErrorLLM("configuracion", "Falta ANTHROPIC_API_KEY en el entorno del servidor.")
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    const { system, messages } = aFormatoAnthropic(mensajes)
    let res: Response
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(this.opciones.timeoutMs),
        headers: { "content-type": "application/json", "x-api-key": this.clave, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: this.modelo,
          max_tokens: this.opciones.maxTokens,
          // prompt caching del system prompt: abarata los turnos siguientes de la sesión
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages,
          tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.parametros })),
        }),
      })
    } catch (e) {
      throw clasificarError(null, e)
    }
    if (!res.ok) throw clasificarError(res.status)
    const cuerpo = RespuestaApi.safeParse(await res.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorLLM("proveedor", "Respuesta del modelo con formato inesperado.")

    const r: RespuestaLLM = { texto: "", llamadas: [], uso: { entrada: cuerpo.data.usage.input_tokens, salida: cuerpo.data.usage.output_tokens } }
    for (const b of cuerpo.data.content) {
      if (b.type === "text" && b.text) r.texto += b.text
      if (b.type === "tool_use" && b.id && b.name) r.llamadas.push({ id: b.id, nombre: b.name, argumentos: b.input ?? {} })
    }
    return r
  }
}
