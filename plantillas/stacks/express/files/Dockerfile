# syntax=docker/dockerfile:1.7
# Targets: dev (tsx watch) · build (compila TypeScript; también lo usa el servicio migrate en prod) · prod (dist + dependencias de runtime, no root)
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
# openssl: Prisma's migration engine needs it on Alpine.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    [ -f package-lock.json ] || { echo "Falta package-lock.json: ejecuta make new-app"; exit 1; }; npm ci

FROM deps AS dev
RUN apk add --no-cache bash git
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "if [ -f prisma/schema.prisma ]; then npx --no-install prisma generate; fi; exec npx --no-install tsx watch src/server.ts"]

FROM deps AS build
COPY . .
# The Prisma client is generated into src/generated/prisma, so tsc compiles it into dist/ with the app.
RUN if [ -f prisma/schema.prisma ]; then npx --no-install prisma generate; fi \
 && npx --no-install tsc -p tsconfig.build.json
# migrate uses this stage as uid 1001 (it has the prisma CLI, prisma.config.ts and prisma/): the SQLite volume
# (/app/data) takes its owner from the image.
RUN mkdir -p /app/data && chown 1001:1001 /app/data

# Runtime dependencies only (native modules such as better-sqlite3 are built here, on the same base image as prod).
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    [ -f package-lock.json ] || { echo "Falta package-lock.json: ejecuta make new-app"; exit 1; }; npm ci --omit=dev

FROM base AS prod
ENV NODE_ENV=production PORT=3000
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
# Code and dependencies stay owned by root: the app user can read them, not change them.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
# The SQLite volume (/app/data) takes its owner from the image.
RUN mkdir -p /app/data && chown app:app /app/data
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
