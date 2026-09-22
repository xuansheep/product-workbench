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

项目全面支持容器化部署，采用 **`node:16-alpine`** 多阶段轻量构建，纯 JavaScript/TypeScript 运行时，**零 C++ 编译、零 Python/GCC 依赖**，秒级部署。

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
  -v "$(pwd)/storage:/app/storage" \
  -e TZ=Asia/Shanghai \
  product-workbench:latest
```

#### 3. 再次部署（存在则重启）
```bash
# 检查容器是否存在
if docker ps -a --format '{{.Names}}' | grep -Eq "^product-workbench\$"; then
  docker restart product-workbench
else
  docker run -d --name product-workbench --restart unless-stopped -p 9030:9030 -v "$(pwd)/storage:/app/storage" product-workbench:latest
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

### 关于持久化数据目录

业务数据只有两处：`storage/data.json`（项目、原型版本、批注全部在内）与 `storage/prototypes/`（原型静态文件）。
`data.json` 每次写入都是「同目录临时文件 + 原子 rename 替换」，不存在写到一半损坏的风险，服务运行中也能安全备份：

```bash
# 备份
tar czf workbench-backup-$(date +%F).tar.gz storage/

# 恢复
tar xzf workbench-backup-YYYY-MM-DD.tar.gz
```

`deploy.sh` 与 `docker-compose.yml` 统一绑定宿主机目录 `./storage`。

> **从旧版本升级**：早期版本使用 SQLite（`workbench.db`），因其 WAL 模式依赖 mmap 与可靠文件锁、
> 在 NFS / SMB / FUSE 上会抛 `disk I/O error`，当时改用 Docker named volume 承载。
> 现已改为本地 JSON 文件存储（`data.json`），故改回目录绑定。
>
> **注意：新版不读写 SQLite，旧卷里的 `workbench.db` 不会被自动识别，也没有内置的自动转换。**
> 升级前请先把旧卷数据拷到宿主机留档；新版本会从 `storage/data.json` 重新开始（首启会写入一份内置示例数据）。

```bash
# 把旧卷里的数据整体拷到宿主机目录留档
docker run --rm -v workbench-storage:/from -v "$(pwd)/storage:/to" alpine \
  sh -c "cp -a /from/. /to/"
```

启动后在浏览器中访问：`http://<服务器IP>:9030`

---

## 本地宿主机部署

### 环境要求
- Node.js >= 16.18.0（存储层为本地 JSON 文件，无任何原生模块依赖，Node 16 / 18 / 20 / 22 均可直接运行）
- npm >= 8.0.0

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
├── Dockerfile                  # node:16-alpine 多阶段生产构建镜像配置
├── docker-compose.yml          # Docker Compose 编排文件
├── deploy.sh                   # 自动化检查与部署脚本
├── client/                     # 前端应用 (React 18 + Vite + TailwindCSS + Lucide-react)
├── server/                     # 后端应用 (Node.js 16.18+ + Express + 本地 JSON 文件存储)
├── storage/                    # 数据目录：data.json 为全部业务数据，prototypes/ 为原型静态文件
└── package.json
```
