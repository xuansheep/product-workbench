import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import { decodeOriginalName } from "./attachment.js";
import { detectEntryFile, extractZipSafely } from "./archive.js";
import { assertInsideBase, commonRootSegment, isJunkPath, normalizeRelativePath } from "./pathSafe.js";

// 上限沿用 attachment.ts 的环境变量房风格，便于测试用小文件覆盖超限分支
export const MAX_PROTOTYPE_FILE_SIZE =
  Number(process.env.WORKBENCH_PROTOTYPE_FILE_MAX_SIZE) || 20 * 1024 * 1024;
export const MAX_PROTOTYPE_ZIP_SIZE =
  Number(process.env.WORKBENCH_PROTOTYPE_ZIP_MAX_SIZE) || 200 * 1024 * 1024;
export const MAX_PROTOTYPE_FOLDER_FILES =
  Number(process.env.WORKBENCH_PROTOTYPE_MAX_FILES) || 1000;
export const MAX_PROTOTYPE_TOTAL_SIZE =
  Number(process.env.WORKBENCH_PROTOTYPE_TOTAL_MAX_SIZE) || 200 * 1024 * 1024;

// 扩展名白名单只作用于「单文件上传分支」。文件夹与 zip 内部不做限制——
// 静态站点本来就含 js/css/png/woff，那正是本功能要托管的内容。
const SINGLE_FILE_EXTENSIONS = [".zip", ".html", ".htm"];

export class UploadError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export type UploadMode = "single" | "folder";

export interface CollectedUpload {
  mode: UploadMode;
  files: Express.Multer.File[];
  totalSize: number;
}

export interface StagedPrototype {
  entryFile: string;
  /** 文件夹上传时被剥离的根目录名；单文件与 zip 为 null */
  folderRootName: string | null;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / 1024 / 1024)}MB`
    : `${Math.round(bytes / 1024)}KB`;
}

/**
 * upload.fields() 之后 req.files 是 { [field]: File[] }，req.file 不再存在。
 * 取全量文件用于兜底清理临时文件。
 */
export function allUploadedFiles(req: Request): Express.Multer.File[] {
  const uploaded = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  return [...(uploaded.file ?? []), ...(uploaded.files ?? [])];
}

/**
 * 把请求分流成「单文件」或「文件夹」两种上传模式。
 * multer 的 limits.fileSize 只能全局设一个值（这里按 zip 的 200MB 兜底），
 * 因此文件夹内单文件 20MB、总量 200MB 的约束在这里逐项校验。
 */
export function collectPrototypeUpload(req: Request): CollectedUpload {
  const uploaded = (req.files as Record<string, Express.Multer.File[]> | undefined) ?? {};
  const single = uploaded.file ?? [];
  const folder = uploaded.files ?? [];

  if (single.length > 0 && folder.length > 0) {
    throw new UploadError(400, "不能同时提交单个文件与文件夹，请重新选择");
  }

  if (folder.length > 0) {
    const totalSize = folder.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_PROTOTYPE_TOTAL_SIZE) {
      throw new UploadError(413, `文件夹总大小不能超过 ${formatSize(MAX_PROTOTYPE_TOTAL_SIZE)}`);
    }
    for (const file of folder) {
      if (file.size > MAX_PROTOTYPE_FILE_SIZE) {
        throw new UploadError(
          413,
          `单个文件不能超过 ${formatSize(MAX_PROTOTYPE_FILE_SIZE)}：${decodeOriginalName(file.originalname)}`
        );
      }
    }
    return { mode: "folder", files: folder, totalSize };
  }

  if (single.length > 0) {
    return { mode: "single", files: [single[0]], totalSize: single[0].size };
  }

  throw new UploadError(400, "请上传原型文件（.zip、.html 或整个文件夹）");
}

/**
 * 把上传内容物化到 stagingDir，返回入口文件相对路径。
 * 调用方在全部成功后负责把 stagingDir 原子 rename 成版本目录。
 */
export function stagePrototypeFiles(
  mode: UploadMode,
  files: Express.Multer.File[],
  stagingDir: string
): StagedPrototype {
  fs.mkdirSync(stagingDir, { recursive: true });
  return mode === "single" ? stageSingleFile(files[0], stagingDir) : stageFolder(files, stagingDir);
}

function stageSingleFile(file: Express.Multer.File, stagingDir: string): StagedPrototype {
  const originalName = decodeOriginalName(file.originalname);
  const ext = path.extname(originalName).toLowerCase();

  if (!SINGLE_FILE_EXTENSIONS.includes(ext)) {
    throw new UploadError(400, "单文件仅支持 .zip / .html / .htm，整个文件夹请用「选择文件夹」");
  }

  if (ext === ".zip") {
    if (file.size > MAX_PROTOTYPE_ZIP_SIZE) {
      throw new UploadError(413, `压缩包不能超过 ${formatSize(MAX_PROTOTYPE_ZIP_SIZE)}`);
    }
    const { entryFile } = extractZipSafely(fs.readFileSync(file.path), stagingDir);
    return { entryFile, folderRootName: null };
  }

  if (file.size > MAX_PROTOTYPE_FILE_SIZE) {
    throw new UploadError(413, `单个文件不能超过 ${formatSize(MAX_PROTOTYPE_FILE_SIZE)}`);
  }
  // 落盘名固定，originalname 完全不参与路径拼接，从根上消除单文件分支的路径逃逸面
  moveFile(file.path, path.join(stagingDir, "index.html"));
  return { entryFile: "index.html", folderRootName: null };
}

function stageFolder(files: Express.Multer.File[], stagingDir: string): StagedPrototype {
  // multer 的 originalname 按 latin1 解码，中文路径需重解；再逐段做安全校验
  const entries = files.map((file) => ({
    file,
    relativePath: normalizeRelativePath(decodeOriginalName(file.originalname))
  }));

  // 必须先滤垃圾再求公共首段：否则 __MACOSX/ 与 myproto/ 首段不同，根目录不会被剥离
  const kept = entries.filter((entry) => !isJunkPath(entry.relativePath));
  if (kept.length === 0) {
    throw new UploadError(400, "文件夹中没有可用的文件（可能只包含系统垃圾文件）");
  }

  const root = commonRootSegment(kept.map((entry) => entry.relativePath));
  for (const { file, relativePath } of kept) {
    const target = root ? relativePath.slice(root.length + 1) : relativePath;
    const destination = assertInsideBase(stagingDir, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    moveFile(file.path, destination);
  }

  return { entryFile: detectEntryFile(stagingDir), folderRootName: root };
}

/** 单文件模式的默认原型名：上传文件名去掉扩展名 */
export function defaultPrototypeName(upload: CollectedUpload): string | null {
  if (upload.mode !== "single") return null;
  const originalName = decodeOriginalName(upload.files[0].originalname);
  const ext = path.extname(originalName);
  return ext ? originalName.slice(0, -ext.length) : originalName;
}

export function cleanupMulterFiles(files: Express.Multer.File[]): void {
  for (const file of files) {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}

/** 磁盘残留只是垃圾文件，删不掉不应阻断请求 */
export function removeDirQuietly(dir: string): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error("Failed to clean up directory:", dir, err);
  }
}

export function toErrorResponse(err: any, fallbackPrefix: string): { status: number; message: string } {
  if (err instanceof UploadError) {
    return { status: err.status, message: err.message };
  }
  return { status: 500, message: `${fallbackPrefix}: ${err?.message ?? "未知错误"}` };
}

/** multer 自身的错误默认是英文 HTML 500，前端 request() 只能解析出 SyntaxError，故统一转中文 JSON */
export function multerErrorMessage(err: any): { status: number; message: string } {
  switch (err?.code) {
    case "LIMIT_FILE_SIZE":
      return { status: 413, message: `单个文件不能超过 ${formatSize(MAX_PROTOTYPE_ZIP_SIZE)}` };
    case "LIMIT_FILE_COUNT":
      return { status: 413, message: `单次上传文件数量不能超过 ${MAX_PROTOTYPE_FOLDER_FILES} 个` };
    case "LIMIT_UNEXPECTED_FILE":
      return { status: 400, message: "上传字段不合法，请重新选择文件" };
    default:
      return { status: 400, message: `原型上传失败: ${err?.message ?? "未知错误"}` };
  }
}

// 临时目录与存储目录跨文件系统时 rename 会失败，退化为复制
function moveFile(source: string, destination: string): void {
  try {
    fs.renameSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
}
