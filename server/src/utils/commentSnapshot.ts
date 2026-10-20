import fs from "node:fs";
import path from "node:path";
import { STORAGE_DIR } from "../db/store.js";

// 快照是视口截图（WebP，兼容历史 JPEG），单条 6MB 足够大屏原型；测试可用环境变量压小
export const MAX_SNAPSHOT_SIZE = Number(process.env.WORKBENCH_SNAPSHOT_MAX_SIZE) || 6 * 1024 * 1024;

// 评论 id 由服务端生成，这里仍做形状校验，避免外部输入参与路径拼接
export const COMMENT_ID_PATTERN = /^cmt-[A-Za-z0-9-]+$/;

const SNAPSHOT_DIR = path.join(STORAGE_DIR, "snapshots");

export type SnapshotExt = "webp" | "jpg";

// 新快照优先用 WebP，历史数据仍是 JPEG，读取时两种都要认
const SNAPSHOT_EXTS: SnapshotExt[] = ["webp", "jpg"];

export function snapshotFilePath(commentId: string, ext: SnapshotExt = "jpg"): string {
  return path.join(SNAPSHOT_DIR, `${commentId}.${ext}`);
}

// 磁盘残留只是垃圾文件，删不掉不应阻断记录删除。only 用于覆盖上传后清掉另一种格式
export function removeSnapshotFile(commentId: string, only?: SnapshotExt): void {
  if (!COMMENT_ID_PATTERN.test(commentId)) return;
  for (const ext of only ? [only] : SNAPSHOT_EXTS) {
    const file = snapshotFilePath(commentId, ext);
    try {
      fs.rmSync(file, { force: true });
    } catch (err) {
      console.error("Failed to delete comment snapshot:", file, err);
    }
  }
}

// 回源时按实际存在的文件找，兼容升级前保存的 .jpg
export function findSnapshotFile(commentId: string): { file: string; ext: SnapshotExt } | null {
  for (const ext of SNAPSHOT_EXTS) {
    const file = snapshotFilePath(commentId, ext);
    if (fs.existsSync(file)) return { file, ext };
  }
  return null;
}

// 只接受真实的 WebP / JPEG 字节流，避免把任意文件当成图片回源
export function detectSnapshotExt(filePath: string): SnapshotExt | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(12);
    const read = fs.readSync(fd, head, 0, 12, 0);
    if (read >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
    if (
      read === 12 &&
      head.toString("ascii", 0, 4) === "RIFF" &&
      head.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "webp";
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
