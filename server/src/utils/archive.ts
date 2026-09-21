import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

export interface ExtractedPrototypeResult {
  entryFile: string;
}

/**
 * 安全解压 Zip 文件，防御 Zip Slip 路径逃逸
 */
export function extractZipSafely(zipFilePath: string, targetDir: string): ExtractedPrototypeResult {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const zip = new AdmZip(zipFilePath);
  const zipEntries = zip.getEntries();
  const normalizedTargetDir = path.resolve(targetDir);

  for (const entry of zipEntries) {
    const resolvedPath = path.resolve(normalizedTargetDir, entry.entryName);
    // 防御 Zip Slip
    if (!resolvedPath.startsWith(normalizedTargetDir)) {
      throw new Error(`Malicious zip entry path detected: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      fs.mkdirSync(resolvedPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, entry.getData());
    }
  }

  // 智能嗅探默认入口 HTML
  const entryFile = detectEntryFile(normalizedTargetDir);
  return { entryFile };
}

/**
 * 递归嗅探入口 HTML 文件
 * 1. 优先找根目录 index.html / index.htm
 * 2. 次优先找单层根子目录内的 index.html
 * 3. 兜底找出现的第一个 .html 文件
 */
export function detectEntryFile(baseDir: string): string {
  // 检查根目录
  const rootIndex = ["index.html", "index.htm", "default.html", "home.html"].find((name) =>
    fs.existsSync(path.join(baseDir, name))
  );
  if (rootIndex) {
    return rootIndex;
  }

  // 递归寻找所有 html 文件
  const htmlFiles: string[] = [];
  function scan(dir: string, relativePrefix = "") {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const rel = relativePrefix ? `${relativePrefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        scan(path.join(dir, item.name), rel);
      } else if (item.name.toLowerCase().endsWith(".html") || item.name.toLowerCase().endsWith(".htm")) {
        htmlFiles.push(rel);
      }
    }
  }

  scan(baseDir);

  if (htmlFiles.length === 0) {
    // 自动生成一个默认占位页面
    const fallbackFile = "index.html";
    fs.writeFileSync(
      path.join(baseDir, fallbackFile),
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>原型预览</title></head><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>原型展示页面</h2><p>当前原型未包含独立的 HTML 入口文件。</p></body></html>`,
      "utf-8"
    );
    return fallbackFile;
  }

  // 优先挑选名字为 index.html 的
  const exactIndex = htmlFiles.find((f) => f.toLowerCase().endsWith("/index.html") || f.toLowerCase() === "index.html");
  if (exactIndex) {
    return exactIndex;
  }

  return htmlFiles[0];
}
