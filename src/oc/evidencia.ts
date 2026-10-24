// HU-4: evidencia de aprobación. P0 → aprobacion.txt con sha256; P1 → aprobacion.pdf con el mismo contenido.
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PDFDocument, StandardFonts } from "pdf-lib"
import { AprobacionRawSchema, type AprobacionRaw } from "./schemas"
import { fallo, leerJson, ok, type Resultado, rutaCaso, rutaSalida, sha256 } from "./util"

export type Evidencia = { ruta: string; ruta_pdf: string; sha256: string }

/** Contenido canónico: es exactamente lo que se hashea. */
export function contenidoEvidencia(caso: string, a: AprobacionRaw): string {
  return [
    `EVIDENCIA DE APROBACIÓN · caso ${caso}`,
    `De: ${a.de}`,
    `Para: ${a.para}`,
    `CC: ${a.cc.join(", ")}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    "",
    a.cuerpo,
    "",
  ].join("\n")
}

/** pdf-lib con fuentes estándar solo codifica WinAnsi: se reemplaza lo que no cabe. */
function aWinAnsi(texto: string): string {
  return texto.replace(/·/g, "-").replace(/[^\n\x20-\x7e -ÿ]/g, "?")
}

async function generarPdf(contenido: string, hash: string, fecha: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fechaFija = new Date(fecha) // fechas fijas → PDF determinista entre ejecuciones
  pdf.setCreationDate(fechaFija)
  pdf.setModificationDate(fechaFija)
  pdf.setTitle("Evidencia de aprobación")
  const fuente = await pdf.embedFont(StandardFonts.Helvetica)
  const pagina = pdf.addPage([595, 842])
  let y = 800
  const lineas = aWinAnsi(`${contenido}\n---\nsha256 del contenido: ${hash}`).split("\n")
  for (const linea of lineas.flatMap((l) => partir(l, 95))) {
    pagina.drawText(linea, { x: 50, y, size: 10, font: fuente })
    y -= 14
  }
  return pdf.save()
}

function partir(linea: string, ancho: number): string[] {
  if (linea.length <= ancho) return [linea]
  const partes: string[] = []
  for (let i = 0; i < linea.length; i += ancho) partes.push(linea.slice(i, i + ancho))
  return partes
}

export async function generarEvidencia(directory: string, caso: string): Promise<Resultado<Evidencia>> {
  const ruta = rutaCaso(directory, caso)
  if (!ruta.ok) return ruta
  const aprob = await leerJson(join(ruta.data, "aprobacion.json"), AprobacionRawSchema, "la aprobación (aprobacion.json)")
  if (!aprob.ok) return fallo(`${aprob.error} Sin aprobación no hay evidencia que adjuntar.`)

  const contenido = contenidoEvidencia(caso, aprob.data)
  const hash = sha256(contenido)
  const dir = rutaSalida(directory, caso)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "aprobacion.txt"), `${contenido}---\nsha256: ${hash}\n`, "utf8")
    await writeFile(join(dir, "aprobacion.pdf"), await generarPdf(contenido, hash, aprob.data.fecha))
  } catch (e) {
    return fallo(`No se pudo escribir la evidencia: ${e instanceof Error ? e.message : String(e)}`)
  }
  return ok({ ruta: `out/${caso}/aprobacion.txt`, ruta_pdf: `out/${caso}/aprobacion.pdf`, sha256: hash })
}
