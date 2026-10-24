// HU-3: construye la OrdenCompra (PRD 7.4) y la trazabilidad campo → fuente.
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Validacion } from "./reglas"
import { type OrdenCompra, OrdenCompraSchema, type Paquete } from "./schemas"
import { fallo, ok, type Resultado, rutaSalida } from "./util"

export type Fuente = "solicitud" | "cotizacion" | "correo" | "aprobacion" | "evidencia" | `maestro.${string}` | "derivado"
export type Traza = { campo: string; valor: string | number | null; fuente: Fuente; detalle?: string }

export const LARGO_TEXTO_BREVE = 40 // límite SAP del texto breve de posición

/** Unidad de medida a partir del texto del ítem: horas → H, mensualidad → MES, resto → UN. */
export function derivarUnidad(texto: string): "UN" | "H" | "MES" {
  if (/\bhoras?\b/i.test(texto)) return "H"
  if (/\b(mensualidad|por mes|mensual)\b/i.test(texto)) return "MES"
  return "UN"
}

export function textoBreve(descripcion: string): string {
  const limpio = descripcion.replace(/\s+/g, " ").trim()
  return limpio.length <= LARGO_TEXTO_BREVE ? limpio : `${limpio.slice(0, LARGO_TEXTO_BREVE - 1).trimEnd()}…`
}

export function construirOrden(
  p: Paquete,
  v: Validacion,
  evidenciaSha: string,
  confirmadoPor: string | null,
): Resultado<{ orden: OrdenCompra; trazabilidad: Traza[] }> {
  if (!v.apta) return fallo(`La solicitud no es apta: ${v.bloqueos.map((b) => b.codigo).join(", ")}. No se construye payload.`)
  const prov = v.derivados.proveedor
  const aprob = p.aprobacion
  if (!prov || !aprob) return fallo("Faltan proveedor o aprobación validados.")

  const s = p.solicitud
  const iva = s.indicador_iva ?? v.derivados.indicador_iva?.valor
  const pago = s.condiciones_pago ?? v.derivados.condiciones_pago?.valor
  if (!iva || !pago) return fallo("No fue posible determinar IVA o condiciones de pago.")

  const textoUnidad = `${s.descripcion} ${p.cotizacion?.texto.match(/^1\.\s*(.+)$/m)?.[1] ?? ""}`
  const orden: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.numero ?? null },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: { codigo_sap: prov.codigo_sap, nit: prov.nit, nombre: prov.nombre },
    moneda: s.moneda,
    condiciones_pago: pago,
    aprobador: { email: aprob.de, fecha_aprobacion: aprob.fecha, evidencia_sha256: evidenciaSha },
    posiciones: [
      {
        numero: 10,
        descripcion: textoBreve(s.descripcion),
        cantidad: s.cantidad,
        unidad: derivarUnidad(textoUnidad),
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: confirmadoPor })),
  }

  const validada = OrdenCompraSchema.safeParse(orden)
  if (!validada.success) return fallo(`El payload no cumple el esquema: ${validada.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)

  const pos = orden.posiciones[0]
  const trazabilidad: Traza[] = [
    { campo: "referencia.solicitud_id", valor: s.solicitud_id, fuente: "solicitud" },
    { campo: "referencia.correo_id", valor: p.correo.id, fuente: "correo" },
    { campo: "referencia.cotizacion_ref", valor: orden.referencia.cotizacion_ref, fuente: "cotizacion" },
    { campo: "sociedad", valor: "1000", fuente: "derivado", detalle: "constante de configuración SAP" },
    { campo: "organizacion_compras", valor: "1000", fuente: "derivado", detalle: "constante de configuración SAP" },
    { campo: "proveedor.codigo_sap", valor: prov.codigo_sap, fuente: "maestro.proveedores", detalle: `identificado por ${prov.identificado_por}` },
    { campo: "proveedor.nit", valor: prov.nit, fuente: "maestro.proveedores" },
    { campo: "proveedor.nombre", valor: prov.nombre, fuente: "maestro.proveedores" },
    { campo: "moneda", valor: s.moneda, fuente: "solicitud" },
    s.condiciones_pago
      ? { campo: "condiciones_pago", valor: pago, fuente: "solicitud" }
      : { campo: "condiciones_pago", valor: pago, fuente: "maestro.proveedores", detalle: "derivado RC7" },
    { campo: "aprobador.email", valor: aprob.de, fuente: "aprobacion", detalle: "validado contra maestro.centros-costo" },
    { campo: "aprobador.fecha_aprobacion", valor: aprob.fecha, fuente: "aprobacion" },
    { campo: "aprobador.evidencia_sha256", valor: evidenciaSha, fuente: "evidencia", detalle: "sha256 de out/<caso>/aprobacion.txt" },
    { campo: "posiciones[0].numero", valor: 10, fuente: "derivado", detalle: "numeración SAP de posiciones 10, 20, 30…" },
    { campo: "posiciones[0].descripcion", valor: pos?.descripcion ?? null, fuente: s.descripcion.length > LARGO_TEXTO_BREVE ? "derivado" : "solicitud", detalle: `descripción de la solicitud, máx. ${LARGO_TEXTO_BREVE} caracteres` },
    { campo: "posiciones[0].cantidad", valor: s.cantidad, fuente: "solicitud" },
    { campo: "posiciones[0].unidad", valor: pos?.unidad ?? null, fuente: "derivado", detalle: "inferida del texto del ítem (horas → H)" },
    { campo: "posiciones[0].precio_unitario", valor: s.valor_unitario, fuente: "solicitud", detalle: "valor unitario aprobado (IVA incluido)" },
    { campo: "posiciones[0].centro_costo", valor: s.centro_costo, fuente: "solicitud" },
    { campo: "posiciones[0].subarea", valor: s.subarea, fuente: "solicitud" },
    s.indicador_iva
      ? { campo: "posiciones[0].indicador_iva", valor: iva, fuente: "solicitud" }
      : { campo: "posiciones[0].indicador_iva", valor: iva, fuente: "maestro.proveedores", detalle: "derivado RC6, requiere confirmación" },
  ]
  return ok({ orden: validada.data, trazabilidad })
}

export async function guardarPayload(directory: string, caso: string, orden: OrdenCompra, trazabilidad: Traza[]): Promise<Resultado<{ ruta_payload: string; ruta_trazabilidad: string }>> {
  try {
    const dir = rutaSalida(directory, caso)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "payload.json"), JSON.stringify(orden, null, 2), "utf8")
    await writeFile(join(dir, "trazabilidad.json"), JSON.stringify(trazabilidad, null, 2), "utf8")
    return ok({ ruta_payload: `out/${caso}/payload.json`, ruta_trazabilidad: `out/${caso}/trazabilidad.json` })
  } catch (e) {
    return fallo(`No se pudo guardar el payload: ${e instanceof Error ? e.message : String(e)}`)
  }
}
