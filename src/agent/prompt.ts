// Ensambla el system prompt: comportamiento (agent/prompt.md) + conocimiento (src/knowledge/*.md).
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const RUTA_PROMPT = join("agent", "prompt.md")
export const RUTA_CONOCIMIENTO = join("src", "knowledge", "ordenes-compra.md")

export async function cargarSistema(directory: string): Promise<string> {
  const [comportamiento, conocimiento] = await Promise.all([
    readFile(join(directory, RUTA_PROMPT), "utf8"),
    readFile(join(directory, RUTA_CONOCIMIENTO), "utf8"),
  ])
  return `${comportamiento.trim()}\n\n---\n\n# Conocimiento del proceso (referencia)\n\n${conocimiento.trim()}\n`
}
