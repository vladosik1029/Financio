FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @financio/server...

COPY packages/shared packages/shared
COPY apps/server apps/server

ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "--filter", "@financio/server", "start"]
