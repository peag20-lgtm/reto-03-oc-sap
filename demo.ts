// demo.ts — ejecuta las herramientas SIN modelo de lenguaje sobre los 6 casos (PRD 6.6).
// Uso: bun install && bun run demo.ts
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import * as oc from "./src/tools/oc"

const ctx = { directory: import.meta.dir, sessionId: "demo" }
type Hallazgo = { codigo: string; detalle: string }
type Respuesta = { ok: boolean; error?: string; estado?: string; data?: Record<string, unknown> }

const llamar = async (texto: Promise<string>): Promise<Respuesta> => JSON.parse(await texto) as Respuesta
const lista = (v: unknown): string => (Array.isArray(v) && v.length ? (v as Hallazgo[]).map((h) => h.codigo).join(", ") : "—")
const linea = (t = "") => console.log(t)

async function procesar(caso: string, confirmado = false): Promise<void> {
  const v = await llamar(oc.validar.execute({ caso }, ctx))
  if (!v.ok || !v.data) {
    linea(`  ✘ ${v.error}`)
    return
  }
  const d = v.data
  linea(`  apta=${String(d.apta)} · bloqueos: ${lista(d.bloqueos)} · confirmaciones: ${lista(d.confirmaciones)} · retroactiva=${String(d.retroactiva)}`)
  for (const h of [...(d.bloqueos as Hallazgo[]), ...(d.confirmaciones as Hallazgo[])]) linea(`    · ${h.codigo}: ${h.detalle}`)
  const derivados = d.derivados as Record<string, { valor?: string; fuente?: string }>
  for (const k of ["indicador_iva", "condiciones_pago"]) {
    const x = derivados[k]
    if (x?.valor) linea(`    ℹ derivado ${k} = ${x.valor} (${x.fuente})`)
  }
  if (d.apta) {
    const p = await llamar(oc.construir_payload.execute({ caso }, ctx))
    linea(p.ok ? `  payload ✔ → ${String(p.data?.ruta_payload)} · trazabilidad ${String(p.data?.ruta_trazabilidad)}` : `  payload ✘ ${p.error}`)
  }
  const c = await llamar(oc.crear.execute({ caso, confirmado }, ctx))
  if (c.ok && c.data) {
    linea(`  ➜ OC ${String(c.data.numero_oc)}${c.data.idempotente ? " (idempotente: ya existía)" : " creada"}${c.data.evidencia ? ` · evidencia ${String(c.data.evidencia)}` : ""}`)
  } else {
    linea(`  ➜ NO creada [${c.estado}]: ${c.error}`)
  }
}

await rm(join(ctx.directory, "out"), { recursive: true, force: true }) // determinismo: out/ limpio
const casos = (await readdir(join(ctx.directory, "fixtures", "reto-03", "solicitudes"))).sort()

linea("════ 1) Primera pasada: los 6 casos sin confirmación humana ════")
for (const caso of casos) {
  linea(`\n▶ ${caso}`)
  await procesar(caso)
}

linea("\n════ 2) Idempotencia: sol-001 por segunda vez ════")
await procesar("sol-001")

linea("\n════ 3) Confirmación humana explícita (confirmado = true) ════")
for (const caso of ["sol-004", "sol-005", "sol-006"]) {
  linea(`\n▶ ${caso} · la analista confirma`)
  await procesar(caso, true)
}

linea("\n════ 4) Manejo de errores ════")
linea(`  caso inexistente  → ${(await llamar(oc.leer_paquete.execute({ caso: "sol-999" }, ctx))).error}`)
linea(`  path traversal    → ${(await llamar(oc.leer_paquete.execute({ caso: "../maestros" }, ctx))).error}`)

const control = await Bun.file(join(ctx.directory, "out", "control.csv")).text()
linea("\n════ out/control.csv ════")
linea(control.trim())
