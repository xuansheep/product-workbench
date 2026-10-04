import path from "node:path";

/**
 * 归一化上传/压缩包条目里的相对路径，并拒绝一切可逃逸出目标目录的形态。
 * 判定顺序即安全边界（先后斜杠归一 → 绝对路径 → 盘符 → 逐段校验），不要调整。
 */
export function normalizeRelativePath(relativePath: string): string {
  // Windows 工具产出的条目可能用反斜杠；先归一，否则后续按 / 分段会漏判
  // 去尾斜杠是因为 zip 的目录条目形如 "css/"，属合法条目，不能当成空段拒绝
  const raw = relativePath.replace(/\\/g, "/").replace(/\/+$/, "");

  if (!raw) {
    throw new Error(`Path is empty: ${relativePath}`);
  }
  if (raw.startsWith("/")) {
    throw new Error(`Absolute path is not allowed: ${relativePath}`);
  }
  // darwin/linux 上 path.isAbsolute("C:\\x") 返回 false，盘符必须显式判
  if (/^[A-Za-z]:\//.test(raw)) {
    throw new Error(`Drive-letter path is not allowed: ${relativePath}`);
  }

  for (const segment of raw.split("/")) {
    if (segment === "" || segment === "..") {
      throw new Error(`Unsafe path segment in: ${relativePath}`);
    }
  }

  return raw;
}

/**
 * 把相对路径解析成 targetDir 内的绝对路径，越界即抛错。
 * 用 path.relative 而非 startsWith 判断：targetDir 为 /a/v1 时，
 * 旧的 startsWith("/a/v1") 会误放行 /a/v1evil/x，而 path.relative 会得到 ../v1evil/x。
 */
export function assertInsideBase(baseDir: string, relativePath: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, normalizeRelativePath(relativePath));
  const back = path.relative(base, resolved);

  if (back === "" || back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`Path escapes target directory: ${relativePath}`);
  }
  return resolved;
}

const JUNK_BASENAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/**
 * 判定系统垃圾条目。__MACOSX 按任意一段命中即丢（要连带其下全部内容），
 * 其余三个按文件名命中。这里刻意不做严格校验——它是过滤器不是守卫，
 * 遇到畸形路径应当放行交给 assertInsideBase 去拒绝。
 */
export function isJunkPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return false;

  const segments = normalized.split("/");
  if (segments.includes("__MACOSX")) return true;
  return JUNK_BASENAMES.has(segments[segments.length - 1]);
}

/**
 * 求所有路径的公共首段，仅当首段完全一致且每条路径去掉首段后仍有内容时返回它。
 * 用于剥离「整个文件夹上传」时自带的那层根目录，使 URL 形态与压缩包一致。
 */
export function commonRootSegment(paths: string[]): string | null {
  if (paths.length === 0) return null;

  const root = paths[0].split("/")[0];
  const allSameRoot = paths.every((p) => p.split("/")[0] === root);
  const allHaveContent = paths.every((p) => p.length > root.length + 1);

  return allSameRoot && allHaveContent ? root : null;
}
