// Contrato de herramientas (PRD 6.2): { description, args (zod), execute(args, ctx) → string JSON }.
import type { z } from "zod"

export type ContextoHerramienta = { directory: string; sessionId: string }

export type Herramienta<S extends z.ZodRawShape> = {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: ContextoHerramienta): Promise<string>
}

/** Identidad tipada: conserva la inferencia de `args` dentro de `execute`. */
export function definir<S extends z.ZodRawShape>(h: Herramienta<S>): Herramienta<S> {
  return h
}

/** Garantiza que execute nunca lance: cualquier excepción se vuelve { ok: false, error }. */
export async function seguro(fn: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await fn())
  } catch (e) {
    return JSON.stringify({ ok: false, error: `Error interno de la herramienta: ${e instanceof Error ? e.message : String(e)}` })
  }
}
