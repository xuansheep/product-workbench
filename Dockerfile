# ==========================================
# 阶段 1: 构建阶段 (Builder)
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# 优先拷贝依赖定义文件，避开宿主机 Windows package-lock.json 平台架构锁定
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# 在 Linux Alpine 环境下安装全部构建依赖，并确保 musl 架构下的 Rollup 原生模块就绪
RUN npm install && npm --prefix client install --save-optional @rollup/rollup-linux-x64-musl

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

# 拷贝依赖配置并仅安装生产运行依赖（纯 Node.js 服务端依赖，无前端构建工具）
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm install --omit=dev && npm cache clean --force

# 从构建阶段提取纯净产物
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

# 创建持久化数据目录
RUN mkdir -p /app/storage

# 暴露服务端口
EXPOSE 9030

# 声明持久化挂载点：生产部署请显式挂载 named volume（deploy.sh 与 docker-compose.yml 均使用
# 固定的 workbench-storage 卷）。若启动时漏掉 -v，Docker 会创建一个匿名卷，数据不会丢在容器
# 可写层，但难以定位，排查时先执行 docker volume ls 确认。
VOLUME ["/app/storage"]

# 容器健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9030/api/health || exit 1

# 启动服务
CMD ["node", "server/dist/index.js"]
