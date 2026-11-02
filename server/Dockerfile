# Build from the repository root so the reviewed fallback data is included:
#   docker build -f server/Dockerfile -t black-history-pomodoro-api .
FROM node:22-bookworm-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/server/package.json /app/server/package-lock.json* ./server/
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY data/reviewed-fallbacks.json ./data/reviewed-fallbacks.json
ENV NODE_ENV=production \
  PORT=8080 \
  MEDIA_CACHE_DIR=/data/cache/media \
  FALLBACKS_PATH=/app/data/reviewed-fallbacks.json
RUN mkdir -p /data/cache/media && chown -R node:node /data /app
USER node
EXPOSE 8080
WORKDIR /app/server
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
