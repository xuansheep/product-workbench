# 产品工作台 (Product Workbench)

为产品经理、UI/UX 设计师、研发与测试团队打造的一站式轻量、高保真原型托管与协同评审平台。

---

## 核心特性

1. **项目管理**
   - 支持创建、编辑、检索产品项目空间。
   - 每个项目下独立收纳其所属的多套原型资产与版本演进记录。

2. **原型管理与多格式上传**
   - **单 HTML 页面**：直接拖拽或选择单页 HTML 上传。
   - **静态站点压缩包 (.zip)**：自动安全解压（防御 Zip Slip 逃逸），智能嗅探 `index.html` 或多层级入口。
   - **无缝托管**：基于安全沙箱隔离（`iframe`），完美呈现 Axure、墨刀、Figma 导出的原型界面。

3. **版本管理（版本时光机）**
   - 每次上传新文件后自动递增版本号（`v1.0 -> v2.0 -> v3.0`），支持填写版本更新说明（Changelog）。
   - 顶部工具栏提供快捷版本下拉切换器，随时回溯历史版本页面及对应历史评论。

4. **高精度视口批注与侧边栏协作**
   - **批注模式（快捷键 C / Esc退出）**：开启批注模式后，在原型任意位置点击落点，记录归一化相对百分比坐标与吸附元素。
   - **标号 Pin 呈现**：原型画布上以数字标号直观呈现，平滑跟随，悬停展示预览气泡。
   - **独立评论抽屉**：右侧抽屉展示所有评论线索（Thread），支持多级回复互动、状态切换（待处理 / 已解决）与版本筛选。
   - **鼠标右键便捷退出**：右键单击即可一键退出批注模式并关闭激活卡片。

5. **多端响应式视口模拟**
   - 原型工作台顶部支持一键切换：流动自适应 (100%)、MacBook (1440 × 900)、iPad (820 × 1080)、iPhone (393 × 852)。

6. **回收站机制**
   - 原型删除后采用软删除进入回收站，防止误删事故。
   - 回收站内支持一键“还原”，或选择“彻底删除”清理物理资源。

7. **免注册轻量账户系统**
   - 基于浏览器本地缓存（LocalStorage），支持自定义昵称与 32 款精致预设头像（紧凑双排、平滑展开）。

---

## Docker 容器化部署（推荐）

项目全面支持容器化部署，采用 **`node:22-alpine`** 多阶段轻量构建，纯 JavaScript/TypeScript 运行时，**零 C++ 编译、零 Python/GCC 依赖**，秒级部署。

### 一键脚本部署（自动检查与重启）
在项目根目录下执行部署脚本，脚本将**自动构建镜像**，并根据容器存在状态自动选择启动或重启：
```bash
# 添加执行权限
chmod +x deploy.sh

# 执行部署（容器不存在则 run，已存在则 restart）
./deploy.sh

# 若更新了代码需要以最新镜像重建容器，运行：
./deploy.sh --recreate
```

### 手动 Docker 命令

#### 1. 构建镜像
```bash
docker build -t product-workbench:latest .
```

#### 2. 首次运行容器（绑定固定容器名与持久化存储）
```bash
docker run -d \
  --name product-workbench \
  --restart unless-stopped \
  -p 9030:9030 \
  -v workbench-storage:/app/storage \
  -e TZ=Asia/Shanghai \
  product-workbench:latest
```

#### 3. 再次部署（存在则重启）
```bash
# 检查容器是否存在
if docker ps -a --format '{{.Names}}' | grep -Eq "^product-workbench\$"; then
  docker restart product-workbench
else
  docker run -d --name product-workbench --restart unless-stopped -p 9030:9030 -v workbench-storage:/app/storage product-workbench:latest
fi
```

### Docker Compose 部署
```bash
# 后台启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

### 关于持久化数据卷

> **为什么用 named volume 而不是 `-v ./storage:/app/storage`？**
> SQLite 的 WAL 模式依赖共享内存映射（mmap）与可靠的文件锁。当宿主机目录来自 NFS / SMB / FUSE
> 等共享文件系统时，这些能力不可用，服务启动即报 `disk I/O error`（SQLite `SQLITE_IOERR`）。
> 改用 Docker named volume 后，数据落在 `/var/lib/docker` 所在分区的本地文件系统上，不受此影响。

`deploy.sh` 与 `docker-compose.yml` 统一使用固定卷名 `workbench-storage`，两种部署方式可随时互换。

```bash
# 查看数据卷的宿主机落盘位置
docker volume inspect workbench-storage

# 手动从旧的目录绑定方式迁移数据（把 ./storage 内容灌入数据卷）
docker run --rm --entrypoint sh \
  -v workbench-storage:/app/storage \
  -v "$(pwd)/storage:/legacy-storage:ro" \
  product-workbench:latest \
  -c "cp -a /legacy-storage/. /app/storage/"
```

`deploy.sh` 已内置该迁移逻辑：当数据卷为空、且本地存在非空的 `./storage` 时会自动执行一次。

启动后在浏览器中访问：`http://<服务器IP>:9030`

---

## 本地宿主机部署

### 环境要求
- Node.js >= 22.5.0 (推荐 Node 22 或 24，内核内置 `node:sqlite`)
- npm >= 9.0.0

### 安装依赖
```bash
npm install
```

### 开发模式启动
```bash
npm run dev
```
启动后在浏览器访问：`http://localhost:9031`

### 生产构建与单端口运行
```bash
npm run build
npm start
```
打开浏览器访问：`http://localhost:9030`

---

## 项目架构与目录划分

```
product-workbench/
├── Dockerfile                  # node:22-alpine 多阶段生产构建镜像配置
├── docker-compose.yml          # Docker Compose 编排文件
├── deploy.sh                   # 自动化检查与部署脚本
├── client/                     # 前端应用 (React 18 + Vite + TailwindCSS + Lucide-react)
├── server/                     # 后端应用 (Node.js 22/24 + Express + node:sqlite 原生驱动)
├── storage/                    # 本地直跑 (npm start) 的数据目录；容器部署请使用 named volume
└── package.json
```
