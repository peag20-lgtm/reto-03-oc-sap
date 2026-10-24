// HU-2: reglas de control RC1–RC10 (PRD 7.3). Funciones puras: misma entrada → mismo resultado.
import type { CentroCosto, Maestros, Paquete, Proveedor } from "./schemas"
import { fechaLocal, formatoCop, normalizarNit, normalizarNombre } from "./util"

/** Parámetros de política. Cambiarlos no toca el servidor ni el prompt. */
export const POLITICA = {
  toleranciaCotizacion: 0.02, // RC5: 2 %
  toleranciaAritmetica: 1, // RC10: ± 1 unidad monetaria
} as const

export type CodigoRegla = "RC1" | "RC2" | "RC3" | "RC4" | "RC5" | "RC6" | "RC7" | "RC8" | "RC9" | "RC10"
export type EstadoRegla = "cumple" | "bloqueo" | "confirmacion" | "derivado"

export type Hallazgo = {
  codigo: CodigoRegla
  regla: string
  detalle: string
  accion_sugerida: string
  valores?: Record<string, string | number | null>
}
export type Derivado = { valor: string; fuente: string; detalle: string }
export type Derivados = {
  proveedor?: { codigo_sap: string; nit: string; nombre: string; identificado_por: "nit" | "nombre" }
  indicador_iva?: Derivado
  condiciones_pago?: Derivado
}
export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
  reglas: Array<{ codigo: CodigoRegla; regla: string; estado: EstadoRegla; detalle: string }>
}

const NOMBRES: Record<CodigoRegla, string> = {
  RC1: "Proveedor existe en el maestro y está activo",
  RC2: "Aprobación válida de un aprobador del centro de costo",
  RC3: "Valor dentro del tope del aprobador",
  RC4: "Subárea pertenece al centro de costo",
  RC5: "Cotización coincide con la solicitud (± 2 %)",
  RC6: "Indicador de IVA informado y válido",
  RC7: "Condiciones de pago informadas y válidas",
  RC8: "Factura no es anterior a la solicitud (OC retroactiva)",
  RC9: "Aprobación no es anterior a la solicitud",
  RC10: "Cantidad × valor unitario = valor total",
}

type Evaluacion = {
  estado: EstadoRegla
  detalle: string
  accion?: string
  valores?: Hallazgo["valores"]
}
type Contexto = { p: Paquete; m: Maestros; proveedor: Proveedor | null; centro: CentroCosto | null }

const cumple = (detalle: string): Evaluacion => ({ estado: "cumple", detalle })

export function buscarProveedor(p: Paquete, m: Maestros): { proveedor: Proveedor | null; por: "nit" | "nombre" } {
  const nit = p.solicitud.proveedor_nit
  if (nit) {
    return { proveedor: m.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit)) ?? null, por: "nit" }
  }
  const nombre = normalizarNombre(p.solicitud.proveedor_nombre)
  return { proveedor: m.proveedores.find((x) => normalizarNombre(x.nombre) === nombre) ?? null, por: "nombre" }
}

function rc1({ p, proveedor }: Contexto): Evaluacion {
  const id = p.solicitud.proveedor_nit ? `NIT ${p.solicitud.proveedor_nit}` : `nombre "${p.solicitud.proveedor_nombre}"`
  if (!proveedor) {
    return {
      estado: "bloqueo",
      detalle: `El proveedor "${p.solicitud.proveedor_nombre}" (${id}) no existe en el maestro de proveedores.`,
      accion: "Solicitar la creación del proveedor en SAP (RUT, certificación bancaria, debida diligencia/SARLAFT) o pedir al solicitante cotizar con un proveedor registrado.",
    }
  }
  if (!proveedor.activo) {
    return {
      estado: "bloqueo",
      detalle: `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) existe pero está INACTIVO.`,
      accion: "Consultar a Compras el motivo del bloqueo del proveedor antes de reactivarlo o elegir otro proveedor.",
    }
  }
  return cumple(`${proveedor.nombre} · código SAP ${proveedor.codigo_sap} · activo (identificado por ${id}).`)
}

function rc2({ p, centro }: Contexto): Evaluacion {
  const a = p.aprobacion
  if (!a) return { estado: "bloqueo", detalle: "No hay correo de aprobación en el paquete.", accion: "Pedir al solicitante el correo de aprobación de su líder." }
  if (!a.aprobado) return { estado: "bloqueo", detalle: `El correo de ${a.de} no contiene la palabra "Aprobado".`, accion: "Pedir al líder una aprobación explícita." }
  if (!centro) return { estado: "bloqueo", detalle: `El centro de costo ${p.solicitud.centro_costo} no existe; no se puede verificar al aprobador.`, accion: "Corregir el centro de costo en la solicitud." }
  const autorizado = centro.aprobadores.some((x) => x.email.toLowerCase() === a.de.toLowerCase())
  if (!autorizado) {
    return {
      estado: "bloqueo",
      detalle: `${a.de} no es aprobador del centro de costo ${centro.centro_costo} (${centro.nombre ?? ""}). Aprobadores válidos: ${centro.aprobadores.map((x) => x.email).join(", ")}.`,
      accion: `Solicitar la aprobación a un aprobador de ${centro.centro_costo}, o corregir el centro de costo si el gasto pertenece a otra área.`,
    }
  }
  return cumple(`Aprobado por ${a.de}, aprobador de ${centro.centro_costo}.`)
}

function rc3({ p, centro }: Contexto): Evaluacion {
  const a = p.aprobacion
  const total = p.solicitud.valor_total
  if (!a || !centro) return { estado: "bloqueo", detalle: "Sin aprobación o centro de costo válido no se puede verificar el tope.", accion: "Resolver RC2/RC4 primero." }
  const aprobador = centro.aprobadores.find((x) => x.email.toLowerCase() === a.de.toLowerCase())
  const mayor = centro.aprobadores.reduce((max, x) => (x.tope > max.tope ? x : max), centro.aprobadores[0] ?? { email: "", tope: 0 })
  const escalar = mayor.tope >= total
    ? `El aprobador del centro con tope suficiente es ${mayor.email} (tope ${formatoCop(mayor.tope)}).`
    : `Ningún aprobador de ${centro.centro_costo} tiene tope suficiente (máximo ${formatoCop(mayor.tope)}): requiere escalamiento a la instancia superior o ajuste de la matriz de atribuciones.`
  if (!aprobador) {
    return { estado: "bloqueo", detalle: `${a.de} no tiene tope asignado en ${centro.centro_costo}. ${escalar}`, accion: escalar, valores: { valor_total: total, tope_maximo_centro: mayor.tope } }
  }
  if (total > aprobador.tope) {
    return { estado: "bloqueo", detalle: `Valor ${formatoCop(total)} supera el tope de ${aprobador.email} (${formatoCop(aprobador.tope)}). ${escalar}`, accion: escalar, valores: { valor_total: total, tope: aprobador.tope } }
  }
  return cumple(`Valor ${formatoCop(total)} ≤ tope ${formatoCop(aprobador.tope)} de ${aprobador.email}.`)
}

function rc4({ p, centro }: Contexto): Evaluacion {
  if (!centro) return { estado: "bloqueo", detalle: `El centro de costo ${p.solicitud.centro_costo} no existe en el maestro.`, accion: "Corregir el centro de costo en la solicitud." }
  if (!centro.subareas.includes(p.solicitud.subarea)) {
    return { estado: "bloqueo", detalle: `La subárea "${p.solicitud.subarea}" no pertenece a ${centro.centro_costo}. Válidas: ${centro.subareas.join(", ")}.`, accion: "Corregir la subárea con el solicitante." }
  }
  return cumple(`"${p.solicitud.subarea}" pertenece a ${centro.centro_costo}.`)
}

function rc5({ p }: Contexto): Evaluacion {
  const c = p.cotizacion
  const total = p.solicitud.valor_total
  if (!c) return { estado: "confirmacion", detalle: "No hay cotización: no se puede contrastar el valor.", accion: "Confirmar que se crea la OC sin cotización o pedirla al solicitante.", valores: { solicitud: total, cotizacion: null } }
  const diferencia = Math.abs(c.total - total) / total
  const pct = Math.round(diferencia * 10000) / 100
  if (diferencia > POLITICA.toleranciaCotizacion) {
    return {
      estado: "confirmacion",
      detalle: `Solicitud ${formatoCop(total)} vs cotización ${formatoCop(c.total)} (${c.numero ?? "s/n"}): diferencia ${pct} % > ${POLITICA.toleranciaCotizacion * 100} %.`,
      accion: "Si se confirma, la OC se crea por el valor de la solicitud (lo aprobado por el líder) y la factura del proveedor por el valor cotizado no cuadrará con la OC. Alternativa: pedir solicitud y aprobación ajustadas al valor cotizado.",
      valores: { solicitud: total, cotizacion: c.total, diferencia_pct: pct },
    }
  }
  return cumple(`Cotización ${formatoCop(c.total)} vs solicitud ${formatoCop(total)} (diferencia ${pct} %).`)
}

function rc6({ p, m, proveedor }: Contexto): Evaluacion {
  const ind = p.solicitud.indicador_iva
  if (ind) {
    const ok = m.indicadoresIva.find((x) => x.codigo === ind)
    return ok ? cumple(`${ind} (${ok.descripcion}) informado en la solicitud.`) : { estado: "bloqueo", detalle: `Indicador de IVA "${ind}" no existe en el maestro.`, accion: "Corregir el indicador de IVA con Contabilidad." }
  }
  if (!proveedor) return { estado: "confirmacion", detalle: "IVA no informado y no se pudo derivar (proveedor no identificado).", accion: "Pedir el indicador de IVA." }
  const desc = m.indicadoresIva.find((x) => x.codigo === proveedor.indicador_iva_default)?.descripcion ?? "?"
  return {
    estado: "confirmacion",
    detalle: `IVA no informado en la solicitud; se deriva ${proveedor.indicador_iva_default} (${desc}) del maestro del proveedor.`,
    accion: `Confirmar que aplica ${proveedor.indicador_iva_default} (${desc}).`,
    valores: { derivado: proveedor.indicador_iva_default },
  }
}

function rc7({ p, m, proveedor }: Contexto): Evaluacion {
  const cond = p.solicitud.condiciones_pago
  if (cond) {
    const ok = m.condicionesPago.find((x) => x.codigo === cond)
    return ok ? cumple(`${cond} (${ok.descripcion}) informado en la solicitud.`) : { estado: "bloqueo", detalle: `Condición de pago "${cond}" no existe en el maestro.`, accion: "Corregir la condición de pago." }
  }
  if (!proveedor) return { estado: "cumple", detalle: "No informada; no se deriva porque el proveedor no fue identificado (ver RC1)." }
  const desc = m.condicionesPago.find((x) => x.codigo === proveedor.condiciones_pago_default)?.descripcion ?? "?"
  return { estado: "derivado", detalle: `No informada; se deriva ${proveedor.condiciones_pago_default} (${desc}) del maestro del proveedor.` }
}

function rc8({ p }: Contexto): Evaluacion {
  const f = p.factura
  if (!f) return cumple("No hay factura en el paquete (flujo normal: OC antes de factura).")
  if (f.fecha < p.solicitud.fecha_solicitud) {
    return {
      estado: "confirmacion",
      detalle: `OC RETROACTIVA: la factura ${f.numero} (${f.fecha}) es anterior a la solicitud (${p.solicitud.fecha_solicitud}). El gasto ocurrió antes de la solicitud y la aprobación.`,
      accion: "Confirmar la creación para poder radicar la factura; queda marcada retroactiva = true en el log de control.",
      valores: { fecha_factura: f.fecha, fecha_solicitud: p.solicitud.fecha_solicitud },
    }
  }
  return cumple(`Factura ${f.numero} (${f.fecha}) no es anterior a la solicitud.`)
}

function rc9({ p }: Contexto): Evaluacion {
  const a = p.aprobacion
  if (!a) return cumple("Sin aprobación (ver RC2).")
  const fa = fechaLocal(a.fecha)
  if (fa < p.solicitud.fecha_solicitud) {
    return { estado: "confirmacion", detalle: `La aprobación (${fa}) es anterior a la solicitud (${p.solicitud.fecha_solicitud}).`, accion: "Confirmar que la aprobación corresponde a esta solicitud.", valores: { fecha_aprobacion: fa, fecha_solicitud: p.solicitud.fecha_solicitud } }
  }
  return cumple(`Aprobación ${fa} ≥ solicitud ${p.solicitud.fecha_solicitud}.`)
}

function rc10({ p }: Contexto): Evaluacion {
  const { cantidad, valor_unitario, valor_total } = p.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) > POLITICA.toleranciaAritmetica) {
    return { estado: "bloqueo", detalle: `${cantidad} × ${formatoCop(valor_unitario)} = ${formatoCop(calculado)} ≠ valor total ${formatoCop(valor_total)}.`, accion: "Pedir al solicitante corregir cantidades o valores del Excel.", valores: { calculado, valor_total } }
  }
  return cumple(`${cantidad} × ${formatoCop(valor_unitario)} = ${formatoCop(valor_total)}.`)
}

const REGLAS: Array<[CodigoRegla, (c: Contexto) => Evaluacion]> = [
  ["RC1", rc1], ["RC2", rc2], ["RC3", rc3], ["RC4", rc4], ["RC5", rc5],
  ["RC6", rc6], ["RC7", rc7], ["RC8", rc8], ["RC9", rc9], ["RC10", rc10],
]

export function validarPaquete(p: Paquete, m: Maestros): Validacion {
  const { proveedor, por } = buscarProveedor(p, m)
  const centro = m.centrosCosto.find((x) => x.centro_costo === p.solicitud.centro_costo) ?? null
  const ctx: Contexto = { p, m, proveedor, centro }

  const v: Validacion = { apta: true, bloqueos: [], confirmaciones: [], derivados: {}, retroactiva: false, reglas: [] }
  for (const [codigo, regla] of REGLAS) {
    const e = regla(ctx)
    v.reglas.push({ codigo, regla: NOMBRES[codigo], estado: e.estado, detalle: e.detalle })
    const hallazgo: Hallazgo = { codigo, regla: NOMBRES[codigo], detalle: e.detalle, accion_sugerida: e.accion ?? "", ...(e.valores ? { valores: e.valores } : {}) }
    if (e.estado === "bloqueo") v.bloqueos.push(hallazgo)
    if (e.estado === "confirmacion") v.confirmaciones.push(hallazgo)
  }

  v.apta = v.bloqueos.length === 0
  v.retroactiva = p.factura !== null && p.factura.fecha < p.solicitud.fecha_solicitud
  if (proveedor) {
    v.derivados.proveedor = { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre, identificado_por: por }
    if (!p.solicitud.indicador_iva) {
      v.derivados.indicador_iva = { valor: proveedor.indicador_iva_default, fuente: "maestro.proveedores", detalle: "indicador_iva_default del proveedor (RC6)" }
    }
    if (!p.solicitud.condiciones_pago) {
      v.derivados.condiciones_pago = { valor: proveedor.condiciones_pago_default, fuente: "maestro.proveedores", detalle: "condiciones_pago_default del proveedor (RC7)" }
    }
  }
  return v
}
