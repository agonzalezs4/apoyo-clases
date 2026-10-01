# Recolector de respuestas: imagen mínima con el servidor propio (sin dependencias de npm).
#   docker compose up -d           (ver docs/INSTALACION.md)
FROM node:22-alpine

ENV NODE_ENV=production \
    PUERTO=8080 \
    HOST=0.0.0.0 \
    DATOS=/app/datos \
    CLASES=/app/clases

WORKDIR /app
COPY . .
RUN mkdir -p /app/datos /app/clases && chown -R node:node /app
USER node

EXPOSE 8080
VOLUME ["/app/datos", "/app/clases"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/salud >/dev/null || exit 1

CMD ["node", "servidor/servidor.js"]
