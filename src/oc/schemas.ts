// Esquemas zod del dominio: entradas (fixtures), maestros, paquete normalizado y orden de compra.
import { z } from "zod"

// ---------- Entradas del correo ----------
export const CorreoSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(1),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).default([]),
})
export type Correo = z.infer<typeof CorreoSchema>

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number({ error: "debe ser numérico" }).positive(),
  valor_unitario: z.number({ error: "debe ser numérico" }).nonnegative(),
  valor_total: z.number({ error: "debe ser numérico" }).positive(),
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "formato AAAA-MM-DD"),
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const AprobacionRawSchema = z.object({
  de: z.string().min(1),
  para: z.string().default(""),
  cc: z.array(z.string()).default([]),
  fecha: z.string().min(1),
  asunto: z.string().default(""),
  cuerpo: z.string().default(""),
})
export type AprobacionRaw = z.infer<typeof AprobacionRawSchema>

// ---------- Maestros ----------
export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
})
export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Proveedor = z.infer<typeof ProveedorSchema>
export type CentroCosto = z.infer<typeof CentroCostoSchema>
export type Maestros = {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorIvaSchema>[]
  condicionesPago: z.infer<typeof CondicionPagoSchema>[]
}

// ---------- Paquete normalizado (PRD 7.2) ----------
export const CotizacionSchema = z.object({
  numero: z.string().nullable(),
  fecha: z.string().nullable(),
  proveedor: z.string(),
  nit: z.string().nullable(),
  total: z.number(),
  moneda: z.string(),
  validez_hasta: z.string().nullable(),
  texto: z.string(),
})
export const AprobacionSchema = z.object({
  de: z.string(),
  fecha: z.string(),
  aprobado: z.boolean(),
  texto: z.string(),
})
export const FacturaSchema = z.object({ numero: z.string(), fecha: z.string(), total: z.number() })

export const PaqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string() }),
  solicitud: SolicitudSchema,
  cotizacion: CotizacionSchema.nullable(),
  aprobacion: AprobacionSchema.nullable(),
  factura: FacturaSchema.nullable(),
  faltantes: z.array(z.string()),
})
export type Paquete = z.infer<typeof PaqueteSchema>

// ---------- Orden de compra (PRD 7.4) ----------
export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>
