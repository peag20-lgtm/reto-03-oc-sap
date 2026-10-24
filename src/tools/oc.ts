// Herramientas del agente. Cada export se expone al modelo como oc_<export>.
// Son la ÚNICA fuente de valores que el agente puede afirmar (CA2). No ejecutan comandos de shell.
import { z } from "zod"
import { generarEvidencia } from "../oc/evidencia"
import { leerPaquete } from "../oc/paquete"
import { construirPayloadCaso, crearOrdenCaso, validarCaso } from "../oc/servicio"
import { definir, seguro } from "./definir"

const caso = z.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, p. ej. "sol-001"')
const opcional = (que: string) =>
  z.unknown().optional().describe(`Opcional. ${que} tal como lo devolvió la herramienta anterior; si se envía se verifica contra la fuente y se rechaza si fue alterado. Recomendado: omitirlo.`)

export const leer_paquete = definir({
  description: "Lee el correo, la solicitud, la cotización, la aprobación y la factura (si existe) de un caso y los devuelve normalizados, indicando los adjuntos faltantes.",
  args: { caso },
  execute: (args, ctx) => seguro(() => leerPaquete(ctx.directory, args.caso)),
})

export const validar = definir({
  description: "Aplica las reglas de control RC1–RC10 contra los maestros y devuelve apta, bloqueos, confirmaciones, derivados, retroactiva y el detalle de cada regla.",
  args: { caso, paquete: opcional("Paquete") },
  execute: (args, ctx) => seguro(() => validarCaso(ctx.directory, args.caso, args.paquete)),
})

export const generar_evidencia = definir({
  description: "Genera la evidencia de aprobación del caso (out/<caso>/aprobacion.txt y .pdf) y devuelve su ruta y sha256.",
  args: { caso },
  execute: (args, ctx) => seguro(() => generarEvidencia(ctx.directory, args.caso)),
})

const DerivadosEntrada = z
  .object({
    proveedor: z.object({ codigo_sap: z.string().optional() }).optional(),
    indicador_iva: z.object({ valor: z.string().optional() }).optional(),
    condiciones_pago: z.object({ valor: z.string().optional() }).optional(),
  })
  .optional()
  .describe("Opcional. Derivados devueltos por oc_validar; se verifican contra los calculados. Recomendado: omitirlo.")

export const construir_payload = definir({
  description: "Construye la orden de compra exactamente como quedaría en SAP (validada con zod), genera la evidencia y guarda la trazabilidad campo→fuente; no crea la OC.",
  args: { caso, paquete: opcional("Paquete"), derivados: DerivadosEntrada },
  execute: (args, ctx) => seguro(() => construirPayloadCaso(ctx.directory, args.caso, args.paquete, args.derivados)),
})

export const crear = definir({
  description: "Crea la OC en SAP (idempotente por solicitud_id) solo si el caso es apto y, cuando hay confirmaciones, con confirmado=true; registra cada intento en el log de control.",
  args: {
    caso,
    payload: opcional("Payload (OrdenCompra) de oc_construir_payload"),
    confirmado: z.boolean().optional().describe("true SOLO si el usuario confirmó explícitamente en su último mensaje las excepciones presentadas. Nunca por iniciativa propia."),
  },
  execute: (args, ctx) =>
    seguro(() =>
      crearOrdenCaso(ctx.directory, args.caso, {
        payload: args.payload,
        confirmado: args.confirmado,
        confirmadoPor: `analista (sesión ${ctx.sessionId})`,
      }),
    ),
})
