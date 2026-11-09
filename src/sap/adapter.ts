// Interfaz obligatoria (PRD 7.4). Las herramientas solo conocen esta interfaz,
// así que cambiar el mock por un adaptador real (OData/BAPI/CPI) no las toca.
import type { OrdenCompra } from "../domain/tipos.ts"

export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>
  // Extensión compatible: además del número devuelve la fecha, para responder idempotencia completa.
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null>
}
