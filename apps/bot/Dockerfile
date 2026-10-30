FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/
RUN pnpm install --frozen-lockfile --filter @financio/bot...

COPY apps/bot apps/bot

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@financio/bot", "start"]
