FROM node:24.14.1-bookworm AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @sui/db db:generate
RUN pnpm -r --filter @sui/shared --filter @sui/backend --filter @sui/frontend build
RUN pnpm deploy --legacy --filter @sui/backend --prod /deploy
RUN cp -r packages/backend/dist /deploy/dist
RUN cp -r packages/db/prisma /deploy/prisma
RUN cp packages/db/prisma.config.ts /deploy/prisma.config.ts
RUN cp -r packages/frontend/dist /frontend-dist

FROM node:24.14.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /deploy /app
COPY --from=build /frontend-dist /app/frontend-dist

CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
