FROM oven/bun:1.3.13-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3.13-alpine
WORKDIR /app
ENV PORT=3000
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY server.ts ./server.ts
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/healthz'); process.exit(response.ok ? 0 : 1)"
CMD ["bun", "run", "server.ts"]
