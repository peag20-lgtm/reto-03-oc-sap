// Resumen de una línea del resultado de cada herramienta, para el chat (el detalle completo queda en el log).

function obtener(valor: unknown, ruta: string): unknown {
  let actual: unknown = valor
  for (const parte of ruta.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  return actual
}

const txt = (v: unknown): string => (v === undefined || v === null ? "—" : String(v))
const codigos = (v: unknown): string =>
  Array.isArray(v) && v.length > 0 ? v.map((x) => txt(obtener(x, "codigo") ?? x)).join(", ") : "ninguna"
const cop = (v: unknown): string => (typeof v === "number" ? v.toLocaleString("es-CO") : txt(v))

export function resumir(nombre: string, resultado: string): { ok: boolean; resumen: string } {
  let r: unknown
  try {
    r = JSON.parse(resultado)
  } catch {
    return { ok: false, resumen: "Resultado no legible" }
  }
  if (obtener(r, "ok") !== true) {
    const estado = obtener(r, "estado")
    return { ok: false, resumen: `${estado ? `[${txt(estado)}] ` : ""}${txt(obtener(r, "error")).slice(0, 220)}` }
  }
  const d = obtener(r, "data")
  switch (nombre) {
    case "oc_leer_paquete":
      return { ok: true, resumen: `${txt(obtener(d, "solicitud.solicitud_id"))} · ${txt(obtener(d, "solicitud.proveedor_nombre"))} · COP ${cop(obtener(d, "solicitud.valor_total"))} · faltantes: ${codigos(obtener(d, "faltantes"))}` }
    case "oc_validar":
      return { ok: true, resumen: `apta=${txt(obtener(d, "apta"))} · bloqueos: ${codigos(obtener(d, "bloqueos"))} · confirmaciones: ${codigos(obtener(d, "confirmaciones"))} · retroactiva=${txt(obtener(d, "retroactiva"))}` }
    case "oc_generar_evidencia":
      return { ok: true, resumen: `${txt(obtener(d, "ruta"))} · sha256 ${txt(obtener(d, "sha256")).slice(0, 12)}…` }
    case "oc_construir_payload":
      return { ok: true, resumen: `${txt(obtener(d, "orden.proveedor.nombre"))} · ${txt(obtener(d, "orden.posiciones.0.cantidad"))} × ${cop(obtener(d, "orden.posiciones.0.precio_unitario"))} · confirmaciones: ${codigos(obtener(d, "confirmaciones_requeridas"))}` }
    case "oc_crear":
      return { ok: true, resumen: `OC ${txt(obtener(d, "numero_oc"))}${obtener(d, "idempotente") === true ? " (ya existía: idempotente)" : " creada"}${obtener(d, "retroactiva") === true ? " · RETROACTIVA" : ""}` }
    default:
      return { ok: true, resumen: "ok" }
  }
}
