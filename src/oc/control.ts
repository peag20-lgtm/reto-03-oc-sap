// Log de control para Contabilidad/Auditoría: una fila por intento de creación (out/control.csv).
import { appendFile, mkdir, stat } from "node:fs/promises"
import { crearMutex, rutaSalida } from "./util"

export type ResultadoControl = "creada" | "existente" | "bloqueada" | "pendiente_confirmacion" | "rechazada_integridad" | "error"
export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoControl
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
}

const ENCABEZADO = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"
const exclusivo = crearMutex()

/** Escapa para CSV y neutraliza inyección de fórmulas al abrir en Excel (=, +, -, @). */
function celda(valor: string): string {
  const seguro = /^[=+\-@]/.test(valor) ? `'${valor}` : valor
  return /[",\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

export async function registrarControl(directory: string, fila: FilaControl): Promise<void> {
  const linea = [
    fila.solicitud_id,
    fila.resultado,
    fila.numero_oc ?? "",
    String(fila.retroactiva),
    fila.bloqueos.join("|"),
    fila.confirmaciones.join("|"),
    new Date().toISOString(),
  ].map(celda).join(",")
  await exclusivo(async () => {
    const archivo = rutaSalida(directory, "control.csv")
    await mkdir(rutaSalida(directory), { recursive: true })
    const existe = await stat(archivo).then(() => true, () => false)
    await appendFile(archivo, `${existe ? "" : ENCABEZADO}${linea}\n`, "utf8")
  })
}
