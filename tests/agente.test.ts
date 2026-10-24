// Pruebas: reglas por caso, idempotencia, integridad, errores legibles y compuerta de confirmación humana con un LLM falso.
import { beforeEach, describe, expect, test } from "bun:test"
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ejecutarTurno, type DependenciasAgente } from "../src/agent/ciclo"
import { casosConfirmados } from "../src/agent/confirmacion"
import { AlmacenSesiones } from "../src/agent/sesiones"
import type { LlamadaHerramienta, ProveedorLLM, RespuestaLLM } from "../src/llm/adapter"
import { aFormatoAnthropic } from "../src/llm/anthropic"
import * as oc from "../src/tools/oc"

type R = { ok: boolean; error?: string; estado?: string; data?: Record<string, unknown> }
let dir = ""
const ctx = () => ({ directory: dir, sessionId: "test" })
const ejecutar = async (p: Promise<string>): Promise<R> => JSON.parse(await p) as R
const codigos = (v: unknown) => (v as Array<{ codigo: string }>).map((x) => x.codigo)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reto03-"))
  await cp(join(import.meta.dir, "..", "fixtures"), join(dir, "fixtures"), { recursive: true })
})

describe("reglas de control sobre los 6 casos", () => {
  const esperado: Record<string, { apta: boolean; bloqueos: string[]; confirmaciones: string[]; retroactiva: boolean }> = {
    "sol-001": { apta: true, bloqueos: [], confirmaciones: [], retroactiva: false },
    "sol-002": { apta: false, bloqueos: ["RC1"], confirmaciones: [], retroactiva: false },
    "sol-003": { apta: false, bloqueos: ["RC2", "RC3"], confirmaciones: [], retroactiva: false },
    "sol-004": { apta: true, bloqueos: [], confirmaciones: ["RC5"], retroactiva: false },
    "sol-005": { apta: true, bloqueos: [], confirmaciones: ["RC8"], retroactiva: true },
    "sol-006": { apta: true, bloqueos: [], confirmaciones: ["RC6"], retroactiva: false },
  }
  for (const [caso, e] of Object.entries(esperado)) {
    test(caso, async () => {
      const r = await ejecutar(oc.validar.execute({ caso }, ctx()))
      expect(r.ok).toBe(true)
      expect(r.data?.apta).toBe(e.apta)
      expect(codigos(r.data?.bloqueos)).toEqual(e.bloqueos)
      expect(codigos(r.data?.confirmaciones)).toEqual(e.confirmaciones)
      expect(r.data?.retroactiva).toBe(e.retroactiva)
    })
  }
  test("sol-006 deriva IVA y condiciones de pago del proveedor identificado por nombre", async () => {
    const r = await ejecutar(oc.validar.execute({ caso: "sol-006" }, ctx()))
    expect(r.data?.derivados).toMatchObject({ proveedor: { identificado_por: "nombre" }, indicador_iva: { valor: "C1" }, condiciones_pago: { valor: "Z030" } })
  })
})

describe("creación de OC", () => {
  test("sol-001 se crea con 4500000001 y es idempotente", async () => {
    const a = await ejecutar(oc.crear.execute({ caso: "sol-001" }, ctx()))
    const b = await ejecutar(oc.crear.execute({ caso: "sol-001" }, ctx()))
    expect(a.data).toMatchObject({ numero_oc: "4500000001", idempotente: false })
    expect(b.data).toMatchObject({ numero_oc: "4500000001", idempotente: true })
  })
  test("dos creaciones simultáneas no duplican la OC", async () => {
    const [a, b] = await Promise.all([ejecutar(oc.crear.execute({ caso: "sol-001" }, ctx())), ejecutar(oc.crear.execute({ caso: "sol-001" }, ctx()))])
    expect(a.data?.numero_oc).toBe(b.data?.numero_oc)
    const lineas = (await Bun.file(join(dir, "out", "sap", "ordenes.jsonl")).text()).trim().split("\n")
    expect(lineas.length).toBe(1)
  })
  test("sol-004 queda pendiente sin confirmación y se crea con confirmado=true", async () => {
    expect((await ejecutar(oc.crear.execute({ caso: "sol-004" }, ctx()))).estado).toBe("pendiente_confirmacion")
    const c = await ejecutar(oc.crear.execute({ caso: "sol-004", confirmado: true }, ctx()))
    expect(c.ok).toBe(true)
  })
  test("sol-002 y sol-003 nunca se crean, ni con confirmado=true", async () => {
    for (const caso of ["sol-002", "sol-003"]) {
      expect((await ejecutar(oc.crear.execute({ caso, confirmado: true }, ctx()))).estado).toBe("bloqueada")
    }
  })
  test("un payload alterado por el modelo se rechaza por integridad", async () => {
    const p = await ejecutar(oc.construir_payload.execute({ caso: "sol-001" }, ctx()))
    const orden = structuredClone(p.data?.orden) as { posiciones: Array<{ precio_unitario: number }> }
    const pos = orden.posiciones[0]
    if (pos) pos.precio_unitario = 1
    const c = await ejecutar(oc.crear.execute({ caso: "sol-001", payload: orden }, ctx()))
    expect(c.estado).toBe("rechazada_integridad")
  })
  test("control.csv registra retroactiva=true para sol-005", async () => {
    await oc.crear.execute({ caso: "sol-005", confirmado: true }, ctx())
    const csv = await Bun.file(join(dir, "out", "control.csv")).text()
    expect(csv).toContain("SOL-2026-005,creada,4500000001,true,,RC8,")
  })
})

describe("errores legibles (HU-6)", () => {
  test("path traversal", async () => {
    expect((await ejecutar(oc.leer_paquete.execute({ caso: "../maestros" }, ctx()))).ok).toBe(false)
  })
  test("JSON malformado y monto no numérico", async () => {
    const base = join(dir, "fixtures", "reto-03", "solicitudes", "sol-001", "solicitud.json")
    await writeFile(base, "{ esto no es json")
    expect((await ejecutar(oc.leer_paquete.execute({ caso: "sol-001" }, ctx()))).error).toContain("no es un JSON válido")
    await writeFile(base, JSON.stringify({ ...(await Bun.file(join(import.meta.dir, "..", "fixtures", "reto-03", "solicitudes", "sol-001", "solicitud.json")).json()), valor_total: "once millones" }))
    expect((await ejecutar(oc.leer_paquete.execute({ caso: "sol-001" }, ctx()))).error).toContain("valor_total")
  })
  test("adjunto ausente se reporta como null con su nombre", async () => {
    await rm(join(dir, "fixtures", "reto-03", "solicitudes", "sol-001", "cotizacion.txt"))
    const r = await ejecutar(oc.leer_paquete.execute({ caso: "sol-001" }, ctx()))
    expect(r.data?.cotizacion).toBeNull()
    expect(r.data?.faltantes).toContain("cotizacion (cotizacion.pdf)")
  })
})

describe("compuerta de confirmación humana (CA3) con LLM falso", () => {
  /** LLM guionado: devuelve respuestas en orden, ignorando el contenido. */
  class Guion implements ProveedorLLM {
    readonly nombre = "falso"
    readonly modelo = "guion"
    constructor(private readonly pasos: RespuestaLLM[]) {}
    async enviar(): Promise<RespuestaLLM> {
      return this.pasos.shift() ?? { texto: "fin", llamadas: [], uso: { entrada: 0, salida: 0 } }
    }
  }
  const llamada = (id: string, nombre: string, argumentos: Record<string, unknown>): LlamadaHerramienta => ({ id, nombre, argumentos })
  const paso = (llamadas: LlamadaHerramienta[], texto = ""): RespuestaLLM => ({ texto, llamadas, uso: { entrada: 10, salida: 5 } })

  test("el modelo no puede autoconfirmar; el usuario sí", async () => {
    const proveedor = new Guion([
      paso([llamada("1", "oc_validar", { caso: "sol-004" })]),
      paso([llamada("2", "oc_crear", { caso: "sol-004", confirmado: true })]), // intento de autoconfirmación
      paso([], "¿Confirmas?"),
      paso([llamada("3", "oc_crear", { caso: "sol-004", confirmado: true })]), // turno 2, tras "sí, confirmo"
      paso([], "OC creada"),
    ])
    const deps: DependenciasAgente = { proveedor, sistema: "test", directory: dir, maxIteraciones: 5, maxTokensSesion: 10_000 }
    const s = new AlmacenSesiones(5).obtenerOCrear()

    const t1 = await ejecutarTurno(deps, s, "Procesa sol-004 y no la crees hasta que yo confirme")
    expect(t1.toolCalls[1]?.compuerta).toBe(true)
    expect(t1.needsConfirmation).toBe(true)
    expect(await Bun.file(join(dir, "out", "sap", "ordenes.jsonl")).exists()).toBe(false)

    const t2 = await ejecutarTurno(deps, s, "Sí, confirmo")
    expect(t2.toolCalls[0]?.compuerta).toBe(false)
    expect(t2.toolCalls[0]?.resumen).toContain("4500000001")
    expect(t2.needsConfirmation).toBe(false)
  })

  test("tope de iteraciones por turno", async () => {
    const infinito: ProveedorLLM = { nombre: "x", modelo: "x", enviar: async () => paso([llamada("x", "oc_leer_paquete", { caso: "sol-001" })]) }
    const s = new AlmacenSesiones(5).obtenerOCrear()
    const r = await ejecutarTurno({ proveedor: infinito, sistema: "", directory: dir, maxIteraciones: 3, maxTokensSesion: 10_000 }, s, "hola")
    expect(r.toolCalls.length).toBe(3)
    expect(r.reply).toContain("tope de 3 iteraciones")
  })

  test("argumentos inválidos vuelven al modelo como error, sin ejecutar", async () => {
    const proveedor = new Guion([paso([llamada("1", "oc_validar", { caso: 123 })])])
    const s = new AlmacenSesiones(5).obtenerOCrear()
    const r = await ejecutarTurno({ proveedor, sistema: "", directory: dir, maxIteraciones: 3, maxTokensSesion: 10_000 }, s, "x")
    expect(r.toolCalls[0]?.ok).toBe(false)
    expect(r.toolCalls[0]?.resumen).toContain("Argumentos inválidos")
  })
})

describe("piezas puras", () => {
  test("detección de confirmación", () => {
    const p = new Set(["sol-004", "sol-005"])
    expect([...casosConfirmados("Sí, confirmo", p)]).toEqual(["sol-004", "sol-005"])
    expect([...casosConfirmados("confirmo sol-005", p)]).toEqual(["sol-005"])
    expect(casosConfirmados("no la crees todavía", p).size).toBe(0)
    expect(casosConfirmados("muéstrame la OC", p).size).toBe(0)
  })
  test("formato Anthropic une resultados de herramientas y mensajes de usuario consecutivos", () => {
    const { messages } = aFormatoAnthropic([
      { rol: "usuario", texto: "a" },
      { rol: "asistente", texto: "", llamadas: [{ id: "1", nombre: "oc_validar", argumentos: {} }] },
      { rol: "herramienta", llamadaId: "1", nombre: "oc_validar", resultado: "{}" },
      { rol: "usuario", texto: "b" },
    ])
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"])
    expect(messages[2]?.content.length).toBe(2)
  })
})

describe("módulo reutilizable (bonus)", () => {
  test("modulo/ es idéntico a lo generado desde las fuentes de la app", async () => {
    const { contenidoModulo } = await import("../scripts/build-modulo")
    for (const [ruta, contenido] of Object.entries(await contenidoModulo())) {
      expect(await Bun.file(join(import.meta.dir, "..", "modulo", ruta)).text()).toBe(contenido)
    }
  })
  test("las herramientas del módulo son las mismas instancias que usa la app", async () => {
    const modulo = await import("../modulo/tools/oc")
    expect(modulo.validar).toBe(oc.validar)
    expect(modulo.crear).toBe(oc.crear)
  })
})
