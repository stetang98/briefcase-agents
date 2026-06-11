FROM node:22-alpine AS base
RUN npm install -g pnpm@9

WORKDIR /app
# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/chain/package.json packages/chain/
COPY packages/agents/package.json packages/agents/
COPY apps/server/package.json apps/server/
# pnpm validates ALL workspace importers in the lockfile; apps/web must be present
# even though it is not deployed here.
COPY apps/web/package.json apps/web/

# Dev deps are intentionally installed: `tsx` is a devDependency and required by
# the CMD. Moving tsx to dependencies would also work; this is the simpler fix.
RUN pnpm install --frozen-lockfile

# Copy source after deps (keeps cache valid on code-only changes)
COPY packages/chain packages/chain
COPY packages/agents packages/agents
COPY apps/server apps/server

ENV NODE_ENV=production
USER node
EXPOSE 4021
CMD ["node", "--import", "tsx/esm", "apps/server/src/index.ts"]
