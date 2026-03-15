# ══════════════════════════════════════════════════════════════════════════════
#  Gemini Live App — Production Dockerfile (Next.js)
#  Multi-stage build: install → build → minimal runtime image.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install Dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package manifests (layer cache optimisation)
COPY package.json package-lock.json* ./

# Install ALL dependencies (devDeps needed for the build step)
RUN npm ci

# ── Stage 2: Build the Next.js App ───────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Bring in node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy full source code
COPY . .

# Set build-time env (can be overridden at deploy time)
ARG NEXT_PUBLIC_API_WS_URL="ws://localhost:8080"
ENV NEXT_PUBLIC_API_WS_URL=${NEXT_PUBLIC_API_WS_URL}

# Build the optimised production bundle
RUN npm run build

# ── Stage 3: Production Runtime ──────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy only what's needed to run (no source code or devDeps)
COPY --from=builder /app/public          ./public
COPY --from=builder /app/.next           ./.next
COPY --from=builder /app/package.json    ./package.json
COPY --from=builder /app/node_modules    ./node_modules

# Switch to non-root user
USER appuser

# Expose the Next.js port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the production server
CMD ["npm", "start"]
