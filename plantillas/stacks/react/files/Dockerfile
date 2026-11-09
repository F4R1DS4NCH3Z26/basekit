# syntax=docker/dockerfile:1.7
# Targets: dev (Vite con hot reload) · build (tsc + vite build) · prod (nginx sin root que sirve dist/)
ARG NODE_VERSION=22
ARG NGINX_VERSION=1.30
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app
RUN apk add --no-cache bash git

FROM base AS deps
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; else npm ci; fi

FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

FROM deps AS build
COPY . .
# Vite embeds VITE_* variables into the public JS at build time (never a secret). compose.prod.yaml passes them
# as build args from .env.prod, because .dockerignore keeps every .env* file out of the image.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL} NODE_ENV=production
RUN npm run build

# nginx-unprivileged runs as uid 101 and listens on 8080; its pid and temp files live in /tmp (tmpfs in prod).
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
