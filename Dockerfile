# 运行时基线：Node 16.20 (Alpine)。存储层为本地 JSON 文件，全流程不依赖任何原生模块，
# 因此构建与运行都不需要 C++ 编译链。
# ==========================================
# 阶段 1: 构建阶段 (Builder)
# ==========================================
FROM node:16-alpine AS builder

WORKDIR /app

# 优先拷贝依赖定义文件，避开宿主机 Windows package-lock.json 平台架构锁定
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# 在 Linux Alpine 环境下安装全部构建依赖
RUN npm install

# 拷贝全量源代码
COPY . .

# 执行全量构建（产出 client/dist 与 server/dist）
RUN npm run build

# ==========================================
# 阶段 2: 生产运行阶段 (Runner)
# ==========================================
FROM node:16-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9030
ENV WORKBENCH_STORAGE_DIR=/app/storage
ENV WORKBENCH_DATA_PATH=/app/storage/data.json

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

# 声明持久化挂载点：业务数据只有 storage/data.json 与 storage/prototypes/ 两处。
# 生产部署请显式绑定宿主机目录（deploy.sh 与 docker-compose.yml 均为 -v ./storage:/app/storage）。
# 若启动时漏掉 -v，Docker 会创建一个匿名卷，数据不会丢在容器可写层，但难以定位，
# 排查时先执行 docker volume ls 确认。
VOLUME ["/app/storage"]

# 容器健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9030/api/health || exit 1

# 启动服务
CMD ["node", "server/dist/index.js"]
