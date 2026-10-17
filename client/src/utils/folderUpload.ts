import {
  MAX_PROTOTYPE_FILE_SIZE,
  MAX_PROTOTYPE_FOLDER_FILES,
  MAX_PROTOTYPE_TOTAL_SIZE
} from "../types/index.js";

export interface DroppedFile {
  file: File;
  /** 相对路径，形如 myproto/assets/a.css，与 input[webkitdirectory] 的 webkitRelativePath 同形 */
  relativePath: string;
}

const JUNK_BASENAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

// 与服务端 pathSafe.ts 同规则；前端无法 import 服务端代码，薄重复一份
export function isJunkRelativePath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.includes("__MACOSX")) return true;
  return segments.length > 0 && JUNK_BASENAMES.has(segments[segments.length - 1]);
}

/**
 * 递归读取拖拽进来的 FileSystemEntry。
 * basePath 用 entry.name 而非 entry.fullPath：拖拽得到的 File 对象 webkitRelativePath 是空串，
 * 路径必须自己重建；从 name 起算才能产出与 input[webkitdirectory] 完全同形的相对路径
 * （含根目录、无前导斜杠）。
 */
export async function readFileSystemEntry(entry: any, basePath: string): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [{ file, relativePath: basePath }];
  }
  if (!entry.isDirectory) {
    return [];
  }

  const children: any[] = [];
  const reader = entry.createReader();
  // readEntries 一次最多只返回约 100 条，必须循环读到空数组，否则大文件夹会静默丢文件
  for (;;) {
    const batch: any[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }

  const collected: DroppedFile[] = [];
  for (const child of children) {
    collected.push(...(await readFileSystemEntry(child, `${basePath}/${child.name}`)));
  }
  return collected;
}

export type FolderValidation = { ok: true; totalSize: number } | { ok: false; message: string };

export function validateFolder(files: DroppedFile[]): FolderValidation {
  if (files.length === 0) {
    return { ok: false, message: "文件夹中没有可用的文件" };
  }
  if (files.length > MAX_PROTOTYPE_FOLDER_FILES) {
    return {
      ok: false,
      message: `单次上传文件数量不能超过 ${MAX_PROTOTYPE_FOLDER_FILES} 个，当前 ${files.length} 个`
    };
  }
  const oversized = files.find((item) => item.file.size > MAX_PROTOTYPE_FILE_SIZE);
  if (oversized) {
    return {
      ok: false,
      message: `单个文件不能超过 ${MAX_PROTOTYPE_FILE_SIZE / 1024 / 1024}MB：${oversized.relativePath}`
    };
  }
  const totalSize = files.reduce((sum, item) => sum + item.file.size, 0);
  if (totalSize > MAX_PROTOTYPE_TOTAL_SIZE) {
    return {
      ok: false,
      message: `文件夹总大小不能超过 ${MAX_PROTOTYPE_TOTAL_SIZE / 1024 / 1024}MB`
    };
  }
  return { ok: true, totalSize };
}
