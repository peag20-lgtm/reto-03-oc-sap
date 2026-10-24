// HU-1: lee los archivos de un caso y los normaliza al Paquete de la sección 7.2.
import { join } from "node:path"
import {
  AprobacionRawSchema,
  CorreoSchema,
  type Paquete,
  SolicitudSchema,
} from "./schemas"
import {
  fallo,
  leerJson,
  leerTexto,
  ok,
  parsearMonto,
  type Resultado,
  rutaCaso,
  sumarDias,
} from "./util"

type Cotizacion = NonNullable<Paquete["cotizacion"]>
type Factura = NonNullable<Paquete["factura"]>

function campo(texto: string, patron: RegExp): string | null {
  const m = texto.match(patron)
  return m?.[1]?.trim() ?? null
}

export function parsearCotizacion(texto: string): Cotizacion | null {
  const totalTxt = campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/im)
  const total = totalTxt ? parsearMonto(totalTxt) : null
  const proveedor = campo(texto, /^Proveedor:\s*(.+)$/im)
  if (total === null || proveedor === null) return null
  const fecha = campo(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/im)
  const dias = campo(texto, /^Validez[^:\n]*:\s*(\d+)\s*d[ií]as/im)
  return {
    numero: campo(texto, /^COTIZACI[OÓ]N\s+(\S+)/im),
    fecha,
    proveedor,
    nit: campo(texto, /^NIT:\s*([\d.\-]+)/im),
    total,
    moneda: campo(totalTxt ?? "", /\b(COP|USD)\b/) ?? "COP",
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

export function parsearFactura(texto: string): Factura | null {
  const numero = campo(texto, /No\.\s*([A-Z0-9-]+)/i)
  const fecha = campo(texto, /Fecha[^:\n]*:\s*(\d{4}-\d{2}-\d{2})/i)
  const totalTxt = campo(texto, /^TOTAL[^:\n]*:\s*(.+)$/im)
  const total = totalTxt ? parsearMonto(totalTxt) : null
  if (!numero || !fecha || total === null) return null
  return { numero, fecha, total }
}

/** "Aprobado" presente y no negado ("no aprobado", "no está aprobado"). */
export function contieneAprobado(cuerpo: string): boolean {
  if (/\bno\s+(est[aá]\s+)?aprobad[oa]\b/i.test(cuerpo)) return false
  return /\baprobad[oa]\b/i.test(cuerpo)
}

export async function leerPaquete(directory: string, caso: string): Promise<Resultado<Paquete>> {
  const ruta = rutaCaso(directory, caso)
  if (!ruta.ok) return ruta
  const dir = ruta.data

  const correo = await leerJson(join(dir, "correo.json"), CorreoSchema, "el correo (correo.json)")
  if (!correo.ok) {
    return fallo(correo.noExiste ? `El caso "${caso}" no existe o no tiene correo.json.` : correo.error)
  }
  const solicitud = await leerJson(join(dir, "solicitud.json"), SolicitudSchema, "la solicitud (solicitud.xlsx → solicitud.json)")
  if (!solicitud.ok) {
    return fallo(`${solicitud.error} Acción: pedir al solicitante que reenvíe el Excel de solicitud corregido.`)
  }

  const faltantes: string[] = []

  const cotTexto = await leerTexto(join(dir, "cotizacion.txt"))
  const cotizacion = cotTexto === null ? null : parsearCotizacion(cotTexto)
  if (cotTexto === null) faltantes.push("cotizacion (cotizacion.pdf)")
  else if (cotizacion === null) faltantes.push("cotizacion ilegible (no se encontró proveedor o TOTAL)")

  const aprobRaw = await leerJson(join(dir, "aprobacion.json"), AprobacionRawSchema, "la aprobación")
  const aprobacion = aprobRaw.ok
    ? { de: aprobRaw.data.de, fecha: aprobRaw.data.fecha, aprobado: contieneAprobado(aprobRaw.data.cuerpo), texto: aprobRaw.data.cuerpo }
    : null
  if (!aprobRaw.ok) faltantes.push(aprobRaw.noExiste ? "aprobacion (aprobacion.eml)" : aprobRaw.error)

  const facTexto = await leerTexto(join(dir, "factura.txt"))
  const factura = facTexto === null ? null : parsearFactura(facTexto)
  const facturaAnunciada = correo.data.adjuntos.some((a) => a.toLowerCase().startsWith("factura"))
  if (facTexto === null && facturaAnunciada) faltantes.push("factura (anunciada en el correo, no adjunta)")
  if (facTexto !== null && factura === null) faltantes.push("factura ilegible")

  return ok({
    correo: { id: correo.data.id, de: correo.data.de, asunto: correo.data.asunto, fecha: correo.data.fecha },
    solicitud: solicitud.data,
    cotizacion,
    aprobacion,
    factura,
    faltantes,
  })
}
