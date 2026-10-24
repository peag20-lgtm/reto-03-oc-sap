// out/log.jsonl: toda llamada a herramienta y todo error del proveedor (CA4). Con redacción defensiva de secretos.
import { appendFile, mkdir } from "node:fs/promises"
import { rutaSalida } from "../oc/util"

const PATRONES_SECRETO = [/sk-[A-Za-z0-9_-]{10,}/g, /(api[_-]?key|authorization|x-api-key)["':=\s]+[^\s",}]+/gi]

export function redactar(texto: string): string {
  return PATRONES_SECRETO.reduce((t, p) => t.replace(p, "[REDACTADO]"), texto)
}

export async function registrarLog(directory: string, entrada: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(rutaSalida(directory), { recursive: true })
    await appendFile(rutaSalida(directory, "log.jsonl"), `${redactar(JSON.stringify({ ts: new Date().toISOString(), ...entrada }))}\n`, "utf8")
  } catch {
    // el log nunca debe tumbar la sesión
  }
}
