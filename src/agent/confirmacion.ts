// CA3 en código, no solo en el prompt: el servidor decide si el último mensaje del usuario es una confirmación.

const AFIRMATIVO = /\b(s[ií]|confirmo|confirmado|confirmada|procede|proceda|proceder|adelante|autorizo|de acuerdo|cr[eé]ala|cr[eé]alas|aprobado por m[ií])\b/i
const NEGATIVO = /\b(no|cancela|cancelar|cancelo|espera|detente|rechazo|todav[ií]a no|a[uú]n no)\b/i
const CASO = /\bsol-\d{3}\b/gi

/**
 * Devuelve los casos pendientes que este mensaje confirma.
 * - Un mensaje con negación no confirma nada.
 * - Si nombra casos, confirma solo esos; si no nombra ninguno, confirma todos los pendientes.
 */
export function casosConfirmados(mensaje: string, pendientes: ReadonlySet<string>): Set<string> {
  if (pendientes.size === 0 || NEGATIVO.test(mensaje) || !AFIRMATIVO.test(mensaje)) return new Set()
  const nombrados = [...mensaje.matchAll(CASO)].map((m) => m[0].toLowerCase())
  const candidatos = nombrados.length > 0 ? nombrados : [...pendientes]
  return new Set(candidatos.filter((c) => pendientes.has(c)))
}
