// SAP simulado sobre archivos: out/sap/ordenes.jsonl. Consecutivo desde 4500000001.
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { cargarMaestros } from "../oc/maestros"
import type { OrdenCompra } from "../oc/schemas"
import { crearMutex, normalizarNit, rutaSalida } from "../oc/util"
import type { SapAdapter } from "./adapter"

const PRIMER_NUMERO = 4500000001
type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra }

// Un mutex por proceso: dos creaciones simultáneas no reciben el mismo número ni duplican la OC.
const exclusivo = crearMutex()

export class SapMock implements SapAdapter {
  constructor(private readonly directory: string) {}

  private get archivo(): string {
    return join(rutaSalida(this.directory, "sap"), "ordenes.jsonl")
  }

  private async registros(): Promise<Registro[]> {
    try {
      const texto = await readFile(this.archivo, "utf8")
      return texto.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Registro)
    } catch {
      return []
    }
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const m = await cargarMaestros(this.directory)
    if (!m.ok) return null
    const p = m.data.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit))
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const r = (await this.registros()).find((x) => x.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc } : null
  }

  /** Idempotente por solicitud_id incluso bajo concurrencia (búsqueda y escritura dentro del mutex). */
  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return exclusivo(async () => {
      const actuales = await this.registros()
      const existente = actuales.find((x) => x.solicitud_id === orden.referencia.solicitud_id)
      if (existente) return { numero_oc: existente.numero_oc, fecha: existente.fecha }
      const registro: Registro = {
        numero_oc: String(PRIMER_NUMERO + actuales.length),
        fecha: new Date().toISOString(),
        solicitud_id: orden.referencia.solicitud_id,
        orden,
      }
      await mkdir(rutaSalida(this.directory, "sap"), { recursive: true })
      await appendFile(this.archivo, `${JSON.stringify(registro)}\n`, "utf8")
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
  }
}
