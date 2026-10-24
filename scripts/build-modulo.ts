// Genera modulo/ (bonus 9.4) DESDE las mismas fuentes que usa la aplicación: no hay copias que mantener a mano.
//   bun run modulo          → (re)genera modulo/
//   bun run modulo --check  → falla si modulo/ está desactualizado respecto a las fuentes
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { RUTA_CONOCIMIENTO, RUTA_PROMPT } from "../src/agent/prompt"

const RAIZ = join(import.meta.dir, "..")

export async function contenidoModulo(): Promise<Record<string, string>> {
  const prompt = await readFile(join(RAIZ, RUTA_PROMPT), "utf8")
  const conocimiento = await readFile(join(RAIZ, RUTA_CONOCIMIENTO), "utf8")
  const aviso = "<!-- GENERADO por scripts/build-modulo.ts. No editar: modificar la fuente y ejecutar `bun run modulo`. -->"
  return {
    "agent.md": [
      "---",
      "description: Prepara, valida (RC1–RC10) y crea órdenes de compra en SAP a partir del paquete de correo, con confirmación humana para las excepciones.",
      "mode: primary",
      "permission:",
      "  edit: deny",
      "  bash: deny",
      "---",
      aviso,
      `<!-- fuente: ${RUTA_PROMPT.replaceAll("\\", "/")} -->`,
      "",
      prompt.trim(),
      "",
    ].join("\n"),
    "skill/ordenes-compra/SKILL.md": [
      "---",
      "name: ordenes-compra",
      "description: Conocimiento del proceso de órdenes de compra de Periferia — reglas de control RC1–RC10, códigos SAP de IVA y pago, OC retroactivas y señales de alerta. Úsalo al procesar o explicar una solicitud de compra.",
      "---",
      aviso,
      `<!-- fuente: ${RUTA_CONOCIMIENTO.replaceAll("\\", "/")} -->`,
      "",
      conocimiento.trim(),
      "",
    ].join("\n"),
    "tools/oc.ts": [
      "// GENERADO por scripts/build-modulo.ts. Mismas herramientas que la aplicación, importables sin el servidor.",
      "// Contrato: { description, args (zod), execute(args, { directory, sessionId }) → string JSON }.",
      "// Nombres expuestos al modelo: oc_leer_paquete, oc_validar, oc_generar_evidencia, oc_construir_payload, oc_crear.",
      'export { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "../../src/tools/oc"',
      "",
    ].join("\n"),
  }
}

if (import.meta.main) {
  const verificar = process.argv.includes("--check")
  const desactualizados: string[] = []
  for (const [ruta, contenido] of Object.entries(await contenidoModulo())) {
    const destino = join(RAIZ, "modulo", ruta)
    if (verificar) {
      const actual = await readFile(destino, "utf8").catch(() => "")
      if (actual !== contenido) desactualizados.push(ruta)
      continue
    }
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, "utf8")
    console.log(`✔ modulo/${ruta}`)
  }
  if (verificar && desactualizados.length > 0) {
    console.error(`modulo/ desactualizado: ${desactualizados.join(", ")}. Ejecuta: bun run modulo`)
    process.exit(1)
  }
  if (verificar) console.log("✔ modulo/ coincide con las fuentes")
}
