// Orquestación de casos de uso. Las herramientas (src/tools/oc.ts) y demo.ts llaman aquí.
// Principio: la fuente de verdad son los archivos del caso. Lo que envía el modelo se VERIFICA, nunca se usa tal cual.
import { registrarControl, type ResultadoControl } from "./control"
import { type Evidencia, generarEvidencia } from "./evidencia"
import { cargarMaestros } from "./maestros"
import { leerPaquete } from "./paquete"
import { construirOrden, guardarPayload } from "./payload"
import { type Derivados, validarPaquete, type Validacion } from "./reglas"
import { type OrdenCompra, OrdenCompraSchema, type Paquete, PaqueteSchema } from "./schemas"
import { fallo, jsonEstable, ok, type Resultado } from "./util"
import { SapMock } from "../sap/mock"
import type { SapAdapter } from "../sap/adapter"

// ---------- Integridad de lo que envía el modelo ----------
function camposCriticos(p: Paquete): Record<string, unknown> {
  const s = p.solicitud
  return {
    "solicitud.proveedor_nit": s.proveedor_nit, "solicitud.proveedor_nombre": s.proveedor_nombre,
    "solicitud.cantidad": s.cantidad, "solicitud.valor_unitario": s.valor_unitario, "solicitud.valor_total": s.valor_total,
    "solicitud.moneda": s.moneda, "solicitud.centro_costo": s.centro_costo, "solicitud.subarea": s.subarea,
    "solicitud.indicador_iva": s.indicador_iva, "solicitud.condiciones_pago": s.condiciones_pago,
    "solicitud.fecha_solicitud": s.fecha_solicitud, "aprobacion.de": p.aprobacion?.de, "aprobacion.fecha": p.aprobacion?.fecha,
    "aprobacion.aprobado": p.aprobacion?.aprobado, "cotizacion.total": p.cotizacion?.total, "factura.fecha": p.factura?.fecha,
  }
}

export function verificarPaquete(entrada: unknown, real: Paquete): Resultado<true> {
  if (entrada === undefined || entrada === null) return ok(true)
  const r = PaqueteSchema.safeParse(entrada)
  if (!r.success) return fallo("El 'paquete' recibido no cumple el esquema. Omite ese argumento: la herramienta lee el caso desde la fuente.")
  const a = camposCriticos(r.data)
  const b = camposCriticos(real)
  const distintos = Object.keys(b).filter((k) => jsonEstable(a[k]) !== jsonEstable(b[k]))
  return distintos.length === 0
    ? ok(true)
    : fallo(`INTEGRIDAD: el paquete recibido difiere de la fuente en ${distintos.join(", ")}. No se procesa un paquete alterado.`)
}

export type DerivadosEntrada = {
  proveedor?: { codigo_sap?: string | undefined } | undefined
  indicador_iva?: { valor?: string | undefined } | undefined
  condiciones_pago?: { valor?: string | undefined } | undefined
}

function verificarDerivados(entrada: DerivadosEntrada | undefined, reales: Derivados): Resultado<true> {
  if (!entrada) return ok(true)
  const pares: Array<[string, string | undefined, string | undefined]> = [
    ["indicador_iva", entrada.indicador_iva?.valor, reales.indicador_iva?.valor],
    ["condiciones_pago", entrada.condiciones_pago?.valor, reales.condiciones_pago?.valor],
    ["proveedor.codigo_sap", entrada.proveedor?.codigo_sap, reales.proveedor?.codigo_sap],
  ]
  const distintos = pares.filter(([, a, b]) => a !== undefined && a !== b).map(([k]) => k)
  return distintos.length === 0 ? ok(true) : fallo(`INTEGRIDAD: derivados distintos a los calculados en ${distintos.join(", ")}.`)
}

function sinConfirmador(o: OrdenCompra): OrdenCompra {
  return { ...o, excepciones: o.excepciones.map((e) => ({ ...e, confirmado_por: null })) }
}

// ---------- Casos de uso ----------
type Base = { paquete: Paquete; validacion: Validacion }

async function cargarYValidar(directory: string, caso: string): Promise<Resultado<Base>> {
  const [paquete, maestros] = await Promise.all([leerPaquete(directory, caso), cargarMaestros(directory)])
  if (!paquete.ok) return paquete
  if (!maestros.ok) return maestros
  return ok({ paquete: paquete.data, validacion: validarPaquete(paquete.data, maestros.data) })
}

export async function validarCaso(directory: string, caso: string, paqueteEntrada?: unknown): Promise<Resultado<Validacion>> {
  const base = await cargarYValidar(directory, caso)
  if (!base.ok) return base
  const integridad = verificarPaquete(paqueteEntrada, base.data.paquete)
  return integridad.ok ? ok(base.data.validacion) : integridad
}

export type PayloadConstruido = {
  orden: OrdenCompra
  ruta_payload: string
  ruta_trazabilidad: string
  evidencia: Evidencia
  confirmaciones_requeridas: string[]
}

async function prepararOrden(directory: string, caso: string, confirmadoPor: string | null): Promise<Resultado<Base & PayloadConstruido>> {
  const base = await cargarYValidar(directory, caso)
  if (!base.ok) return base
  const evidencia = await generarEvidencia(directory, caso)
  if (!evidencia.ok) return evidencia
  const construida = construirOrden(base.data.paquete, base.data.validacion, evidencia.data.sha256, confirmadoPor)
  if (!construida.ok) return construida
  const guardado = await guardarPayload(directory, caso, construida.data.orden, construida.data.trazabilidad)
  if (!guardado.ok) return guardado
  return ok({
    ...base.data,
    orden: construida.data.orden,
    ...guardado.data,
    evidencia: evidencia.data,
    confirmaciones_requeridas: base.data.validacion.confirmaciones.map((c) => c.codigo),
  })
}

export async function construirPayloadCaso(directory: string, caso: string, paqueteEntrada?: unknown, derivadosEntrada?: DerivadosEntrada): Promise<Resultado<PayloadConstruido>> {
  const r = await prepararOrden(directory, caso, null)
  if (!r.ok) return r
  const i1 = verificarPaquete(paqueteEntrada, r.data.paquete)
  if (!i1.ok) return i1
  const i2 = verificarDerivados(derivadosEntrada, r.data.validacion.derivados)
  if (!i2.ok) return i2
  const { orden, ruta_payload, ruta_trazabilidad, evidencia, confirmaciones_requeridas } = r.data
  return ok({ orden, ruta_payload, ruta_trazabilidad, evidencia, confirmaciones_requeridas })
}

export type OrdenCreada = { numero_oc: string; fecha: string | null; idempotente: boolean; retroactiva: boolean; evidencia: string | null; excepciones_confirmadas: string[] }
export type FalloCreacion = { ok: false; error: string; estado: "bloqueada" | "pendiente_confirmacion" | "rechazada_integridad" | "error"; bloqueos?: string[]; confirmaciones?: string[] }

export type OpcionesCrear = { payload?: unknown; confirmado?: boolean; confirmadoPor: string; sap?: SapAdapter }

/** HU-5. Cada intento deja una fila en out/control.csv. */
export async function crearOrdenCaso(directory: string, caso: string, op: OpcionesCrear): Promise<{ ok: true; data: OrdenCreada } | FalloCreacion> {
  const sap = op.sap ?? new SapMock(directory)
  const base = await cargarYValidar(directory, caso)
  if (!base.ok) return { ok: false, estado: "error", error: base.error }
  const { paquete, validacion: v } = base.data
  const solicitud_id = paquete.solicitud.solicitud_id
  const fila = (resultado: ResultadoControl, numero_oc: string | null = null) =>
    registrarControl(directory, { solicitud_id, resultado, numero_oc, retroactiva: v.retroactiva, bloqueos: v.bloqueos.map((b) => b.codigo), confirmaciones: v.confirmaciones.map((c) => c.codigo) })

  // Idempotencia: si ya existe una OC para esta solicitud, se devuelve la misma.
  const existente = await sap.buscarOrdenPorReferencia(solicitud_id)
  if (existente) {
    await fila("existente", existente.numero_oc)
    return { ok: true, data: { numero_oc: existente.numero_oc, fecha: null, idempotente: true, retroactiva: v.retroactiva, evidencia: null, excepciones_confirmadas: [] } }
  }
  if (!v.apta) {
    await fila("bloqueada")
    return { ok: false, estado: "bloqueada", error: `No se crea la OC: ${v.bloqueos.map((b) => `${b.codigo} ${b.detalle}`).join(" | ")}`, bloqueos: v.bloqueos.map((b) => b.codigo) }
  }
  if (v.confirmaciones.length > 0 && op.confirmado !== true) {
    await fila("pendiente_confirmacion")
    return { ok: false, estado: "pendiente_confirmacion", error: `Requiere confirmación humana explícita de: ${v.confirmaciones.map((c) => `${c.codigo} ${c.detalle}`).join(" | ")}`, confirmaciones: v.confirmaciones.map((c) => c.codigo) }
  }

  const confirmadoPor = v.confirmaciones.length > 0 ? op.confirmadoPor : null
  const prep = await prepararOrden(directory, caso, confirmadoPor)
  if (!prep.ok) {
    await fila("error")
    return { ok: false, estado: "error", error: prep.error }
  }
  if (op.payload !== undefined && op.payload !== null) {
    const recibido = OrdenCompraSchema.safeParse(op.payload)
    const iguales = recibido.success && jsonEstable(sinConfirmador(recibido.data)) === jsonEstable(sinConfirmador(prep.data.orden))
    if (!iguales) {
      await fila("rechazada_integridad")
      return { ok: false, estado: "rechazada_integridad", error: "INTEGRIDAD: el payload recibido no coincide con el construido desde la fuente. Usa el de oc_construir_payload sin modificarlo, u omítelo." }
    }
  }
  // Doble verificación contra SAP (el maestro local puede estar desactualizado).
  const enSap = await sap.consultarProveedor(prep.data.orden.proveedor.nit)
  if (!enSap?.activo) {
    await fila("bloqueada")
    return { ok: false, estado: "bloqueada", error: "SAP reporta el proveedor inexistente o inactivo.", bloqueos: ["RC1"] }
  }
  try {
    const creada = await sap.crearOrden(prep.data.orden)
    await fila("creada", creada.numero_oc)
    return { ok: true, data: { numero_oc: creada.numero_oc, fecha: creada.fecha, idempotente: false, retroactiva: v.retroactiva, evidencia: prep.data.evidencia.ruta_pdf, excepciones_confirmadas: prep.data.orden.excepciones.map((e) => e.codigo) } }
  } catch (e) {
    await fila("error")
    return { ok: false, estado: "error", error: `SAP no pudo crear la orden: ${e instanceof Error ? e.message : String(e)}` }
  }
}
