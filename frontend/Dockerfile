FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GATEWAY_HOST
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_BILLING_ENABLED
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_GATEWAY_HOST=$NEXT_PUBLIC_GATEWAY_HOST
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_BILLING_ENABLED=$NEXT_PUBLIC_BILLING_ENABLED
RUN npm run build
# Self-contained migrator (drizzle migrator + pg bundled into one JS file) so the
# standalone runner can apply migrations via the Fly deploy release_command —
# no tsx / devDependencies needed at runtime.
RUN npm run db:bundle-migrator

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrator bundle + the SQL migrations it reads (release_command runs `node
# migrate-runner.cjs` from /app, which resolves lib/db/migrations/drizzle).
COPY --from=builder --chown=nextjs:nodejs /app/migrate-runner.cjs ./migrate-runner.cjs
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations/drizzle ./lib/db/migrations/drizzle
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
