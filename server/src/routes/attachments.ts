import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { store, STORAGE_DIR } from "../db/store.js";
import type { Attachment } from "../types.js";
import {
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENT_SIZE,
  attachmentDir,
  attachmentFilePath,
  contentDisposition,
  decodeOriginalName,
  isPreviewable,
  normalizeHttpUrl,
  normalizeMime,
  removeAttachmentFiles,
  resolveAttachmentName,
  sanitizeExt,
  serializeAttachment
} from "../utils/attachment.js";

const router = Router();

const upload = multer({
  dest: path.join(STORAGE_DIR, ".temp_uploads"),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 }
});

// 附件 id 由服务端生成，这里仍做形状校验，避免外部输入参与路径拼接
const ATTACHMENT_ID_PATTERN = /^att-[A-Za-z0-9-]+$/;

// 获取指定项目下所有原型的附件（列表页一次性取全）
router.get("/project/:projectId", (req, res) => {
  const list = store.getAttachmentsByProject(req.params.projectId);
  res.json({ success: true, data: list.map(serializeAttachment) });
});

// 获取指定原型的附件（评审页侧栏）
router.get("/prototype/:protoId", (req, res) => {
  const list = store.getAttachmentsByPrototype(req.params.protoId);
  res.json({ success: true, data: list.map(serializeAttachment) });
});

// 新增附件：链接直接入库，文件落盘后入库
router.post("/prototype/:protoId", (req, res) => {
  // multer 的默认错误会变成英文 HTML 500，前端 request() 只能解析出 SyntaxError，
  // 因此这里包一层，把超限与解析失败统一转成中文 JSON
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        success: false,
        message: tooLarge
          ? `附件大小不能超过 ${Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MB`
          : `附件上传失败: ${err.message}`
      });
    }
    handleCreate(req, res);
  });
});

function handleCreate(req: Request, res: Response) {
  const file = req.file;
  try {
    const proto = store.getPrototypeById(req.params.protoId);
    if (!proto || proto.isDeleted) {
      return res.status(404).json({ success: false, message: "原型不存在" });
    }

    const { type, name, url } = req.body || {};
    if (type !== "url" && type !== "file") {
      return res.status(400).json({ success: false, message: "附件类型无效" });
    }

    const rawName = typeof name === "string" ? name : "";
    if (rawName.trim().length > MAX_ATTACHMENT_NAME_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `附件名称不能超过 ${MAX_ATTACHMENT_NAME_LENGTH} 个字符`
      });
    }

    const id = `att-${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();

    if (type === "url") {
      if (file) {
        return res.status(400).json({ success: false, message: "链接类型附件不应包含文件" });
      }
      const normalizedUrl = typeof url === "string" ? normalizeHttpUrl(url) : null;
      if (!normalizedUrl) {
        return res.status(400).json({ success: false, message: "链接地址无效，仅支持 http/https 协议" });
      }
      const attachment: Attachment = {
        id,
        prototypeId: proto.id,
        name: resolveAttachmentName(rawName, normalizedUrl),
        type: "url",
        url: normalizedUrl,
        createdAt
      };
      store.saveAttachment(attachment);
      return res.status(201).json({ success: true, data: serializeAttachment(attachment) });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: "请选择要上传的附件文件" });
    }
    if (file.size === 0) {
      return res.status(400).json({ success: false, message: "不能上传空文件" });
    }

    const originalName = decodeOriginalName(file.originalname);
    const dir = attachmentDir(id);
    const target = path.join(dir, `data${sanitizeExt(originalName)}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.renameSync(file.path, target);
    } catch {
      // 临时目录与附件目录跨文件系统时 rename 会失败，退化为复制
      fs.copyFileSync(file.path, target);
      fs.unlinkSync(file.path);
    }

    const attachment: Attachment = {
      id,
      prototypeId: proto.id,
      name: resolveAttachmentName(rawName, originalName),
      type: "file",
      fileName: originalName,
      mimeType: normalizeMime(originalName),
      size: file.size,
      createdAt
    };
    try {
      store.saveAttachment(attachment);
    } catch (err: any) {
      // 入库失败要回滚已落盘的文件，否则会留下无人引用的孤儿目录
      removeAttachmentFiles(id);
      return res.status(500).json({ success: false, message: `附件保存失败: ${err.message}` });
    }
    return res.status(201).json({ success: true, data: serializeAttachment(attachment) });
  } finally {
    // 清理 multer 临时文件（文件已 rename 走时该路径已不存在）
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}

// 读取附件原始内容：服务端决定预览还是下载，前端不做类型判断
router.get("/:id/raw", (req, res) => {
  const { id } = req.params;
  if (!ATTACHMENT_ID_PATTERN.test(id)) {
    return res.status(404).json({ success: false, message: "附件不存在" });
  }
  const attachment = store.getAttachmentById(id);
  if (!attachment || attachment.type !== "file" || !attachment.mimeType) {
    return res.status(404).json({ success: false, message: "附件不存在或不是文件类型" });
  }

  const absPath = attachmentFilePath(attachment);
  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ success: false, message: "附件文件已丢失" });
  }

  // 显式指定 Content-Type：sendFile 会按磁盘扩展名（data.xxx）自行推断，不显式覆盖就可能把 .html 当网页返回
  res.setHeader("Content-Type", attachment.mimeType === "text/plain" ? "text/plain; charset=utf-8" : attachment.mimeType);
  res.setHeader("Content-Disposition", contentDisposition(isPreviewable(attachment.mimeType) ? "inline" : "attachment", attachment.name));
  // nosniff + CSP 兜底：即使内容与声明的类型不符，也无法在本应用同源下执行脚本
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.sendFile(absPath);
});

// 删除附件：先删记录再删磁盘，避免出现「记录指向已丢失文件」的坏数据
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  if (!ATTACHMENT_ID_PATTERN.test(id)) {
    return res.status(404).json({ success: false, message: "附件不存在" });
  }
  const attachment = store.getAttachmentById(id);
  if (!attachment) {
    return res.status(404).json({ success: false, message: "附件不存在" });
  }

  store.deleteAttachment(id);
  if (attachment.type === "file") {
    removeAttachmentFiles(id);
  }
  res.json({ success: true, message: "附件已删除" });
});

export default router;
