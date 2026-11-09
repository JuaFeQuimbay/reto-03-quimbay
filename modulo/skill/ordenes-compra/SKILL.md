---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia - reglas de control RC1–RC10, cómo resolver cada bloqueo, OC retroactivas y códigos SAP (IVA, condiciones de pago, unidades)
---

## El proceso de compra (procure-to-pay)

El orden correcto es: **cotización → solicitud → aprobación del líder → orden de compra (OC) → compra → factura → pago**. La OC es el control que autoriza el gasto *antes* de comprometerlo con el proveedor; contabilidad no paga una factura sin OC.

Cada compra llega a administración por correo con tres piezas: la solicitud (Excel), la cotización del proveedor y el correo de aprobación del líder. La analista crea la OC en SAP y adjunta la aprobación como evidencia.

## Actores

| Actor | Rol |
|---|---|
| Solicitante | Necesita la compra y envía el paquete por correo |
| Líder aprobador | Aprueba respondiendo "Aprobado"; solo puede aprobar en sus centros de costo y hasta su tope |
| Analista administrativa | Usa este agente; confirma las excepciones |
| Contabilidad / Auditoría | Consume `out/control.csv` |
| Datos Maestros | Crea y activa proveedores en SAP |

## Reglas de control

| Regla | Qué verifica | Tipo |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y está activo | Bloqueo |
| RC2 | La aprobación existe, dice "Aprobado" y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | El monto no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subárea pertenece al centro de costo | Bloqueo |
| RC5 | Cotización y solicitud no difieren más de 2 % | Confirmación |
| RC6 | Indicador de IVA informado; si falta se deriva del proveedor | Confirmación + derivado |
| RC7 | Condiciones de pago informadas; si faltan se derivan del proveedor | Derivado (solo informa) |
| RC8 | Factura anterior a la solicitud ⇒ OC **retroactiva** | Confirmación |
| RC9 | La aprobación no es anterior a la solicitud | Confirmación |
| RC10 | Cantidad × valor unitario = valor total (± 1) | Bloqueo |

- **Bloqueo**: no se crea la OC; se devuelve la razón y la acción sugerida.
- **Confirmación**: la OC solo se crea si la analista confirma explícitamente.
- **Derivado**: el valor se completa desde el maestro y se informa.

## Cómo resolver cada bloqueo

| Situación | Acción que se sugiere |
|---|---|
| Proveedor inexistente | Pedir a Datos Maestros que lo cree en SAP (RUT, certificación bancaria) y reprocesar |
| Proveedor inactivo | Validar con Datos Maestros si se reactiva o elegir otro proveedor |
| Aprobador no autorizado en el centro | Pedir la aprobación a un aprobador del centro; si el correo sugiere otro centro de costo, verificar con el solicitante si el centro está mal |
| Monto sobre el tope | Escalar a un aprobador con tope suficiente o a un nivel superior |
| Subárea o centro inválido | Corregir la solicitud |
| Aritmética no cuadra | Pedir al solicitante corregir cantidad, valor unitario o total |

## OC retroactivas

Una OC es **retroactiva** cuando la factura es anterior a la solicitud: la compra ocurrió antes de que existiera la autorización. No se bloquea (la factura ya existe y hay que pagarla), pero requiere confirmación y queda marcada `retroactiva = true` en `out/control.csv` para que la dirección mida qué porcentaje de OC se crean así. La política (tolerar con marca o rechazar) la decide la dirección; el agente mide.

## Datos de la OC en SAP

- Sociedad y organización de compras: `1000`.
- Descripción de la posición: máximo 40 caracteres (texto breve de SAP); la original queda en la trazabilidad.
- Unidad: `H` (horas), `MES` (mensual), `UN` (resto).
- Precio unitario: el de la cotización cuando trae un único ítem con la misma cantidad (es lo que se facturará); si no, el de la solicitud. Los precios incluyen IVA.
- Indicadores de IVA: `C0` excluido (0 %), `C1` IVA 19 %, `C2` IVA 5 %.
- Condiciones de pago: `Z000` inmediato, `Z015` 15 días, `Z030` 30 días, `Z060` 60 días.
- Numeración de OC desde `4500000001`; crear dos veces la misma solicitud devuelve el mismo número.
- Cada valor de la OC queda trazado a su fuente en `out/<caso>/trazabilidad.json`; la evidencia de aprobación queda en `out/<caso>/aprobacion.txt` con su sha256.
