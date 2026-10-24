// Carga de maestros (en producción vendrían de SAP en tiempo real).
import { join } from "node:path"
import { z } from "zod"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  type Maestros,
  ProveedorSchema,
} from "./schemas"
import { fallo, leerJson, ok, type Resultado, RUTA_MAESTROS } from "./util"

export async function cargarMaestros(directory: string): Promise<Resultado<Maestros>> {
  const base = join(directory, ...RUTA_MAESTROS)
  const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
    leerJson(join(base, "proveedores.json"), z.array(ProveedorSchema), "maestro de proveedores"),
    leerJson(join(base, "centros-costo.json"), z.array(CentroCostoSchema), "maestro de centros de costo"),
    leerJson(join(base, "indicadores-iva.json"), z.array(IndicadorIvaSchema), "maestro de indicadores de IVA"),
    leerJson(join(base, "condiciones-pago.json"), z.array(CondicionPagoSchema), "maestro de condiciones de pago"),
  ])
  if (!proveedores.ok) return fallo(proveedores.error)
  if (!centrosCosto.ok) return fallo(centrosCosto.error)
  if (!indicadoresIva.ok) return fallo(indicadoresIva.error)
  if (!condicionesPago.ok) return fallo(condicionesPago.error)
  return ok({
    proveedores: proveedores.data,
    centrosCosto: centrosCosto.data,
    indicadoresIva: indicadoresIva.data,
    condicionesPago: condicionesPago.data,
  })
}
