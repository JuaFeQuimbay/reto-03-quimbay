# SOLUCION.md · Reto 03 "Órdenes de Compra SAP"

> Candidato: Juan Felipe Quimbay · Link de prueba: https://reto-03-quimbay.onrender.com · Repositorio: https://github.com/JuaFeQuimbay/reto-03-quimbay

## 1. Problema en una frase

Cada compra de Periferia termina en una analista digitando a mano en SAP una orden de compra a partir de tres correos, validando de memoria si quien aprobó podía aprobar ese monto en ese centro; le duele a la analista (tiempo y errores que se descubren en el cierre contable), a contabilidad y auditoría (control no sistemático) y a la dirección (no sabe cuántas OC se crean después de la factura).

## 2. Arquitectura

```
┌──────────────────────┐   POST /api/chat    ┌──────────────────────────────────────────────────┐
│  web/  (HTML plano)  │ ──────────────────▶ │  src/server.ts                                    │
│  · historial         │ ◀────────────────── │  · valida la petición (zod), límites por IP,      │
│  · tool calls        │   reply, toolCalls, │    sesión en memoria                               │
│  · banner "confirma" │   needsConfirmation │                                                    │
└──────────────────────┘                     │  src/agent/ciclo.ts  ──── bucle del agente ─────┐ │
                                             │   1. envía prompt + herramientas + historial     │ │
        ┌─ COMPORTAMIENTO ─────────────┐     │   2. el modelo pide herramientas                 │ │
        │ agent/prompt.md              │────▶│   3. compuerta CA3 · ejecuta · registra          │ │
        └──────────────────────────────┘     │   4. repite hasta respuesta o tope (25)          │ │
        ┌─ CONOCIMIENTO ───────────────┐     │                                                  │ │
        │ src/knowledge/               │────▶│  src/llm/adapter.ts  (interfaz ProveedorLLM)     │ │
        │   ordenes-compra.md          │     │   ├─ anthropic.ts  (Claude, SDK oficial)         │ │
        └──────────────────────────────┘     │   └─ simulado.ts   (guion sin costo)             │ │
        ┌─ EJECUCIÓN ──────────────────┐     │                                                  │ │
        │ src/tools/oc.ts  (zod)       │◀────│  src/tools/index.ts  valida args · log.jsonl     │ │
        │   oc_leer_paquete            │     └──────────────────────────────────────────────────┘ │
        │   oc_validar                 │                                                          │
        │   oc_construir_payload       │      src/domain/   reglas RC1–RC10, parseo, payload,     │
        │   oc_generar_evidencia       │─────▶             evidencia, control.csv                 │
        │   oc_crear                   │      src/sap/      SapAdapter → mock (out/sap/)          │
        └──────────────────────────────┘                                                          │
                 │ lee                                │ escribe                                   │
        fixtures/reto-03/ (solo lectura)       out/<caso>/…, out/sap/ordenes.jsonl,                │
                                               out/control.csv, out/log.jsonl                     │
```

La separación que pide el PRD está en tres lugares distintos: el **comportamiento** vive en `agent/prompt.md` (qué hacer, en qué orden, cuándo preguntar), el **conocimiento** en `src/knowledge/ordenes-compra.md` (qué es cada regla, cómo resolver cada bloqueo, códigos SAP) y la **ejecución** en `src/tools/` sobre `src/domain/`. El servidor no conoce ninguna regla de negocio: cambiar la tolerancia de RC5 toca `src/domain/reglas.ts` y una línea del conocimiento, nada más. `demo.ts` y el agente ejecutan las herramientas por el mismo camino (`ejecutarHerramienta`), así que lo que verifica la demo es lo que corre en producción.

### Decisiones de arquitectura

El principio que ordena todo lo demás: **la IA orquesta y conversa; el código decide.** El modelo de lenguaje nunca determina si una OC cumple los controles ni qué valores lleva; eso lo hacen funciones deterministas que se pueden probar sin modelo. De ahí se desprenden las decisiones concretas (los trade-offs y alternativas descartadas están en la sección 8):

1. **Capas con dependencias en una sola dirección.** `src/domain/` es lógica de negocio pura (reglas, parseo, payload, evidencia) sin HTTP, sin IA y sin conocer herramientas; `src/tools/` envuelve el dominio en el contrato del PRD; `src/agent/` orquesta herramientas y modelo; `src/llm/` y `src/sap/` son adaptadores detrás de interfaces; `src/server.ts` solo expone HTTP. Nada de abajo importa nada de arriba. Por eso `demo.ts` importa `src/tools/` sin arrastrar el servidor, y `modulo/` puede re-exportar las herramientas tal cual.

2. **Las herramientas son la única fuente de verdad y releen la fuente.** Cada herramienta recibe `caso` y vuelve a leer los archivos; el modelo no transporta datos entre herramientas. Si envía `paquete`, `derivados` o `payload` (argumentos opcionales por el contrato del PRD), se comparan con lo calculado desde la fuente y se rechazan si difieren. Esto hace innecesaria la regla CA2 en vez de solo prohibirla en el prompt.

3. **Cada regla de control es una función pura que devuelve una `Evaluacion`** (`ok | bloqueo | confirmacion | derivado | no_aplica`, mensaje, acción sugerida, valores). `oc_validar` solo las agrega. Agregar una RC11 es escribir una función y añadirla a la lista; la misma estructura alimenta el `control.csv`, el front y la respuesta del modelo.

4. **La confirmación humana se hace cumplir en código, en tres capas** (prompt → compuerta del ciclo → revalidación en `oc_crear`), descritas en la sección 3. La seguridad del sistema no depende de que el modelo obedezca.

5. **Dos interfaces de adaptador, `ProveedorLLM` y `SapAdapter`.** El ciclo habla con el modelo mediante un historial neutral (`Mensaje[]`) y las herramientas hablan con SAP mediante la interfaz del PRD. Cambiar de proveedor de IA o pasar del mock a OData es agregar una implementación, no tocar el ciclo ni las herramientas. El proveedor simulado es una implementación más de `ProveedorLLM`, lo que permite probar ciclo y front sin clave ni costo y degradar con gracia si la clave falta.

6. **Comportamiento y conocimiento como archivos Markdown con frontmatter**, no como cadenas en código. La aplicación los carga quitando el frontmatter; `modulo/` los espeja byte a byte y `bun run modulo:check` falla si divergen. Una sola fuente de verdad para la app y para el módulo reutilizable.

7. **Contrato uniforme `{ ok, data } | { ok: false, error }` y "nunca lanzar"** en todo el dominio y las herramientas (`seguro()` convierte cualquier excepción en error tipado). Un caso malo no tumba el siguiente y el modelo siempre recibe algo que puede explicar.

8. **Sin base de datos: archivos en `out/` con escritura serializada.** Una cola (`enSerie`) garantiza que dos sesiones concurrentes no corrompan `control.csv` ni `ordenes.jsonl`, y que buscar-y-crear en el SAP simulado sea atómico (dos llamadas simultáneas no crean dos OC).

9. **Un solo proceso sirve API y front**, con el front en HTML plano. Un despliegue, un comando (`bun run dev`), sin paso de compilación.

10. **Trazabilidad como dato de primera clase.** Cada valor de la OC lleva su fuente (`solicitud`, `cotizacion`, `maestro.<x>`, `derivado`) en `trazabilidad.json`; cada llamada a herramienta queda en `log.jsonl`; cada intento en `control.csv`. Auditar no requiere leer la conversación.

## 3. Ciclo del agente

El bucle está en `src/agent/ciclo.ts` (`ejecutarTurno`). Por turno:

1. Se verifica el tope de tokens de la sesión y el presupuesto global del servidor; si se agotaron, se responde sin llamar al modelo.
2. Se agrega el mensaje del usuario al historial neutral (`Mensaje[]`, independiente del proveedor) y se anota si ese mensaje **confirma** algo que estaba pendiente.
3. Hasta `MAX_ITERACIONES` (25) veces: se envía `{ sistema, mensajes, herramientas }` al `ProveedorLLM`. Si el modelo devuelve texto sin llamadas, el turno termina. Si pide herramientas, cada llamada pasa por la **compuerta**, se ejecuta, se registra en `out/log.jsonl` y se devuelve como `tool_result`; luego se vuelve a llamar al modelo con todo el historial.
4. Si se alcanza el tope, el agente responde con lo que alcanzó a hacer (lista de llamadas) y lo que falta (CA1).

**Confirmación humana (CA3) en tres capas.** El prompt ordena no poner `confirmado: true` sin que el usuario confirme; pero un modelo puede equivocarse, así que la regla también está en código. La compuerta (`violaCompuerta`) deja pasar `confirmado: true` solo si (a) la sesión tenía una confirmación pendiente para ese mismo caso y (b) el último mensaje del usuario es una confirmación explícita ("confirmo", "sí, créala"; nunca si contiene una negación). Si no se cumple, el flag se **anula** (no se rechaza la llamada): `oc_crear` recibe `confirmado: false` y decide por su cuenta: crea si el caso no tenía confirmaciones, o responde "requiere confirmación humana" si las tenía. La tercera capa es `oc_crear` mismo, que revalida RC1–RC10 antes de crear, así que ni siquiera un fallo del ciclo puede crear una OC bloqueada. El front resalta el estado con un banner y botones "Confirmo / No, cancelar", y el `toolCall` queda marcado `compuerta: true` cuando la compuerta actuó. Probado con un proveedor "desobediente" que intentó crear sin preguntar, en el mismo turno de la validación, tras un mensaje que no confirmaba y para un caso distinto al confirmado: las cuatro fueron neutralizadas y solo pasó la confirmación legítima.

**Valores solo desde herramientas (CA2).** Las herramientas reciben únicamente `caso` y releen la fuente; `paquete`, `derivados` y `payload` son argumentos opcionales que, si el modelo los envía, se comparan contra lo calculado desde los archivos y se rechazan si difieren. El modelo no tiene por dónde introducir un monto.

**Errores (CA5).** Los errores del proveedor se traducen a `ErrorLLM` con tipo (`timeout`, `autenticacion`, `limite_tasa`, …) y mensaje en lenguaje claro; el turno termina con ese mensaje y la sesión sigue viva. Los errores de herramientas vuelven al modelo como `tool_result` con `is_error`, y el prompt le pide explicarlos y sugerir qué pedir al solicitante.

**Costo acotado.** Tope de iteraciones por turno, tope de tokens por sesión, tope global del proceso, límite de 40 mensajes por IP cada 10 minutos y prompt caching activado (prompt y herramientas son estables y se sirven desde caché a una fracción del precio).

## 4. Elección del modelo

**Proveedor Anthropic, modelo `claude-sonnet-5-5`, esfuerzo `medium`**, a través del SDK oficial y de un adaptador propio (`src/llm/anthropic.ts`) que implementa la interfaz `ProveedorLLM`; cambiar de proveedor es escribir otro archivo como ese.

Por qué Sonnet 5.5: la tarea es orquestar cinco herramientas en un orden fijo, respetar una regla de confirmación y redactar un resumen claro; no requiere razonamiento profundo. Se midió el mismo prompt de ejemplo del PRD con dos modelos:

| Modelo | Respuesta (sol-004, turno 1) | Tokens turno 1 (entrada / salida / caché leído / caché escrito) | Costo caso completo (2 turnos) |
|---|---|---|---|
| `claude-opus-5-5` | 12 s, tabla y pregunta correctas | 8 / 1.102 / 11.322 / 7.038 | ≈ USD 0,07 |
| `claude-sonnet-5-5` | 8 s, igual de correcta, más concisa | 8 / 828 / 11.322 / 7.038 | ≈ USD 0,036 |

Con tarifas vigentes de Sonnet 5.5 (USD 2 / M tokens de entrada, 10 / M de salida, 0,20 / M leídos de caché, 2,50 / M escritos en caché), un caso con confirmación cuesta ≈ USD 0,036 con caché frío y ≈ USD 0,02 con el prompt ya cacheado; un caso bloqueado, ≈ USD 0,01. El prompt completo (comportamiento + conocimiento + 6 definiciones de herramientas) ronda 7.000 tokens y es lo que se cachea. Un presupuesto global de 3.000.000 de tokens en el despliegue equivale a varios cientos de casos.

El adaptador habilita además el respaldo automático del servidor (`fallbacks: "default"`): si el modelo declina por políticas, Anthropic reintenta con otro modelo sin intervención del ciclo.

## 5. Matriz de controles

Todas las reglas son funciones puras en `src/domain/reglas.ts` (una por regla) que reciben el paquete normalizado y los maestros y devuelven una `Evaluacion` con estado `ok | bloqueo | confirmacion | derivado | no_aplica`, mensaje y acción sugerida. `oc_validar` las agrega en `{ apta, bloqueos, confirmaciones, derivados, retroactiva, controles }`.

| Regla | Implementación | Detalle |
|---|---|---|
| RC1 | `rc1` | NIT normalizado (sin puntos ni dígito de verificación); sin NIT, nombre normalizado (sin tildes, puntuación ni razón social). Verifica `activo`. Si la cotización trae NIT y no coincide con el proveedor resuelto, bloquea. Si el NIT no existe pero hay un homónimo, lo sugiere |
| RC2 | `rc2` | Aprobación presente, `esAprobado` (contiene "Aprobado" y no está negado ni rechazado), remitente en `aprobadores` del centro. Si el remitente aprueba en otro centro y el correo menciona una subárea de ese centro, lo sugiere como posible error de centro (sol-003 → CC-3030 / Preventa) |
| RC3 | `rc3` | Monto controlado = máx(solicitud, cotización) ≤ tope del aprobador. Si nadie en el centro tiene tope, bloquea con "escalar"; si otro aprobador del centro sí alcanza, lo nombra |
| RC4 | `rc4` | Subárea ∈ `subareas` del centro (comparación sin tildes ni mayúsculas); centro inexistente también bloquea |
| RC5 | `rc5` | `|cotización − solicitud| / solicitud ≤ 2 %`; si excede, confirmación con ambos valores y el porcentaje; sin cotización legible o con moneda distinta, confirmación |
| RC6 | `rc6` | IVA informado y existente en el maestro → ok (y se contrasta con la tasa de la cotización); ausente → derivado `indicador_iva_default` del proveedor + confirmación |
| RC7 | `rc7` | Condiciones informadas → ok; ausentes → derivado `condiciones_pago_default`, solo informa |
| RC8 | `rc8` | Existe factura y `factura.fecha < fecha_solicitud` → `retroactiva = true`, confirmación con los días de diferencia; se registra en `control.csv` |
| RC9 | `rc9` | Fecha calendario de la aprobación (los 10 primeros caracteres del ISO, respetando la zona del emisor) ≥ `fecha_solicitud`; si no, confirmación |
| RC10 | `rc10` | `|cantidad × valor_unitario − valor_total| ≤ 1` |

Resultado por caso: sol-001 OC creada sin intervención; sol-002 bloqueo RC1; sol-003 bloqueo RC2+RC3; sol-004 confirmación RC5; sol-005 confirmación RC8 y `retroactiva = true`; sol-006 proveedor resuelto por nombre, confirmación RC6 y derivados C1 / Z030.

**La más difícil fue RC3 junto con RC2 en sol-003.** El PRD literal dice "`valor_total` ≤ tope del aprobador", pero en sol-003 el aprobador ni siquiera pertenece al centro: ¿RC3 aplica, no aplica o bloquea? Decidí que RC3 evalúa el centro completo: si ningún aprobador del centro alcanza el monto, bloquea con la acción "escalar", porque conseguir la firma de rtorres no resolvería nada (su tope es 30 M y la compra es de 74 M). También decidí controlar el mayor entre solicitud y cotización, porque la factura llegará por la cotización. Sin esto, sol-004 habría quedado "aprobado por 25 M" con una OC de 26,5 M sin que nadie verificara el tope sobre el valor real.

## 6. Diseño del adaptador SAP real

Hoy `src/sap/mock.ts` implementa `SapAdapter` sobre archivos; las herramientas solo conocen la interfaz, así que la implementación real se agrega en `src/sap/` y se selecciona con `SAP_ADAPTER` sin tocar herramientas ni ciclo.

**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV` expuesta a través de SAP Integration Suite (Cloud Integration + API Management).** La viabilidad de conectarse a SAP no está confirmada, y eso es justamente lo que resuelve una capa intermedia: el agente habla con un endpoint propio y estable (`POST /compras/oc`, `GET /compras/oc?solicitud=…`) y es el iFlow de Integration Suite quien decide si detrás hay OData sobre S/4HANA, un RFC a `BAPI_PO_CREATE1` sobre ECC, o una cola que se procesa cuando SAP esté disponible. Si la conexión directa resulta inviable, el mismo endpoint puede responder con el Plan B sin cambiar una línea del agente. Alternativas descartadas como primera opción: RFC/BAPI directo (requiere conector JCo/NCo, red interna y usuario de sistema en el servidor del agente: más acoplamiento y más superficie de credenciales) y carga por archivo (queda como Plan B).

**Mapeo del payload (7.4) a `A_PurchaseOrder` / `A_PurchaseOrderItem`:**

| Payload | OData | Nota |
|---|---|---|
| `sociedad`, `organizacion_compras` | `CompanyCode`, `PurchasingOrganization` | `PurchaseOrderType = "NB"`; `PurchasingGroup` se deriva del centro de costo (tabla de configuración) |
| `proveedor.codigo_sap` | `Supplier` | Con ceros a la izquierda a 10 posiciones (`0000100234`) |
| `moneda`, `condiciones_pago` | `DocumentCurrency`, `PaymentTerms` | Códigos ya son los de SAP |
| `referencia.solicitud_id` | Campo de referencia del encabezado (p. ej. `CorrespncExternalReference`) o campo de extensión `YY1_SolicitudId_PDH` | Clave de idempotencia |
| `posiciones[].numero`, `descripcion` | `PurchaseOrderItem` (`00010`), `PurchaseOrderItemText` | El límite de 40 caracteres ya se aplica |
| `cantidad`, `unidad` | `OrderQuantity`, `PurchaseOrderQuantityUnit` | `UN → EA`, `H → HUR`, `MES → MON` (ISO) |
| `precio_unitario`, `indicador_iva` | `NetPriceAmount`, `TaxCode` | El precio del paquete incluye IVA; SAP calcula el impuesto desde el código, así que se envía neto: `precio / (1 + tasa)` |
| `centro_costo`, `subarea` | `AccountAssignmentCategory = "K"`, `A_PurOrdAccountAssignment.CostCenter` | La subárea no tiene campo estándar: va a un campo de extensión o al texto de posición |
| `aprobador.*`, `excepciones` | Nota de encabezado (`A_PurchaseOrderNote`) con aprobador, fecha, sha256 y excepciones confirmadas | La evidencia (PDF) se adjunta vía `API_CV_ATTACHMENT_SRV` en un segundo paso |

**Autenticación y credenciales.** El agente se autentica contra API Management con OAuth 2.0 *client credentials*; el `client_secret` vive en el gestor de secretos del hosting y llega como variable de entorno (igual que hoy la clave del modelo). Las credenciales de SAP (usuario técnico o certificado) viven en el *Security Material* de Integration Suite, no en el agente, ni en el prompt, ni en el repositorio. Nada de lo que el modelo ve contiene credenciales: el modelo solo invoca `oc_crear` y la herramienta llama al adaptador.

**Idempotencia y errores parciales.** Antes de crear, `buscarOrdenPorReferencia` consulta por `solicitud_id` (`$filter` sobre el campo de referencia); si existe, se devuelve ese número (como hace hoy el mock). Encabezado y posiciones se envían en un solo *deep insert* dentro de un `$batch` con un *changeset*: SAP los crea todos o ninguno. El adaptador mantiene un registro local (`solicitud_id → pendiente | creada:numero`) que se escribe **antes** de llamar a SAP; ante timeout o respuesta desconocida no se reintenta a ciegas: se consulta por referencia y, si la OC ya existe, se registra el número; si no, se reintenta con espera exponencial. El error parcial típico es "OC creada, adjunto falló": la OC se marca `evidencia_pendiente` y solo se reintenta el adjunto, que es idempotente por nombre de archivo y hash. Nunca se borra una OC desde el agente: si se creó por error, un humano la marca con indicador de borrado.

**Plan B si la conexión no es viable.** El agente ya hace el 80 % del trabajo antes de tocar SAP: valida, construye el payload, genera la evidencia y registra el control. Con un adaptador "archivo", `oc_crear` produce `out/<caso>/oc-me21n.txt` (los campos en el orden de las pestañas de ME21N, listos para pegar) y una fila en `out/sap/carga-masiva.csv` con el formato de la plantilla de importación de OC (o de un *batch input*/LSMW en ECC), y devuelve un número provisional `PROV-<solicitud_id>` que la analista reemplaza al digitar. La idempotencia y el control siguen funcionando igual.

## 7. Lectura del proceso: las OC retroactivas

Lo que le diría a la dirección: en sol-005 la factura es del 10 de agosto y la solicitud del 27; la aprobación dice literalmente "ya llegó la factura, por favor crear la OC para poder radicarla". Esa OC no autorizó nada: el gasto ya estaba comprometido y la cotización se saltó. Cuando eso ocurre, la OC deja de ser un control y pasa a ser un requisito de papeleo para que contabilidad pueda pagar; se pierde la negociación de precio, la verificación del proveedor y del tope de aprobación antes de gastar, y auditoría queda con una evidencia que fue construida hacia atrás. Lo primero que necesita la dirección es el dato, y el agente ya lo produce: `out/control.csv` marca `retroactiva = true` en cada intento, de modo que se puede medir mensualmente el porcentaje de OC retroactivas, el monto que representan y cuántos días pasan entre factura y solicitud, por centro de costo.

Qué cambio propondría, en tres frentes. Primero, una política **"sin OC no hay pago"** con una ventana de excepción explícita: compras urgentes bajo un monto definido pueden formalizarse después, pero con aprobación de un nivel superior al del centro y un código de excepción que quede en la OC; el agente ya pide confirmación y marca el caso, así que la política se implementa cambiando `confirmacion` por `bloqueo` fuera de la ventana. Segundo, atacar la causa: la gente compra primero porque la OC tarda; si el agente reduce el ciclo de horas a minutos, desaparece la excusa. Tercero, para gastos recurrentes como papelería o tóner, acuerdos marco anuales con liberaciones, que eliminan la retroactividad por diseño. Una meta razonable: bajar las retroactivas por debajo del 5 % de las OC en dos trimestres, medido con el mismo `control.csv`.

## 8. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| Reglas de control en código (`src/domain/reglas.ts`) | Dejar que el modelo evalúe las reglas con el conocimiento del prompt | Determinismo y testeabilidad: la misma entrada da la misma salida, `demo.ts` lo prueba sin modelo; además elimina el riesgo de que el modelo "arregle" un monto |
| Las herramientas releen la fuente por `caso` | Pasar `paquete` y `payload` entre herramientas, como sugiere literalmente el PRD | El modelo no puede alterar datos y se gastan menos tokens; los argumentos existen pero son opcionales y se verifican contra la fuente |
| Ciclo del agente propio (~150 líneas) | Framework (Vercel AI SDK, LangChain, Mastra) | El PRD exige un adaptador LLM propio y poder explicar cada línea; un framework esconde justo lo que se evalúa |
| Compuerta que anula `confirmado` | Compuerta que rechaza la llamada completa | La primera versión rechazaba; producía un falso positivo cuando el modelo enviaba el flag en un caso sin confirmaciones (sol-001). Anular el flag y dejar decidir a `oc_crear` es igual de seguro y no confunde al modelo |
| Sonnet 5.5 con esfuerzo `medium` | Opus 5.5 (más capaz) | Medido: misma calidad en esta tarea, 8 s vs 12 s, mitad de costo |
| Front en HTML plano servido por el mismo proceso | React/Vite | Un solo despliegue, sin paso de compilación, 350 líneas; el PRD lo permite |
| Respuesta completa | Streaming de eventos | Más simple y suficiente para turnos de 3–12 s; el PRD lo marca opcional |
| SAP simulado y sesiones en archivos/memoria | SQLite | El PRD descarta la base de datos; una cola de escritura serializada evita carreras entre sesiones |
| Render (plan gratuito, Docker) | Railway | Sin costo; el precio es el arranque en frío de ~1 minuto, documentado |

## 9. Supuestos

1. Los precios de la cotización y de la solicitud **incluyen IVA** (las cotizaciones lo dicen); por eso la OC lleva el precio tal cual y el IVA es un indicador.
2. Cuando la cotización tiene un único ítem con la misma cantidad que la solicitud, el **precio unitario de la OC es el de la cotización** (es lo que se facturará). La diferencia queda en la trazabilidad y, si supera el 2 %, como excepción RC5 confirmada.
3. **RC3 controla el mayor** entre `valor_total` y `cotizacion.total`, y evalúa el centro completo cuando el aprobador no pertenece a él (ver sección 5).
4. "Contiene Aprobado" se interpreta como aprobación explícita **no negada**: "No aprobado" o "rechazado" no cuentan.
5. RC9 compara **fechas calendario** en la zona horaria del emisor (los 10 primeros caracteres del ISO), no instantes UTC.
6. La idempotencia es por `solicitud_id`; dos casos distintos con el mismo `solicitud_id` se consideran la misma solicitud.
7. Sociedad y organización de compras son constantes `1000` (como fija el esquema del PRD).
8. La unidad se infiere de la descripción (`horas → H`, `mensual → MES`, resto `UN`); "12 meses de vigencia" no es `MES`.
9. La descripción de la posición se trunca a 40 caracteres en límite de palabra; la original queda en `trazabilidad.json`.
10. `control.csv` registra una fila por desenlace de intento; un mismo desenlace consecutivo del mismo caso (validación "pendiente" seguida de un `oc_crear` rechazado por lo mismo) no se repite.
11. La confirmación se detecta por palabras clave en el último mensaje del usuario ("confirmo", "sí", "adelante"…) y nunca cuenta si el mensaje contiene una negación; ante la duda, no se crea.
12. Los maestros de los fixtures son completos; en producción se consultan en SAP.

## 10. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete | Hecho | Leer `.xlsx`, `.pdf` y `.eml` reales (`oc_leer_excel` P1 no implementada); hoy los fixtures ya vienen normalizados |
| HU-2 Validar contra maestros y controles | Hecho | Maestros en tiempo real desde SAP; política de retroactivas configurable (confirmación vs. bloqueo) |
| HU-3 Construir el payload | Hecho | Mapeo a la estructura real de la API de SAP (sección 6); soporte multiposición |
| HU-4 Evidencia de aprobación | **Parcial** | P0 (`aprobacion.txt` + sha256) hecho; P1 (PDF) no hecho; en producción, firma digital si auditoría la exige |
| HU-5 Crear la OC en SAP simulado | Hecho | Adaptador real (sección 6); persistencia durable del registro de control |
| HU-6 Manejo de errores | Hecho | Observabilidad (métricas, alertas) sobre `log.jsonl` |
| Front, backend, adaptador LLM, prompt separado | Hecho | Autenticación de usuarios y roles; streaming |
| `demo.ts` | Hecho | Pruebas unitarias por regla además de la prueba de integración |
| Bonus `modulo/` | Hecho | `agent.md` y `SKILL.md` espejan byte a byte la fuente (`bun run modulo:check` lo verifica); `tools/oc.ts` re-exporta las herramientas sin el servidor |

## 11. Uso de IA

Usé **Claude Code** (modelos Claude Opus 5.5 y Claude Fable 5.1) como par de programación durante todo el reto: análisis del PRD y de los fixtures, planeación (un documento de plan preparado en una sesión previa), escritura del código, de `demo.ts`, del prompt y del conocimiento, configuración del despliegue, pruebas contra la API real y redacción de esta documentación y del README. Cada archivo fue revisado y las decisiones de diseño (qué va en código y qué en el prompt, cómo se hace cumplir la confirmación, qué modelo usar, dónde desplegar) las tomé yo con la información que el asistente me dio.

Qué descarté de lo que propuso y por qué: (a) usar Opus 5.5 como modelo por defecto; lo medí contra Sonnet 5.5 con el prompt del PRD y elegí Sonnet por costo y velocidad con la misma calidad; (b) desplegar en Railway, que podía requerir tarjeta; opté por el plan gratuito de Render y acepté el arranque en frío; (c) una compuerta de confirmación que rechazaba la llamada a `oc_crear`; al revisar los casos límite vimos que confundía al modelo en casos sin confirmaciones, y la cambiamos por una que anula el flag; (d) un helper `never()` para un estado "imposible", reemplazado por una verificación explícita más legible; (e) pasar `paquete` y `payload` completos entre herramientas como sugiere el PRD; preferí que cada herramienta relea la fuente y verifique lo que recibe; (f) mover el proyecto fuera de OneDrive por rendimiento de `node_modules`, que no fue necesario.

## 12. Riesgos de llevarlo a producción y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El modelo omite una herramienta o interpreta mal un resultado | Las reglas y la creación no dependen del modelo: `oc_crear` revalida todo; la compuerta no deja pasar confirmaciones no dadas; `demo.ts` y pruebas unitarias por regla en CI |
| Confirmación mal detectada (falso positivo en "sí, pero…") | Botones explícitos en el front, detector conservador que descarta cualquier negación, y a futuro un paso de confirmación estructurado (botón que envía `{confirmar: caso}`) en lugar de texto libre |
| Inyección vía documentos (una cotización con "instrucciones") | El prompt declara los documentos como datos; los valores nunca salen del texto del modelo sino de parsers deterministas; los archivos no se ejecutan |
| Costo descontrolado del modelo | Topes por turno, sesión, servidor e IP; tope de gasto en la consola del proveedor; caché de prompt |
| Datos personales (correos de empleados) en logs y en el proveedor | Minimizar: enviar al modelo solo lo necesario, retención corta de `log.jsonl`, acuerdo de tratamiento de datos con el proveedor o despliegue regional |
| Doble creación en SAP ante reintentos | Registro local escrito antes de llamar, búsqueda por referencia, `$batch` atómico (sección 6) |
| Evidencia insuficiente para auditoría | sha256 ya acompaña la evidencia; agregar PDF firmado y custodia en DMS |
| Hosting gratuito (arranque en frío, disco efímero, reinicios) | Para producción: instancia siempre encendida, `out/` y sesiones en almacenamiento durable |
| Crédito de API con vencimiento | Alertas de saldo; el servicio degrada a modo simulado en lugar de caer |
| Cambios de reglas de negocio | Reglas aisladas en `src/domain/reglas.ts` con conocimiento en Markdown; un cambio no toca servidor ni ciclo |
