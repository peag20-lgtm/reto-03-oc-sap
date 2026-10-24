// Configuración desde variables de entorno (validada). Las claves NUNCA salen de este objeto hacia el front o los logs.
import { z } from "zod"

const Esquema = z.object({
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default(""),
  MAX_ITERACIONES: z.coerce.number().int().min(1).max(50).default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().min(1000).default(300_000),
  MAX_TOKENS_RESPUESTA: z.coerce.number().int().min(256).default(2048),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60_000),
  MAX_SESIONES: z.coerce.number().int().min(1).default(200),
  MAX_LARGO_MENSAJE: z.coerce.number().int().min(100).default(4000),
  PORT: z.coerce.number().int().default(3000),
  APP_ACCESS_KEY: z.string().default(""),
})

export type Config = z.infer<typeof Esquema> & { modelo: string }

const MODELO_POR_DEFECTO = { anthropic: "claude-sonnet-5-5", openai: "gpt-5-mini" } as const

export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  // Variables vacías = no definidas (así .env.example con "CLAVE=" no rompe los defaults)
  const limpio = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""))
  const c = Esquema.parse(limpio)
  return { ...c, modelo: c.LLM_MODEL ?? MODELO_POR_DEFECTO[c.LLM_PROVIDER] }
}
