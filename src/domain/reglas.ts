// HU-2: reglas de control RC1–RC10 (PRD 7.3). Funciones puras: misma entrada → misma salida.
import type {
  Aprobacion,
  CentroCosto,
  CodigoRegla,
  Control,
  Cotizacion,
  Factura,
  Hallazgo,
  Maestros,
  Paquete,
  Proveedor,
  ProveedorResuelto,
  Respuesta,
  Solicitud,
  Validacion,
  ValorDerivado,
} from "./tipos.ts"
import {
  clave,
  diasEntre,
  formatoMoneda,
  formatoPorcentaje,
  normalizarEmail,
  normalizarNit,
  normalizarNombre,
  soloFecha,
} from "./texto.ts"

export const TOLERANCIA_COTIZACION = 0.02
export const TOLERANCIA_ARITMETICA = 1

const DESCRIPCION: Record<CodigoRegla, string> = {
  RC1: "Proveedor existe en el maestro y está activo",
  RC2: "Aprobación válida, de un aprobador del centro de costo",
  RC3: "Monto dentro del tope del aprobador",
  RC4: "Subárea pertenece al centro de costo",
  RC5: "Cotización vs. solicitud dentro del 2 %",
  RC6: "Indicador de IVA informado",
  RC7: "Condiciones de pago informadas",
  RC8: "Factura no anterior a la solicitud (no retroactiva)",
  RC9: "Aprobación no anterior a la solicitud",
  RC10: "Cantidad × valor unitario = valor total",
}

type Entrada = {
  solicitud: Solicitud
  cotizacion: Cotizacion | null
  aprobacion: Aprobacion | null
  factura: Factura | null
  maestros: Maestros
}

type Evaluacion = { control: Control; bloqueo?: Hallazgo; confirmacion?: Hallazgo; derivado?: ValorDerivado }
type Valores = Record<string, string | number | null>

// --- constructores de resultados -------------------------------------------------
function ok(regla: CodigoRegla, detalle: string): Evaluacion {
  return { control: { regla, descripcion: DESCRIPCION[regla], estado: "ok", detalle } }
}
function noAplica(regla: CodigoRegla, detalle: string): Evaluacion {
  return { control: { regla, descripcion: DESCRIPCION[regla], estado: "no_aplica", detalle } }
}
function bloqueo(regla: CodigoRegla, mensaje: string, accion: string, valores?: Valores): Evaluacion {
  return {
    control: { regla, descripcion: DESCRIPCION[regla], estado: "bloqueo", detalle: mensaje },
    bloqueo: { regla, mensaje, accion_sugerida: accion, ...(valores ? { valores } : {}) },
  }
}
function confirmacion(regla: CodigoRegla, mensaje: string, accion: string, valores?: Valores, derivado?: ValorDerivado): Evaluacion {
  return {
    control: { regla, descripcion: DESCRIPCION[regla], estado: "confirmacion", detalle: mensaje },
    confirmacion: { regla, mensaje, accion_sugerida: accion, ...(valores ? { valores } : {}) },
    ...(derivado ? { derivado } : {}),
  }
}

// --- búsquedas en maestros ----------------------------------------------------------
function buscarProveedor(e: Entrada): { proveedor: Proveedor | undefined; criterio: "nit" | "nombre"; buscado: string } {
  const { solicitud, maestros } = e
  if (solicitud.proveedor_nit) {
    const nit = normalizarNit(solicitud.proveedor_nit)
    return { proveedor: maestros.proveedores.find((p) => normalizarNit(p.nit) === nit), criterio: "nit", buscado: nit }
  }
  const nombre = normalizarNombre(solicitud.proveedor_nombre)
  return {
    proveedor: maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre),
    criterio: "nombre",
    buscado: solicitud.proveedor_nombre,
  }
}

function buscarCentro(e: Entrada): CentroCosto | undefined {
  return e.maestros.centrosCosto.find((c) => clave(c.centro_costo) === clave(e.solicitud.centro_costo))
}

function buscarAprobador(centro: CentroCosto | undefined, email: string) {
  return centro?.aprobadores.find((a) => normalizarEmail(a.email) === normalizarEmail(email))
}

/** Monto que debe cubrir el aprobador: el mayor entre solicitud y cotización (la factura llegará por la cotización). */
function montoAControlar(e: Entrada): number {
  return Math.max(e.solicitud.valor_total, e.cotizacion?.total ?? 0)
}

// --- RC1 · proveedor ------------------------------------------------------------------
function rc1(e: Entrada): { evaluacion: Evaluacion; proveedor: Proveedor | null } {
  const { proveedor, criterio, buscado } = buscarProveedor(e)
  const nombre = e.solicitud.proveedor_nombre
  if (!proveedor) {
    const homonimo = e.maestros.proveedores.find((p) => normalizarNombre(p.nombre) === normalizarNombre(nombre))
    const pista = criterio === "nit" && homonimo ? ` Existe "${homonimo.nombre}" con NIT ${homonimo.nit}: verificar si el NIT está mal digitado.` : ""
    return {
      proveedor: null,
      evaluacion: bloqueo(
        "RC1",
        `El proveedor "${nombre}" (${criterio === "nit" ? `NIT ${buscado}` : "sin NIT, buscado por nombre"}) no existe en el maestro de proveedores.${pista}`,
        "Solicitar a Datos Maestros la creación del proveedor en SAP (RUT, certificación bancaria) y reprocesar la solicitud.",
        { proveedor: nombre, nit: criterio === "nit" ? buscado : null },
      ),
    }
  }
  if (!proveedor.activo) {
    return {
      proveedor: null,
      evaluacion: bloqueo(
        "RC1",
        `El proveedor ${proveedor.codigo_sap} "${proveedor.nombre}" está inactivo en SAP.`,
        "Validar con Datos Maestros si se reactiva el proveedor o elegir otro proveedor activo.",
        { codigo_sap: proveedor.codigo_sap },
      ),
    }
  }
  const nitCotizacion = e.cotizacion?.nit ? normalizarNit(e.cotizacion.nit) : null
  if (nitCotizacion && nitCotizacion !== normalizarNit(proveedor.nit)) {
    return {
      proveedor: null,
      evaluacion: bloqueo(
        "RC1",
        `La cotización viene del NIT ${nitCotizacion}, distinto al del proveedor ${proveedor.nombre} (NIT ${proveedor.nit}).`,
        "Pedir al solicitante la cotización del proveedor correcto.",
        { nit_cotizacion: nitCotizacion, nit_proveedor: proveedor.nit },
      ),
    }
  }
  const como = criterio === "nit" ? `por NIT ${proveedor.nit}` : `por nombre normalizado (la solicitud no trae NIT)`
  const cruce = nitCotizacion ? "; el NIT de la cotización coincide" : ""
  return { proveedor, evaluacion: ok("RC1", `${proveedor.codigo_sap} ${proveedor.nombre} encontrado ${como}, activo${cruce}.`) }
}

// --- RC2 · aprobación válida ----------------------------------------------------------
function pistasOtrosCentros(e: Entrada, centro: CentroCosto | undefined, aprobacion: Aprobacion): string[] {
  const texto = clave(aprobacion.texto)
  return e.maestros.centrosCosto
    .filter((c) => c !== centro && buscarAprobador(c, aprobacion.de))
    .flatMap((c) => {
      const aprobador = buscarAprobador(c, aprobacion.de)
      const pistas = [`${aprobacion.de} sí es aprobador de ${c.centro_costo} (${c.nombre}, tope ${formatoMoneda(aprobador?.tope ?? 0)}).`]
      for (const s of c.subareas.filter((s) => texto.includes(clave(s)))) {
        pistas.push(`El correo de aprobación menciona "${s}", subárea de ${c.centro_costo}: verificar con el solicitante si el centro de costo correcto es ${c.centro_costo} / ${s}.`)
      }
      return pistas
    })
}

function rc2(e: Entrada, centro: CentroCosto | undefined): Evaluacion {
  const { aprobacion, solicitud } = e
  const cc = solicitud.centro_costo
  if (!aprobacion) return bloqueo("RC2", "No hay correo de aprobación del líder.", `Solicitar la aprobación por correo a un aprobador de ${cc}.`)
  if (!aprobacion.aprobado) {
    return bloqueo("RC2", `El correo de ${aprobacion.de} no contiene una aprobación explícita ("Aprobado").`, "Pedir al líder una respuesta explícita con la palabra \"Aprobado\".")
  }
  if (!centro) return bloqueo("RC2", `No se puede verificar el aprobador: el centro de costo ${cc} no existe.`, "Corregir el centro de costo de la solicitud.")
  if (buscarAprobador(centro, aprobacion.de)) return ok("RC2", `Aprobado por ${aprobacion.de}, aprobador de ${cc}.`)

  const validos = centro.aprobadores.map((a) => `${a.email} (tope ${formatoMoneda(a.tope)})`).join(", ")
  const pistas = pistasOtrosCentros(e, centro, aprobacion)
  return bloqueo(
    "RC2",
    `${aprobacion.de} no es aprobador de ${cc} (${centro.nombre}). Aprobadores válidos: ${validos}.`,
    [`Solicitar la aprobación a un aprobador de ${cc}.`, ...pistas].join(" "),
    { aprobador: aprobacion.de, centro_costo: cc },
  )
}

// --- RC3 · tope del aprobador ---------------------------------------------------------
function rc3(e: Entrada, centro: CentroCosto | undefined): Evaluacion {
  const { aprobacion, solicitud } = e
  if (!aprobacion || !centro) return noAplica("RC3", "Sin aprobación o centro de costo válido (ver RC2/RC4).")
  const monto = montoAControlar(e)
  const base = monto > solicitud.valor_total ? " (se controla el valor de la cotización, mayor al solicitado)" : ""
  const capaces = centro.aprobadores.filter((a) => a.tope >= monto)
  const escalar = capaces.length
    ? `Solicitar la aprobación a: ${capaces.map((a) => `${a.email} (tope ${formatoMoneda(a.tope)})`).join(", ")}.`
    : `Ningún aprobador de ${centro.centro_costo} tiene tope suficiente: escalar a un nivel superior (p. ej. Gerencia General).`
  const aprobador = buscarAprobador(centro, aprobacion.de)

  if (!aprobador) {
    if (capaces.length) return noAplica("RC3", `No evaluable: el aprobador no pertenece al centro (ver RC2). ${escalar}`)
    const maximo = Math.max(...centro.aprobadores.map((a) => a.tope), 0)
    return bloqueo(
      "RC3",
      `Ningún aprobador de ${centro.centro_costo} tiene tope para ${formatoMoneda(monto)}${base} (tope máximo del centro: ${formatoMoneda(maximo)}).`,
      escalar,
      { monto, tope_maximo_centro: maximo },
    )
  }
  if (monto <= aprobador.tope) return ok("RC3", `${formatoMoneda(monto)} ≤ tope de ${aprobador.email} (${formatoMoneda(aprobador.tope)})${base}.`)
  return bloqueo(
    "RC3",
    `${formatoMoneda(monto)}${base} supera el tope de ${aprobador.email} (${formatoMoneda(aprobador.tope)}).`,
    escalar,
    { monto, tope: aprobador.tope },
  )
}

// --- RC4 · subárea ----------------------------------------------------------------------
function rc4(e: Entrada, centro: CentroCosto | undefined): Evaluacion {
  const { centro_costo, subarea } = e.solicitud
  if (!centro) {
    const existentes = e.maestros.centrosCosto.map((c) => `${c.centro_costo} (${c.nombre})`).join(", ")
    return bloqueo("RC4", `El centro de costo ${centro_costo} no existe.`, `Corregir el centro de costo. Existentes: ${existentes}.`)
  }
  if (centro.subareas.some((s) => clave(s) === clave(subarea))) return ok("RC4", `${subarea} pertenece a ${centro_costo} (${centro.nombre}).`)
  return bloqueo(
    "RC4",
    `La subárea "${subarea}" no pertenece a ${centro_costo}.`,
    `Corregir la subárea. Válidas para ${centro_costo}: ${centro.subareas.join(", ")}.`,
  )
}

// --- RC5 · cotización vs. solicitud ---------------------------------------------------
function rc5(e: Entrada): Evaluacion {
  const { cotizacion, solicitud } = e
  if (!cotizacion) {
    return confirmacion("RC5", "No hay cotización legible para comparar con la solicitud.", "Confirmar la creación sin cotización o pedir la cotización al solicitante.", {
      solicitud: solicitud.valor_total,
      cotizacion: null,
    })
  }
  if (cotizacion.moneda !== solicitud.moneda) {
    return confirmacion("RC5", `La cotización está en ${cotizacion.moneda} y la solicitud en ${solicitud.moneda}.`, "Confirmar la moneda de la OC con el solicitante.")
  }
  const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
  const valores = { solicitud: solicitud.valor_total, cotizacion: cotizacion.total, diferencia_pct: Number((diferencia * 100).toFixed(2)) }
  const comparacion = `cotización ${formatoMoneda(cotizacion.total)} vs. solicitud ${formatoMoneda(solicitud.valor_total)}`
  if (diferencia <= TOLERANCIA_COTIZACION) return ok("RC5", `${comparacion} (diferencia ${formatoPorcentaje(diferencia)}).`)
  return confirmacion(
    "RC5",
    `La ${comparacion} difieren ${formatoPorcentaje(diferencia)} (tolerancia ${formatoPorcentaje(TOLERANCIA_COTIZACION)}).`,
    `Confirmar que la OC se emita por el valor de la cotización (${formatoMoneda(cotizacion.total)}); la aprobación se dio sobre la solicitud (${formatoMoneda(solicitud.valor_total)}). Alternativa: pedir al solicitante ajustar la solicitud y la aprobación.`,
    valores,
  )
}

// --- RC6 · indicador de IVA -------------------------------------------------------------
function rc6(e: Entrada, proveedor: Proveedor | null): Evaluacion {
  const { solicitud, cotizacion, maestros } = e
  const tasaCotizacion = cotizacion?.iva_tasa ?? null
  const describir = (codigo: string) => maestros.indicadoresIva.find((i) => i.codigo === codigo)
  const difiere = (tasa: number) => tasaCotizacion !== null && Math.abs(tasa - tasaCotizacion) >= 1e-9
  const consistencia = (tasa: number) =>
    tasaCotizacion === null ? "" : difiere(tasa) ? `; OJO: la cotización indica IVA ${formatoPorcentaje(tasaCotizacion)}` : "; coincide con la cotización"

  if (solicitud.indicador_iva) {
    const indicador = describir(solicitud.indicador_iva)
    if (indicador && difiere(indicador.tasa)) {
      return confirmacion("RC6", `La solicitud indica ${indicador.codigo} (${indicador.descripcion})${consistencia(indicador.tasa)}.`, "Confirmar el indicador de IVA correcto con el solicitante.")
    }
    if (indicador) return ok("RC6", `${indicador.codigo} (${indicador.descripcion}) informado en la solicitud${consistencia(indicador.tasa)}.`)
  }
  const motivo = solicitud.indicador_iva ? `El indicador de IVA "${solicitud.indicador_iva}" no existe en el maestro` : "La solicitud no informa indicador de IVA"
  if (!proveedor) return confirmacion("RC6", `${motivo} y no hay proveedor válido para derivarlo.`, "Pedir el indicador de IVA al solicitante.")

  const indicador = describir(proveedor.indicador_iva_default)
  const derivado: ValorDerivado = {
    valor: proveedor.indicador_iva_default,
    fuente: "maestro.proveedores",
    detalle: `indicador_iva_default de ${proveedor.nombre}`,
  }
  return confirmacion(
    "RC6",
    `${motivo}; se propone ${derivado.valor} (${indicador?.descripcion ?? "sin descripción"}) desde el maestro de proveedores${indicador ? consistencia(indicador.tasa) : ""}.`,
    `Confirmar el indicador de IVA ${derivado.valor}.`,
    { indicador_iva_propuesto: derivado.valor },
    derivado,
  )
}

// --- RC7 · condiciones de pago ----------------------------------------------------------
function rc7(e: Entrada, proveedor: Proveedor | null): Evaluacion {
  const { solicitud, maestros } = e
  const describir = (codigo: string) => maestros.condicionesPago.find((c) => c.codigo === codigo)
  const informada = solicitud.condiciones_pago ? describir(solicitud.condiciones_pago) : undefined
  if (informada) return ok("RC7", `${informada.codigo} (${informada.descripcion}) informado en la solicitud.`)

  const motivo = solicitud.condiciones_pago ? `El código "${solicitud.condiciones_pago}" no existe en el maestro` : "La solicitud no informa condiciones de pago"
  if (!proveedor) return noAplica("RC7", `${motivo} y no hay proveedor válido para derivarlas.`)
  const condicion = describir(proveedor.condiciones_pago_default)
  const derivado: ValorDerivado = {
    valor: proveedor.condiciones_pago_default,
    fuente: "maestro.proveedores",
    detalle: `condiciones_pago_default de ${proveedor.nombre}`,
  }
  return {
    control: {
      regla: "RC7",
      descripcion: DESCRIPCION.RC7,
      estado: "derivado",
      detalle: `${motivo}; se usa ${derivado.valor} (${condicion?.descripcion ?? "sin descripción"}) del maestro de proveedores.`,
    },
    derivado,
  }
}

// --- RC8 · retroactividad ----------------------------------------------------------------
function esRetroactiva(e: Entrada): boolean {
  return e.factura !== null && e.factura.fecha < e.solicitud.fecha_solicitud
}

function rc8(e: Entrada): Evaluacion {
  const { factura, solicitud } = e
  if (!factura) return ok("RC8", "Sin factura previa: flujo normal (OC antes de factura).")
  if (!esRetroactiva(e)) return ok("RC8", `La factura ${factura.numero} (${factura.fecha}) no es anterior a la solicitud (${solicitud.fecha_solicitud}).`)
  const dias = diasEntre(factura.fecha, solicitud.fecha_solicitud)
  return confirmacion(
    "RC8",
    `OC retroactiva: la factura ${factura.numero} (${factura.fecha}) es ${dias} días anterior a la solicitud (${solicitud.fecha_solicitud}). La compra ocurrió antes de la OC.`,
    "Confirmar la creación; quedará marcada retroactiva = true en el control para la medición de la dirección.",
    { factura: factura.numero, fecha_factura: factura.fecha, fecha_solicitud: solicitud.fecha_solicitud, dias_antes: dias },
  )
}

// --- RC9 · fecha de aprobación ------------------------------------------------------------
function rc9(e: Entrada): Evaluacion {
  const { aprobacion, solicitud } = e
  if (!aprobacion) return noAplica("RC9", "Sin aprobación (ver RC2).")
  const fecha = soloFecha(aprobacion.fecha)
  if (fecha >= solicitud.fecha_solicitud) return ok("RC9", `Aprobación del ${fecha} ≥ solicitud del ${solicitud.fecha_solicitud}.`)
  return confirmacion(
    "RC9",
    `La aprobación (${fecha}) es anterior a la solicitud (${solicitud.fecha_solicitud}).`,
    "Confirmar que la aprobación corresponde a esta solicitud o pedir una aprobación nueva.",
    { fecha_aprobacion: fecha, fecha_solicitud: solicitud.fecha_solicitud },
  )
}

// --- RC10 · aritmética -------------------------------------------------------------------
function rc10(e: Entrada): Evaluacion {
  const { cantidad, valor_unitario, valor_total, moneda } = e.solicitud
  const calculado = cantidad * valor_unitario
  const texto = `${cantidad} × ${formatoMoneda(valor_unitario, moneda)} = ${formatoMoneda(calculado, moneda)}`
  if (Math.abs(calculado - valor_total) <= TOLERANCIA_ARITMETICA) return ok("RC10", `${texto} = valor_total.`)
  return bloqueo("RC10", `${texto}, distinto del valor_total ${formatoMoneda(valor_total, moneda)}.`, "Pedir al solicitante que corrija cantidad, valor unitario o valor total.", {
    calculado,
    valor_total,
  })
}

// --- orquestación ----------------------------------------------------------------------
function resolver(p: Proveedor | null, criterio: "nit" | "nombre"): ProveedorResuelto | null {
  return p ? { codigo_sap: p.codigo_sap, nit: p.nit, nombre: p.nombre, criterio } : null
}

export function validar(paquete: Paquete, maestros: Maestros): Respuesta<Validacion> {
  const { solicitud } = paquete
  if (!solicitud) return { ok: false, error: "Falta solicitud.json: no se puede validar. Pide al solicitante el Excel de solicitud." }
  const e: Entrada = { solicitud, cotizacion: paquete.cotizacion, aprobacion: paquete.aprobacion, factura: paquete.factura, maestros }

  const { evaluacion: r1, proveedor } = rc1(e)
  const centro = buscarCentro(e)
  const r6 = rc6(e, proveedor)
  const r7 = rc7(e, proveedor)
  const evaluaciones = [r1, rc2(e, centro), rc3(e, centro), rc4(e, centro), rc5(e), r6, r7, rc8(e), rc9(e), rc10(e)]

  const bloqueos = evaluaciones.flatMap((r) => (r.bloqueo ? [r.bloqueo] : []))
  return {
    ok: true,
    data: {
      solicitud_id: solicitud.solicitud_id,
      apta: bloqueos.length === 0,
      bloqueos,
      confirmaciones: evaluaciones.flatMap((r) => (r.confirmacion ? [r.confirmacion] : [])),
      derivados: {
        ...(r6.derivado ? { indicador_iva: r6.derivado } : {}),
        ...(r7.derivado ? { condiciones_pago: r7.derivado } : {}),
      },
      retroactiva: esRetroactiva(e),
      proveedor: resolver(proveedor, buscarProveedor(e).criterio),
      controles: evaluaciones.map((r) => r.control),
    },
  }
}
