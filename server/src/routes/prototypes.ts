import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { store, STORAGE_DIR } from "../db/store.js";
import { extractZipSafely } from "../utils/archive.js";
import type { Prototype, PrototypeVersion } from "../types.js";

const router = Router();
const upload = multer({ dest: path.join(STORAGE_DIR, ".temp_uploads") });

// 获取指定项目下的原型列表
router.get("/project/:projectId", (req, res) => {
  const list = store.getPrototypes(req.params.projectId);
  res.json({ success: true, data: list });
});

// 获取原型详情及所有历史版本
router.get("/:id", (req, res) => {
  const proto = store.getPrototypeById(req.params.id);
  if (!proto || proto.isDeleted) {
    return res.status(404).json({ success: false, message: "原型不存在或已被删除" });
  }
  res.json({ success: true, data: proto });
});

// 新建原型并上传第一个版本
router.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  const { projectId, name, description, changelog } = req.body;

  if (!file) {
    return res.status(400).json({ success: false, message: "请上传原型文件 (.zip 或 .html)" });
  }
  if (!projectId || !store.getProjectById(projectId)) {
    return res.status(400).json({ success: false, message: "所选项目不存在" });
  }

  const protoName = (name && name.trim()) || path.parse(file.originalname).name || "新原型";
  const protoId = `proto-${crypto.randomUUID().slice(0, 8)}`;
  const versionId = `v-1-${crypto.randomUUID().slice(0, 6)}`;
  const versionDir = path.join(STORAGE_DIR, "prototypes", protoId, "v1");

  fs.mkdirSync(versionDir, { recursive: true });

  let entryFile = "index.html";
  const originalExt = path.extname(file.originalname).toLowerCase();

  try {
    const uploaded = fs.readFileSync(file.path);

    if (originalExt === ".zip") {
      const extracted = extractZipSafely(uploaded, versionDir);
      entryFile = extracted.entryFile;
    } else {
      // 单文件 html 或其他
      const targetFileName = originalExt === ".html" || originalExt === ".htm" ? "index.html" : file.originalname;
      fs.writeFileSync(path.join(versionDir, targetFileName), uploaded);
      entryFile = targetFileName;
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: `原型解压或解析失败: ${err.message}` });
  } finally {
    // 清理 multer 临时文件
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }

  const initialVersion: PrototypeVersion = {
    id: versionId,
    versionNumber: 1,
    versionLabel: "v1.0",
    changelog: changelog?.trim() || "初始版本上传",
    entryFile,
    storageDir: `/prototypes/${protoId}/v1`,
    createdAt: new Date().toISOString()
  };

  const newProto: Prototype = {
    id: protoId,
    projectId,
    name: protoName,
    description: (description || "").trim(),
    currentVersionId: versionId,
    versions: [initialVersion],
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.savePrototype(newProto);
  res.status(201).json({ success: true, data: newProto });
});

// 给已有的原型追加新版本
router.post("/:id/versions", upload.single("file"), (req, res) => {
  const proto = store.getPrototypeById(req.params.id);
  if (!proto || proto.isDeleted) {
    return res.status(404).json({ success: false, message: "原型不存在" });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, message: "请上传新版本文件 (.zip 或 .html)" });
  }

  const maxVersionNum = proto.versions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
  const nextVersionNum = Math.max(proto.versions.length, maxVersionNum) + 1;
  const versionId = `v-${nextVersionNum}-${crypto.randomUUID().slice(0, 6)}`;
  const versionDir = path.join(STORAGE_DIR, "prototypes", proto.id, `v${nextVersionNum}`);

  fs.mkdirSync(versionDir, { recursive: true });

  let entryFile = "index.html";
  const originalExt = path.extname(file.originalname).toLowerCase();

  try {
    const uploaded = fs.readFileSync(file.path);

    if (originalExt === ".zip") {
      const extracted = extractZipSafely(uploaded, versionDir);
      entryFile = extracted.entryFile;
    } else {
      const targetFileName = originalExt === ".html" || originalExt === ".htm" ? "index.html" : file.originalname;
      fs.writeFileSync(path.join(versionDir, targetFileName), uploaded);
      entryFile = targetFileName;
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: `新版本解压失败: ${err.message}` });
  } finally {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }

  const { changelog } = req.body;
  const newVersion: PrototypeVersion = {
    id: versionId,
    versionNumber: nextVersionNum,
    versionLabel: `v${nextVersionNum}.0`,
    changelog: changelog?.trim() || `更新版本 v${nextVersionNum}.0`,
    entryFile,
    storageDir: `/prototypes/${proto.id}/v${nextVersionNum}`,
    createdAt: new Date().toISOString()
  };

  proto.versions.unshift(newVersion); // 新版本排在前面
  proto.currentVersionId = versionId;
  proto.updatedAt = new Date().toISOString();

  store.savePrototype(proto);
  res.status(201).json({ success: true, data: proto });
});

// 编辑原型基础信息
router.put("/:id", (req, res) => {
  const proto = store.getPrototypeById(req.params.id);
  if (!proto || proto.isDeleted) {
    return res.status(404).json({ success: false, message: "原型不存在" });
  }
  const { name, description } = req.body;
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ success: false, message: "名称不能为空" });
    proto.name = name.trim();
  }
  if (description !== undefined) {
    proto.description = description.trim();
  }
  proto.updatedAt = new Date().toISOString();
  store.savePrototype(proto);
  res.json({ success: true, data: proto });
});

// 软删除原型进入回收站
router.delete("/:id", (req, res) => {
  const proto = store.getPrototypeById(req.params.id);
  if (!proto) {
    return res.status(404).json({ success: false, message: "原型不存在" });
  }
  proto.isDeleted = true;
  proto.deletedAt = new Date().toISOString();
  proto.updatedAt = new Date().toISOString();
  store.savePrototype(proto);
  res.json({ success: true, message: "原型已移入回收站" });
});

export default router;
