# Reto 03 · Agente conversacional "Órdenes de Compra SAP"

Agente que lee el paquete de compra (correo, solicitud, cotización, aprobación y, si existe, factura), lo valida contra los maestros con las reglas RC1–RC10, construye la OC con trazabilidad campo → fuente, genera la evidencia de aprobación (TXT + PDF con sha256) y crea la OC en un SAP simulado. Pide **confirmación humana** para las excepciones y lo hace cumplir **en código**, no solo en el prompt.

Planteamiento completo, decisiones y diseño del adaptador SAP real: **[SOLUCION.md](SOLUCION.md)**.

| | |
|---|---|
| Link de prueba | `https://<tu-servicio>.onrender.com` *(completar tras el despliegue)* |
| Clave de acceso al link | `<APP_ACCESS_KEY>` *(si se configuró; el chat la pide al abrir)* |

## Requisitos

- [Bun](https://bun.sh) 1.3 o superior.
  - Windows (PowerShell): `powershell -c "irm bun.sh/install.ps1 | iex"`
  - macOS/Linux: `curl -fsSL https://bun.sh/install | bash`
- Una clave de un proveedor de modelos (Anthropic por defecto u OpenAI). **Solo** es necesaria para el chat; `demo.ts` y las pruebas no la usan.

## Levantar en local (un comando)

```bash
cp .env.example .env        # en Windows: copy .env.example .env
# edita .env y pon ANTHROPIC_API_KEY (u OPENAI_API_KEY con LLM_PROVIDER=openai)
bun install && bun run dev
```

Abre http://localhost:3000. Bun carga `.env` automáticamente. Si no hay clave, el servidor arranca igual y el chat explica que falta la credencial.

## Verificación sin modelo

```bash
bun run demo.ts      # procesa los 6 casos, muestra idempotencia (sol-001 ×2) y confirmación explícita (sol-004, sol-005, sol-006)
bun test             # 23 pruebas: reglas por caso, idempotencia, integridad, errores, compuerta de confirmación con LLM falso, módulo
bun run typecheck    # TypeScript estricto, sin any
bun run modulo --check   # verifica que modulo/ coincide con las fuentes de la app
```

`demo.ts` limpia `out/` al inicio; dos ejecuciones seguidas producen la misma salida salvo los timestamps.

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` u `openai` |
| `LLM_MODEL` | `claude-sonnet-5-5` / `gpt-5-mini` | Modelo del proveedor |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Clave del proveedor elegido. Solo en el backend |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Endpoint compatible (Azure, local) |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta → modelo por turno |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión (control de costo) |
| `MAX_TOKENS_RESPUESTA` | `2048` | Tokens máximos por respuesta del modelo |
| `LLM_TIMEOUT_MS` | `60000` | Timeout de cada llamada al proveedor |
| `MAX_SESIONES` / `MAX_LARGO_MENSAJE` | `200` / `4000` | Límites de memoria y de entrada |
| `APP_ACCESS_KEY` | — | Si se define, la API exige la cabecera `x-access-key` |
| `PORT` | `3000` | Puerto HTTP |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendientes[], tokens }` |
| `GET` | `/api/sessions/:id` | Historial visible de la sesión (mensajes, llamadas a herramientas, errores) |
| `GET` | `/api/health` | `{ ok, provider, model, llm_configurado, requiere_clave_acceso }`, sin claves |

Cada `toolCalls[i]` trae `{ nombre, argumentos, ok, resumen, compuerta }`; `compuerta = true` indica que el control de confirmación humana detuvo la llamada.

## Salidas en `out/`

| Archivo | Contenido |
|---|---|
| `out/sap/ordenes.jsonl` | OC creadas en el SAP simulado (consecutivo desde 4500000001) |
| `out/control.csv` | Una fila por intento: `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts` |
| `out/log.jsonl` | Toda llamada a herramienta y error del proveedor, con redacción defensiva de secretos |
| `out/<caso>/payload.json` · `trazabilidad.json` | OC como quedaría en SAP y la fuente de cada valor |
| `out/<caso>/aprobacion.txt` · `aprobacion.pdf` | Evidencia de aprobación con sha256 |

## Desplegar (Render, con Docker)

1. Sube el repositorio a GitHub (sin `.env`, `node_modules/` ni `out/`; ya están en `.gitignore`).
2. En Render: **New → Blueprint** y selecciona el repositorio (usa `render.yaml`), o **New → Web Service → Docker**.
3. En *Environment*, define `ANTHROPIC_API_KEY` y, recomendado, `APP_ACCESS_KEY`.
4. Al terminar, verifica `https://<servicio>.onrender.com/api/health` y pega el link arriba.

El plan gratuito de Render "duerme" el servicio tras inactividad; ábrelo un minuto antes de la defensa. `out/` es efímero en ese entorno.

## Estructura

```
agent/prompt.md                 comportamiento (system prompt)
src/knowledge/ordenes-compra.md conocimiento del proceso (se anexa al prompt)
src/tools/oc.ts                 herramientas oc_* (zod) → ejecución
src/oc/                         dominio: paquete, reglas RC1–RC10, payload, evidencia, control, servicio
src/sap/adapter.ts · mock.ts    interfaz SapAdapter y SAP simulado
src/llm/                        interfaz ProveedorLLM + Anthropic + OpenAI
src/agent/                      ciclo del agente, compuerta de confirmación, sesiones, log
src/server.ts                   API HTTP y estáticos
web/                            chat (HTML/JS sin framework; Markdown saneado con DOMPurify)
modulo/                         bonus: agente empaquetado, generado desde las mismas fuentes
demo.ts · tests/                verificación sin modelo
```
