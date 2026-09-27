# ── Canonical backend Dockerfile ─────────────────────────────────────────────
# This is the single source of truth for the socialflow-backend image.
# Build context must be the backend/ directory:
#   docker build -f backend/Dockerfile backend/

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including devDeps needed for tsc + prisma generate)
COPY package*.json ./
RUN npm ci

# Copy Prisma schema and migrations before running prisma generate so that
# @prisma/client postinstall has a schema to generate against and tsc can
# type-check all Prisma-typed code.
COPY prisma ./prisma
RUN node_modules/.bin/prisma generate

# Compile TypeScript — type errors must fail the build. tsc --noEmit runs
# first as a strict, failing typecheck gate; the real emit only runs (and is
# trusted) once that gate passes.
COPY tsconfig.json ./
COPY src ./src
RUN node_modules/.bin/tsc --noEmit --skipLibCheck
RUN node_modules/.bin/tsc --skipLibCheck && \
    test -d dist && echo "Build succeeded" || (echo "Build failed: dist/ not created" && exit 1)

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Production deps only (prisma CLI is in dependencies so it survives --omit=dev,
# enabling the migrate initContainer to run npx prisma migrate deploy)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Rebuild sharp for current platform (required for ARM compatibility)
RUN npm rebuild sharp

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema, migrations, and the generated client from the builder
# so that @prisma/client works at runtime and prisma migrate deploy can run.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER appuser

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
