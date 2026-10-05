# syntax=docker/dockerfile:1

# ---- build: compile TypeScript, then drop dev dependencies ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime: small, non-root, no compiler toolchain (node:sqlite is built in) ----
FROM node:22-alpine
ENV NODE_ENV=production \
    LOG_FORMAT=json \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=3000 \
    DATABASE_PATH=/data/toolkit.db
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1
# Node handles SIGTERM itself (graceful shutdown); compose adds `init: true` for zombie reaping.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
