# syntax=docker/dockerfile:1.7
# Targets: dev (hot reload) · build (compila; también usado por el servicio migrate en prod) · prod (standalone, no root)
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat bash git

FROM base AS deps
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; else npm ci; fi

FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "if [ -d prisma ]; then npx --no-install prisma generate; fi; exec npm run dev -- --hostname 0.0.0.0 --port 3000"]

FROM deps AS build
COPY . .
ENV NODE_ENV=production
RUN mkdir -p public && if [ -d prisma ]; then npx --no-install prisma generate; fi && npm run build
# migrate uses this stage as uid 1001: the SQLite volume (/app/data) takes its owner from the image.
RUN mkdir -p /app/data && chown 1001:1001 /app/data

FROM node:${NODE_VERSION}-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
