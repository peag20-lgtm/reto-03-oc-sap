# Imagen de producción: Bun + dependencias de runtime. La clave del modelo llega como variable de entorno del servicio.
FROM oven/bun:1.3-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --chown=bun:bun . .
RUN mkdir -p out && chown bun:bun out
USER bun
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/server.ts"]
