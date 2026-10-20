import fs from "node:fs";
import path from "node:path";
import { STORAGE_DIR } from "../db/store.js";

// 快照是视口截图（JPEG），单条 6MB 足够 1.5 倍缩放下的大屏原型；测试可用环境变量压小
export const MAX_SNAPSHOT_SIZE = Number(process.env.WORKBENCH_SNAPSHOT_MAX_SIZE) || 6 * 1024 * 1024;

// 评论 id 由服务端生成，这里仍做形状校验，避免外部输入参与路径拼接
export const COMMENT_ID_PATTERN = /^cmt-[A-Za-z0-9-]+$/;

const SNAPSHOT_DIR = path.join(STORAGE_DIR, "snapshots");

export function snapshotFilePath(commentId: string): string {
  return path.join(SNAPSHOT_DIR, `${commentId}.jpg`);
}

// 磁盘残留只是垃圾文件，删不掉不应阻断记录删除
export function removeSnapshotFile(commentId: string): void {
  if (!COMMENT_ID_PATTERN.test(commentId)) return;
  const file = snapshotFilePath(commentId);
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    console.error("Failed to delete comment snapshot:", file, err);
  }
}

// 只接受真实的 JPEG 字节流：快照统一按 image/jpeg 回源，不校验就会被当成任意文件宿主
export function isJpegFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(3);
    const read = fs.readSync(fd, head, 0, 3, 0);
    return read === 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
