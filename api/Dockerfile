# ══════════════════════════════════════════════════════════════════════════════
#  Gemini Live API — Production Dockerfile
#  Multi-stage build for a lean, secure Node.js backend image.
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install Dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only package manifests first (maximises Docker layer cache)
COPY package.json package-lock.json* ./

# Install production-only dependencies (no devDependencies bloat)
RUN npm ci --omit=dev

# ── Stage 2: Production Image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Remove unnecessary files from final image
RUN rm -rf .env .git crash_log.txt DELETE node_modules/.cache 2>/dev/null || true

# Switch to non-root user
USER appuser

# Expose the default API port
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the server
CMD ["node", "server.js"]
