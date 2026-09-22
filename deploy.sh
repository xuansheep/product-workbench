#!/bin/bash
set -e

# ==============================================================================
# 产品评审工作台 (Product Workbench) 自动化 Docker 部署脚本
# 镜像基线: node:16-alpine
# 持久化方案: 宿主机目录绑定 (./storage -> /app/storage)
# ==============================================================================

CONTAINER_NAME="product-workbench"
IMAGE_NAME="product-workbench:latest"
PORT="9030"
HOST_STORAGE_DIR="$(pwd)/storage"
CONTAINER_STORAGE_DIR="/app/storage"

echo "=================================================="
echo "  产品工作台 Docker 部署: ${CONTAINER_NAME}"
echo "=================================================="

# 1. 构建最新镜像 (使用 node:16-alpine，纯 JavaScript/TypeScript 运行时，无原生模块)
echo "[1/4] 正在构建 Docker 镜像: ${IMAGE_NAME} ..."
docker build -t "${IMAGE_NAME}" .

# 2. 准备宿主机持久化目录
#    业务数据只有 storage/data.json 与 storage/prototypes/ 两处，直接落在宿主机上，
#    备份与迁移都只需操作这个目录。
echo "[2/4] 正在准备宿主机持久化目录: ${HOST_STORAGE_DIR} ..."
mkdir -p "${HOST_STORAGE_DIR}"

# 3. 检查固定名称的容器是否存在
echo "[3/4] 正在检查容器 [${CONTAINER_NAME}] 状态..."

if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
    echo ">> 检测到容器 [${CONTAINER_NAME}] 已存在。"

    # 支持 --recreate / -r 参数用于完全加载新镜像，默认执行用户指定的 docker restart
    if [ "$1" = "--recreate" ] || [ "$1" = "-r" ]; then
        echo ">> 正在移除旧容器并使用新镜像重新启动..."
        docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
        docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
        docker run -d \
            --name "${CONTAINER_NAME}" \
            --restart unless-stopped \
            -p "${PORT}:9030" \
            -v "${HOST_STORAGE_DIR}:${CONTAINER_STORAGE_DIR}" \
            -e TZ=Asia/Shanghai \
            "${IMAGE_NAME}"
        echo ">> 容器已使用最新构建镜像重新创建并启动！"
    else
        echo ">> 正在执行重启: docker restart ${CONTAINER_NAME} ..."
        docker restart "${CONTAINER_NAME}"
        echo ">> 容器 [${CONTAINER_NAME}] 重启完成！"
        echo ">> [提示] 若需要应用新构建的代码镜像，可使用: ./deploy.sh --recreate"
    fi
else
    echo ">> 容器 [${CONTAINER_NAME}] 不存在，执行初次部署 (docker run)..."
    docker run -d \
        --name "${CONTAINER_NAME}" \
        --restart unless-stopped \
        -p "${PORT}:9030" \
        -v "${HOST_STORAGE_DIR}:${CONTAINER_STORAGE_DIR}" \
        -e TZ=Asia/Shanghai \
        "${IMAGE_NAME}"
    echo ">> 初次部署成功！已绑定宿主机数据目录: ${HOST_STORAGE_DIR}"
fi

# 4. 状态汇报与健康检查
echo "[4/4] 检查容器运行状态:"
echo "--------------------------------------------------"
docker ps --filter "name=${CONTAINER_NAME}"
echo "--------------------------------------------------"
echo "访问入口: http://<服务器IP>:${PORT}"
echo "实时日志: docker logs -f ${CONTAINER_NAME}"
echo "数据目录: ${HOST_STORAGE_DIR}"
echo "=================================================="
