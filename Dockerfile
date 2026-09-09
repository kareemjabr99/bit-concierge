# One image. Two process targets: apps/web and apps/worker.
# The Fly app config chooses which by overriding CMD.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/widget/package.json ./apps/widget/
COPY apps/cli/package.json ./apps/cli/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/models/package.json ./packages/models/
COPY packages/agent/package.json ./packages/agent/
COPY packages/rag/package.json ./packages/rag/
COPY packages/shopify/package.json ./packages/shopify/
COPY packages/channels/package.json ./packages/channels/
COPY packages/evals/package.json ./packages/evals/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @bitc/web run build && pnpm --filter @bitc/worker run build

FROM base AS runtime
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm,target=/pnpm/store true
COPY --from=build /app /app
USER node
# Overridden per Fly app. Default is the web process.
CMD ["node", "apps/web/build/server/index.js"]
