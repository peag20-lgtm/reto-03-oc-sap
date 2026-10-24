// Implementación de ProveedorLLM para Chat Completions de OpenAI (o cualquier endpoint compatible: Azure, local).
// Existe para demostrar que cambiar de proveedor no toca el ciclo del agente.
import { z } from "zod"
import { clasificarError, type DefinicionHerramienta, ErrorLLM, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "./adapter"

type MensajeApi =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string }

const RespuestaApi = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable().optional(),
        tool_calls: z.array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
      }),
    }),
  ).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
})

export function aFormatoOpenAI(mensajes: Mensaje[]): MensajeApi[] {
  return mensajes.map((m): MensajeApi => {
    if (m.rol === "sistema") return { role: "system", content: m.texto }
    if (m.rol === "usuario") return { role: "user", content: m.texto }
    if (m.rol === "herramienta") return { role: "tool", tool_call_id: m.llamadaId, content: m.resultado }
    return {
      role: "assistant",
      content: m.texto || null,
      ...(m.llamadas.length > 0
        ? { tool_calls: m.llamadas.map((l) => ({ id: l.id, type: "function" as const, function: { name: l.nombre, arguments: JSON.stringify(l.argumentos) } })) }
        : {}),
    }
  })
}

function parsearArgumentos(texto: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(texto)
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export class ProveedorOpenAI implements ProveedorLLM {
  readonly nombre = "openai"
  constructor(
    readonly modelo: string,
    private readonly clave: string,
    private readonly opciones: { timeoutMs: number; maxTokens: number; baseUrl: string },
  ) {
    if (!clave) throw new ErrorLLM("configuracion", "Falta OPENAI_API_KEY en el entorno del servidor.")
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[]): Promise<RespuestaLLM> {
    let res: Response
    try {
      res = await fetch(`${this.opciones.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(this.opciones.timeoutMs),
        headers: { "content-type": "application/json", authorization: `Bearer ${this.clave}` },
        body: JSON.stringify({
          model: this.modelo,
          max_completion_tokens: this.opciones.maxTokens,
          messages: aFormatoOpenAI(mensajes),
          tools: herramientas.map((h) => ({ type: "function", function: { name: h.nombre, description: h.descripcion, parameters: h.parametros } })),
        }),
      })
    } catch (e) {
      throw clasificarError(null, e)
    }
    if (!res.ok) throw clasificarError(res.status)
    const cuerpo = RespuestaApi.safeParse(await res.json().catch(() => null))
    if (!cuerpo.success) throw new ErrorLLM("proveedor", "Respuesta del modelo con formato inesperado.")
    const msg = cuerpo.data.choices[0]?.message
    return {
      texto: msg?.content ?? "",
      llamadas: (msg?.tool_calls ?? []).map((t) => ({ id: t.id, nombre: t.function.name, argumentos: parsearArgumentos(t.function.arguments) })),
      uso: { entrada: cuerpo.data.usage?.prompt_tokens ?? 0, salida: cuerpo.data.usage?.completion_tokens ?? 0 },
    }
  }
}
