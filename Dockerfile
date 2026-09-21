# ==========================================
# 阶段 1: 构建阶段 (Builder)
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# 优先拷贝依赖定义文件，最大化利用 Docker 缓存层
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# 在 Linux Alpine 环境下安装全部构建依赖（纯 JS/TS 依赖，无 C++ 编译）
RUN npm install

# 拷贝全量源代码
COPY . .

# 执行全量构建（产出 client/dist 与 server/dist）
RUN npm run build

# ==========================================
# 阶段 2: 生产运行阶段 (Runner)
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9030
ENV WORKBENCH_STORAGE_DIR=/app/storage
ENV WORKBENCH_DB_PATH=/app/storage/workbench.db

# 拷贝依赖配置并仅安装生产运行依赖
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm install --omit=dev && npm cache clean --force

# 从构建阶段提取纯净产物
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

# 创建持久化数据目录
RUN mkdir -p /app/storage

# 暴露服务端口
EXPOSE 9030

# 声明外部持久化挂载卷
VOLUME ["/app/storage"]

# 容器健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9030/api/health || exit 1

# 启动服务
CMD ["node", "server/dist/index.js"]
