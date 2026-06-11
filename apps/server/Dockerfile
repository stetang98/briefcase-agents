FROM node:22-alpine AS base
RUN npm install -g pnpm@9

WORKDIR /app
# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/chain/package.json packages/chain/
COPY packages/agents/package.json packages/agents/
COPY apps/server/package.json apps/server/

RUN pnpm install --frozen-lockfile

# Copy source after deps (keeps cache valid on code-only changes)
COPY packages/chain packages/chain
COPY packages/agents packages/agents
COPY apps/server apps/server

EXPOSE 4021
CMD ["node", "--import", "tsx/esm", "apps/server/src/index.ts"]
