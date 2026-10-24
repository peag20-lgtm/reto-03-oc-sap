// Registro de herramientas: nombre "<archivo>_<export>", JSON Schema para el modelo y validación zod antes de ejecutar.
import { z } from "zod"
import type { DefinicionHerramienta } from "../llm/adapter"
import type { ContextoHerramienta, Herramienta } from "../tools/definir"
import * as oc from "../tools/oc"

export type HerramientaRegistrada = DefinicionHerramienta & {
  ejecutar(argumentos: unknown, ctx: ContextoHerramienta): Promise<string>
}

function registrar(archivo: string, nombreExport: string, h: Herramienta<z.ZodRawShape>): HerramientaRegistrada {
  const esquema = z.object(h.args)
  const { $schema: _omitido, ...parametros } = z.toJSONSchema(esquema) as Record<string, unknown>
  return {
    nombre: `${archivo}_${nombreExport}`,
    descripcion: h.description,
    parametros,
    async ejecutar(argumentos, ctx) {
      const r = esquema.safeParse(argumentos)
      if (!r.success) {
        const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(args)"}: ${i.message}`).join("; ")
        return JSON.stringify({ ok: false, error: `Argumentos inválidos para ${archivo}_${nombreExport} → ${detalle}` })
      }
      return h.execute(r.data, ctx)
    },
  }
}

export const HERRAMIENTAS: HerramientaRegistrada[] = Object.entries(oc).map(([nombre, h]) => registrar("oc", nombre, h))
export const POR_NOMBRE = new Map(HERRAMIENTAS.map((h) => [h.nombre, h]))
