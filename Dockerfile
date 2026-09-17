FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage
ENV ENABLE_DOCS=false

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY src/common/textures ./src/common/textures
COPY src/common/textures ./dist/common/textures

RUN mkdir -p /app/storage

EXPOSE 3000

CMD ["node", "dist/api/server.js"]
