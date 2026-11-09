# syntax=docker/dockerfile:1.7
# Targets: dev (nest start --watch) · build (compila; también lo usa el servicio migrate en prod) · prod (dist + dependencias de runtime, no root)
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
# openssl: lo necesita el motor de migraciones de Prisma en Alpine.
RUN apk add --no-cache libc6-compat openssl bash git

FROM base AS deps
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; else npm ci; fi

FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "if [ -f prisma/schema.prisma ]; then npx --no-install prisma generate; fi; exec npm run start:dev"]

FROM deps AS build
COPY . .
ENV NODE_ENV=production
RUN if [ -f prisma/schema.prisma ]; then npx --no-install prisma generate; fi && npm run build
# migrate uses this stage as uid 1001: the SQLite volume (/app/data) takes its owner from the image.
RUN mkdir -p /app/data && chown 1001:1001 /app/data

# Runtime dependencies only (native modules such as better-sqlite3 are built here, on the same base image as prod).
FROM base AS prod-deps
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile --prod; else npm ci --omit=dev; fi

FROM node:${NODE_VERSION}-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN apk add --no-cache libc6-compat && addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nestjs
COPY --from=prod-deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
RUN mkdir -p /app/data && chown nestjs:nodejs /app/data
USER nestjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
