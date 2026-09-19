FROM node:24.21.0-bookworm@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0 AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json

RUN pnpm install --frozen-lockfile

# Schema changes invalidate client generation, not dependency installation.
FROM deps AS generated
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma
COPY packages/db/prisma.config.ts packages/db/prisma.config.ts
RUN pnpm --filter @sui/db db:generate

FROM generated AS backend-build
COPY packages/db/src packages/db/src
COPY packages/shared/src packages/shared/src
COPY packages/backend/src packages/backend/src
COPY packages/backend/tsup.config.ts packages/backend/tsconfig.json packages/backend/
# The client is already generated above; the package build script would repeat it.
RUN pnpm --filter @sui/backend exec tsup
RUN pnpm deploy --legacy --filter @sui/backend --prod /deploy \
    && mkdir -p /deploy/dist \
    && cp -r packages/backend/dist/. /deploy/dist/
COPY packages/db/prisma /deploy/prisma
COPY packages/db/prisma.config.ts /deploy/prisma.config.ts

FROM deps AS frontend-build
COPY packages/shared/src packages/shared/src
COPY packages/frontend/src packages/frontend/src
COPY packages/frontend/public packages/frontend/public
COPY packages/frontend/index.html packages/frontend/vite.config.ts packages/frontend/tsconfig.json packages/frontend/postcss.config.cjs packages/frontend/
RUN pnpm --filter @sui/frontend build

FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=backend-build /deploy /app
COPY --from=frontend-build /app/packages/frontend/dist /app/frontend-dist

CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
