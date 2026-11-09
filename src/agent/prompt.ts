// Construye el system prompt desde archivos Markdown: comportamiento + conocimiento.
// Nada del prompt vive en el código; cambiar reglas de negocio no toca el servidor.
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export const RUTA_PROMPT = join("agent", "prompt.md")
export const RUTA_CONOCIMIENTO = join("src", "knowledge", "ordenes-compra.md")

/** Quita el frontmatter YAML (--- ... ---) si existe, para reutilizar los mismos archivos en modulo/. */
export function sinFrontmatter(texto: string): string {
  return texto.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()
}

export async function cargarSistema(directory: string): Promise<string> {
  const [comportamiento, conocimiento] = await Promise.all([
    readFile(join(directory, RUTA_PROMPT), "utf8"),
    readFile(join(directory, RUTA_CONOCIMIENTO), "utf8"),
  ])
  return `${sinFrontmatter(comportamiento)}\n\n---\n\n# Conocimiento del proceso (consulta)\n\n${sinFrontmatter(conocimiento)}`
}
