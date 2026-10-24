// Utilidades puras y de archivos compartidas por el dominio. Ninguna función lanza hacia afuera.
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import type { z } from "zod"

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }
export const ok = <T>(data: T): Resultado<T> => ({ ok: true, data })
export const fallo = <T = never>(error: string): Resultado<T> => ({ ok: false, error })

export const RUTA_SOLICITUDES = ["fixtures", "reto-03", "solicitudes"] as const
export const RUTA_MAESTROS = ["fixtures", "reto-03", "maestros"] as const

/** Nombre de caso seguro: evita path traversal (../, rutas absolutas). */
export const PATRON_CASO = /^[a-z0-9][a-z0-9_-]{0,63}$/i

export function rutaCaso(directory: string, caso: string): Resultado<string> {
  if (!PATRON_CASO.test(caso)) return fallo(`Nombre de caso inválido: "${caso}". Use el nombre de la carpeta, p. ej. "sol-001".`)
  const base = resolve(directory, ...RUTA_SOLICITUDES)
  const ruta = resolve(base, caso)
  if (!ruta.startsWith(base + sep)) return fallo("Ruta de caso fuera de los fixtures.")
  return ok(ruta)
}

export function rutaSalida(directory: string, ...partes: string[]): string {
  return join(directory, "out", ...partes)
}

/** Lee y valida un JSON. Distingue "no existe" de "malformado" de "no cumple esquema". */
export async function leerJson<T>(
  ruta: string,
  esquema: z.ZodType<T>,
  etiqueta: string,
): Promise<Resultado<T> & { noExiste?: boolean }> {
  let texto: string
  try {
    texto = await readFile(ruta, "utf8")
  } catch {
    return { ok: false, error: `No se encontró ${etiqueta}.`, noExiste: true }
  }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return fallo(`${etiqueta} no es un JSON válido (archivo malformado).`)
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
    return fallo(`${etiqueta} tiene datos inválidos → ${detalle}`)
  }
  return ok(r.data)
}

export async function leerTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8")
  } catch {
    return null
  }
}

/** "900.555.111-2" → "900555111" (sin dígito de verificación). */
export function normalizarNit(nit: string): string {
  const sinDv = nit.includes("-") ? nit.slice(0, nit.indexOf("-")) : nit
  return sinDv.replace(/\D/g, "")
}

/** Minúsculas, sin tildes ni puntuación: "TecnoSuministros S.A.S." → "tecnosuministros s a s". */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** "COP 11.400.000" o "1.234,50" → número. null si no hay dígitos. */
export function parsearMonto(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "")
  if (!/\d/.test(limpio)) return null
  const n = Number(limpio.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(n) ? n : null
}

/** Parte de fecha local (AAAA-MM-DD) de un ISO con zona horaria; el ISO ya viene en hora local. */
export function fechaLocal(iso: string): string {
  return iso.slice(0, 10)
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex")
}

/** JSON con llaves ordenadas: misma entrada → mismo texto → mismo hash. */
export function jsonEstable(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonEstable).join(",")}]`
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${jsonEstable(v)}`).join(",")}}`
  }
  return JSON.stringify(valor)
}

export function formatoCop(n: number): string {
  return n.toLocaleString("es-CO", { maximumFractionDigits: 2 })
}

/** Serializa operaciones de escritura en un mismo proceso (consecutivo SAP, CSV). */
export function crearMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let cola: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const siguiente = cola.then(fn, fn)
    cola = siguiente.catch(() => undefined)
    return siguiente
  }
}
