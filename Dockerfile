# Imagen de producción: Bun ejecuta TypeScript directamente (sin paso de compilación).
FROM oven/bun:1.4.4-slim

WORKDIR /app

# Dependencias primero (capa cacheable). Sin devDependencies en producción.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Código, prompt, conocimiento, front y fixtures.
COPY . .

# out/ es la única carpeta escribible; el proceso no corre como root.
RUN mkdir -p out && chown -R bun:bun /app/out
USER bun

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/server.ts"]
