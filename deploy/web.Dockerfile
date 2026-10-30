# Сборка MiniApp
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @financio/web...

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @financio/web build

# Caddy раздаёт MiniApp, проксирует API и сам получает HTTPS-сертификат
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
