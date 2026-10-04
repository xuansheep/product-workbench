import fs from "node:fs";
import path from "node:path";
import { STORAGE_DIR } from "../db/store.js";
import type { Attachment } from "../types.js";

// 单文件上限，默认 20MB；可由环境变量覆盖，便于测试用小文件验证超限分支
export const MAX_ATTACHMENT_SIZE = Number(process.env.WORKBENCH_ATTACHMENT_MAX_SIZE) || 20 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME_LENGTH = 200;

// 附件文件按附件 id 分目录存放，删除时整目录清掉即可
export function attachmentDir(id: string): string {
  return path.join(STORAGE_DIR, "attachments", id);
}

export function attachmentFilePath(att: Attachment): string {
  return path.join(attachmentDir(att.id), `data${sanitizeExt(att.fileName || "")}`);
}

// 磁盘残留只是垃圾文件，删不掉不应阻断记录删除
export function removeAttachmentFiles(id: string): void {
  const dir = attachmentDir(id);
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error("Failed to delete attachment directory:", dir, err);
  }
}

// 允许浏览器内联预览的类型白名单。
// 明确不含 image/svg+xml 与 text/html —— 二者可在同源下执行脚本。
const INLINE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "application/pdf",
  "text/plain"
]);

// 扩展名 → MIME。multer 的 file.mimetype 直接来自客户端 Content-Type，不可信，
// 因此 Content-Type 与「能否预览」一律以磁盘扩展名推导出的这份结果为准。
const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".txt": "text/plain"
};

// 只接受字母数字扩展名，其余（含无扩展名、超长后缀）一律按 .bin 落盘
export function sanitizeExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
}

export function normalizeMime(fileName: string): string {
  return EXT_MIME[sanitizeExt(fileName)] || "application/octet-stream";
}

export function isPreviewable(mimeType: string): boolean {
  return INLINE_MIME.has(mimeType);
}

// multer 传来的 originalname 按 latin1 解码，中文文件名需按原始字节重解一次；
// 若重解出现替换字符说明本来就是合法单字节编码，保留原值
export function decodeOriginalName(raw: string): string {
  const decoded = Buffer.from(raw, "latin1").toString("utf8");
  return decoded.includes("�") ? raw : decoded;
}

// 只接受 http/https，挡掉 javascript: / data: / file: 等点击即执行或读本地文件的协议
export function normalizeHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// 名称允许留空，留空时回退：链接取地址本身，文件取原始文件名
export function resolveAttachmentName(rawName: string, fallback: string): string {
  return (rawName.trim() || fallback).slice(0, MAX_ATTACHMENT_NAME_LENGTH);
}

// RFC 5987：中文文件名必须走 filename*，否则头部会被降级成乱码。
// 同时提供 ASCII 兜底名，并剔除 CR/LF/引号防止响应头注入。
export function contentDisposition(disposition: "inline" | "attachment", fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "").trim();
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_") || "attachment";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// 对外响应头与响应体统一补上派生字段；这些字段不落盘，避免前后端对处置方式的理解分叉
export function serializeAttachment(att: Attachment) {
  return {
    ...att,
    previewable: att.type === "file" && isPreviewable(att.mimeType || ""),
    rawUrl: att.type === "file" ? `/api/attachments/${att.id}/raw` : undefined
  };
}
