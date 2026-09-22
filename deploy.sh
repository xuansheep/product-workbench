#!/bin/bash
set -e

# ==============================================================================
# 产品评审工作台 (Product Workbench) 自动化 Docker 部署脚本
# 镜像基线: node:22-alpine
# 持久化方案: Docker named volume (workbench-storage)
# ==============================================================================

CONTAINER_NAME="product-workbench"
IMAGE_NAME="product-workbench:latest"
PORT="9030"
VOLUME_NAME="workbench-storage"
CONTAINER_STORAGE_DIR="/app/storage"
LEGACY_STORAGE_DIR="$(pwd)/storage"

echo "=================================================="
echo "  产品工作台 Docker 部署: ${CONTAINER_NAME}"
echo "=================================================="

# 1. 构建最新镜像 (使用 node:22-alpine，纯净无 C++ 编译)
echo "[1/4] 正在构建 Docker 镜像: ${IMAGE_NAME} ..."
docker build -t "${IMAGE_NAME}" .

# 2. 准备持久化数据卷
#    数据落在 /var/lib/docker 所在分区的本地文件系统上，不经过宿主机目录绑定，
#    避免 NFS / SMB / FUSE 等共享文件系统不支持 SQLite WAL 所需的文件锁与 mmap
#    而抛出 disk I/O error。
echo "[2/4] 正在准备持久化数据卷: ${VOLUME_NAME} ..."
docker volume create "${VOLUME_NAME}" >/dev/null

volume_is_empty() {
    local first
    first=$(docker run --rm --entrypoint sh \
        -v "${VOLUME_NAME}:${CONTAINER_STORAGE_DIR}" \
        "${IMAGE_NAME}" \
        -c "ls -A ${CONTAINER_STORAGE_DIR} 2>/dev/null | head -n 1")
    [ -z "${first}" ]
}

if [ -d "${LEGACY_STORAGE_DIR}" ] && [ -n "$(ls -A "${LEGACY_STORAGE_DIR}" 2>/dev/null)" ] \
   && volume_is_empty; then
    echo ">> 检测到历史目录 ${LEGACY_STORAGE_DIR} 且数据卷为空，执行一次性数据迁移..."
    docker run --rm --entrypoint sh \
        -v "${VOLUME_NAME}:${CONTAINER_STORAGE_DIR}" \
        -v "${LEGACY_STORAGE_DIR}:/legacy-storage:ro" \
        "${IMAGE_NAME}" \
        -c "cp -a /legacy-storage/. ${CONTAINER_STORAGE_DIR}/"
    echo ">> 迁移完成。原目录 ${LEGACY_STORAGE_DIR} 保持原样，确认无误后可自行清理。"
else
    echo ">> 数据卷已就绪，无需迁移。"
fi

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
            -v "${VOLUME_NAME}:${CONTAINER_STORAGE_DIR}" \
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
        -v "${VOLUME_NAME}:${CONTAINER_STORAGE_DIR}" \
        -e TZ=Asia/Shanghai \
        "${IMAGE_NAME}"
    echo ">> 初次部署成功！容器已绑定持久化数据卷: ${VOLUME_NAME}"
fi

# 4. 状态汇报与健康检查
echo "[4/4] 检查容器运行状态:"
echo "--------------------------------------------------"
docker ps --filter "name=${CONTAINER_NAME}"
echo "--------------------------------------------------"
echo "访问入口: http://<服务器IP>:${PORT}"
echo "实时日志: docker logs -f ${CONTAINER_NAME}"
echo "数据卷目录: docker volume inspect ${VOLUME_NAME}"
echo "=================================================="
