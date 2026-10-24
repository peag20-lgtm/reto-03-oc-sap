## Proceso de órdenes de compra (Periferia IT Group)

**Entrada**: correo del solicitante a compras@ con `solicitud.xlsx` (normalizado a JSON), `cotizacion.pdf` (texto), el correo de aprobación del líder y, en algunos casos, `factura.pdf`.
**Salida**: OC en SAP (sociedad 1000, organización de compras 1000) con la evidencia de aprobación adjunta y una fila en el log de control `out/control.csv` para Contabilidad/Auditoría.

### Actores
- **Solicitante**: arma el paquete. No usa el agente.
- **Líder aprobador**: responde "Aprobado". Debe figurar en la matriz de aprobación del centro de costo y su tope debe cubrir el valor.
- **Analista administrativa**: conversa con el agente y confirma excepciones. Es quien queda registrada en `confirmado_por`.
- **Contabilidad/Auditoría**: consume el log de control (incluye la marca `retroactiva`).

### Reglas de control
| Código | Regla | Tipo | Qué hacer si falla |
|---|---|---|---|
| RC1 | Proveedor existe (por NIT; sin NIT, por nombre normalizado) y está activo | Bloqueo | Creación/reactivación del proveedor por Compras con su debida diligencia (RUT, certificación bancaria, SARLAFT), o cambiar a un proveedor registrado. |
| RC2 | Hay aprobación, dice "Aprobado" y la envía un aprobador del centro de costo | Bloqueo | Pedir la aprobación al aprobador correcto del centro; o corregir el centro si el gasto es de otra área. |
| RC3 | Valor total ≤ tope del aprobador en ese centro | Bloqueo | Escalar al aprobador con tope suficiente; si ninguno alcanza, escalar a la instancia superior o ajustar la matriz de atribuciones. **Nunca** fraccionar la compra para quedar bajo el tope. |
| RC4 | La subárea pertenece al centro de costo | Bloqueo | Corregir con el solicitante. |
| RC5 | Cotización vs solicitud: diferencia ≤ 2 %; sin cotización → confirmar | Confirmación | Mostrar ambos valores. La OC se crea por el valor de la solicitud (lo que aprobó el líder); si el proveedor facturará el valor cotizado, lo correcto es pedir aprobación ajustada. |
| RC6 | Sin indicador de IVA → se deriva del proveedor y se confirma | Confirmación + derivado | Confirmar con la analista el código derivado. |
| RC7 | Sin condiciones de pago → se derivan del proveedor | Derivado (informativo) | Solo informar. |
| RC8 | Factura con fecha anterior a la solicitud → OC retroactiva | Confirmación | Crear solo con confirmación; queda `retroactiva = true` en el control. |
| RC9 | Fecha de aprobación ≥ fecha de solicitud | Confirmación | Confirmar que la aprobación corresponde a esta solicitud. |
| RC10 | cantidad × valor unitario = valor total (± 1) | Bloqueo | Pedir al solicitante corregir el Excel. |

### Códigos de referencia
- Indicadores de IVA: C0 excluido/no gravado · C1 IVA 19 % · C2 IVA 5 %.
- Condiciones de pago: Z000 inmediato · Z015 15 días · Z030 30 días · Z060 60 días (fecha factura).
- Unidades de posición: UN unidad · H hora · MES mes. Texto breve de posición: máximo 40 caracteres.
- Numeración de OC en SAP simulado: consecutiva desde 4500000001. Crear dos veces la misma solicitud devuelve la misma OC.

### Sobre las OC retroactivas
Una OC retroactiva (la factura llegó antes que la solicitud) significa que el compromiso con el proveedor se adquirió **sin** orden previa: se perdió el control preventivo y la aprobación pasó a ser una formalidad posterior al gasto. La política sobre tolerarlas o rechazarlas la define la dirección; el agente las **mide** y las marca, sin juzgar al solicitante.

### Señales de alerta a mencionar si aparecen (no bloquean por sí solas)
- La aprobación menciona un monto distinto al de la cotización.
- Quien solicita es la misma persona que crea la OC o que aprueba (segregación de funciones).
- Varias solicitudes del mismo proveedor y centro, cada una justo debajo del tope (posible fraccionamiento).
- El NIT de la cotización no coincide con el del maestro.
