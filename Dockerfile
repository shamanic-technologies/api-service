# Stage 1: Builder
FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config and package files first for better caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY shared/runs-client/package.json shared/runs-client/
COPY shared/content/package.json shared/content/

# Install all dependencies
RUN pnpm install --no-frozen-lockfile

# Copy all source files
COPY . .

# Build shared packages
RUN pnpm --filter "./shared/*" build

# Build api-service
RUN pnpm build

# Stage 2: Production
FROM node:20-slim

WORKDIR /app

RUN npm install -g pnpm

# Copy workspace config and install prod deps only
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml* ./
COPY --from=builder /app/shared/content/package.json shared/content/
COPY --from=builder /app/shared/runs-client/package.json shared/runs-client/
RUN pnpm install --prod --no-frozen-lockfile

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared/content/dist shared/content/dist
COPY --from=builder /app/shared/runs-client/dist shared/runs-client/dist

# Force IPv4 first to avoid IPv6 connection issues with Neon
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

CMD ["node", "dist/index.js"]
