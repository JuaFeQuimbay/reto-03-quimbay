// Serializa escrituras a archivos compartidos (out/) para evitar carreras entre sesiones.
// No anidar: una tarea en cola no debe esperar otra tarea encolada después de ella.
let cola: Promise<unknown> = Promise.resolve()

export function enSerie<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = cola.then(tarea, tarea)
  cola = resultado.catch(() => undefined)
  return resultado
}
