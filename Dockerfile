# Black History Pomodoro project API
FROM node:22-bookworm-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
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
  PUBLIC_API_ORIGIN=https://blackhistory.360web.cloud \
  MEDIA_CACHE_DIR=/data/cache/media \
  FALLBACKS_PATH=/app/data/reviewed-fallbacks.json
RUN mkdir -p /data/cache/media
EXPOSE 8080
WORKDIR /app/server
CMD ["node", "dist/index.js"]
