# --- 构建阶段 ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 优先拷贝依赖清单以利用层缓存
COPY package*.json ./
RUN npm install

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- 运行阶段 ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 仅安装生产依赖
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
