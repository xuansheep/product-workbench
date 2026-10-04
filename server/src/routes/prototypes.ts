import { Router, type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { store, STORAGE_DIR } from "../db/store.js";
import {
  MAX_PROTOTYPE_FOLDER_FILES,
  MAX_PROTOTYPE_ZIP_SIZE,
  allUploadedFiles,
  cleanupMulterFiles,
  collectPrototypeUpload,
  defaultPrototypeName,
  multerErrorMessage,
  removeDirQuietly,
  stagePrototypeFiles,
  toErrorResponse,
  type CollectedUpload,
  type StagedPrototype
} from "../utils/prototypeUpload.js";
import type { Prototype, PrototypeVersion } from "../types.js";

const router = Router();

const upload = multer({
  dest: path.join(STORAGE_DIR, ".temp_uploads"),
  // 必须开：multer 默认会（经 busboy）把 originalname 砍成 basename，
  // 那样文件夹上传的 myproto/css/a.css 会全部退化成裸文件名并互相覆盖，功能直接失效。
  // 开启后 originalname 才是完整相对路径，交由 normalizeRelativePath 做安全校验。
  preservePath: true,
  limits: {
    // fileSize 是「每文件」上限且 multer 无法按字段分别设置，这里用 zip 的 200MB 兜底；
    // 文件夹内单文件 20MB 与总量 200MB 由 collectPrototypeUpload 逐项校验
    fileSize: MAX_PROTOTYPE_ZIP_SIZE,
    files: MAX_PROTOTYPE_FOLDER_FILES,
    fields: 20,
    fieldSize: 100 * 1024
  }
});

// 单个文件走 file 字段、整文件夹走 files 字段，upload.single/array 互斥故用 fields
const uploadPrototype = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "files", maxCount: MAX_PROTOTYPE_FOLDER_FILES }
]);

// multer 自身的错误默认会变成英文 HTML 500，前端 request() 只能解析出 SyntaxError
function receiveUpload(req: Request, res: Response, next: NextFunction) {
  uploadPrototype(req, res, (err: any) => {
    if (err) {
      const { status, message } = multerErrorMessage(err);
      return res.status(status).json({ success: false, message });
    }
    next();
  });
}

/**
 * 把上传内容物化到 staging 目录，全部成功后再原子 rename 为版本目录。
 * 中途失败不会在版本目录里留下半个站点。
 */
function buildVersionDir(
  collected: CollectedUpload,
  stagingDir: string,
  versionDir: string
): StagedPrototype {
  const staged = stagePrototypeFiles(collected.mode, collected.files, stagingDir);
  fs.renameSync(stagingDir, versionDir);
  return staged;
}

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
router.post("/upload", receiveUpload, (req, res) => {
  const uploaded = allUploadedFiles(req);
  let protoDir = "";
  let versionDir = "";
  let stagingDir = "";
  let committed = false;

  try {
    const { projectId, name, description, changelog } = req.body;
    const collected = collectPrototypeUpload(req);

    if (!projectId || !store.getProjectById(projectId)) {
      return res.status(400).json({ success: false, message: "所选项目不存在" });
    }

    const protoId = `proto-${crypto.randomUUID().slice(0, 8)}`;
    const versionId = `v-1-${crypto.randomUUID().slice(0, 6)}`;
    protoDir = path.join(STORAGE_DIR, "prototypes", protoId);
    versionDir = path.join(protoDir, "v1");
    stagingDir = path.join(protoDir, `.staging-${crypto.randomUUID().slice(0, 8)}`);

    const { entryFile, folderRootName } = buildVersionDir(collected, stagingDir, versionDir);
    const protoName = (name && name.trim()) || folderRootName || defaultPrototypeName(collected) || "新原型";

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
    committed = true;
    return res.status(201).json({ success: true, data: newProto });
  } catch (err) {
    removeDirQuietly(stagingDir);
    if (!committed) {
      removeDirQuietly(versionDir);
      // staging 的 mkdirSync 会隐式建出 protoDir，不入库就成了无人引用的孤儿目录；
      // 回收站按 DB 记录里的 protoId 反查磁盘，清不到它，必须在这里回滚
      removeDirQuietly(protoDir);
    }
    const { status, message } = toErrorResponse(err, "原型解压或解析失败");
    return res.status(status).json({ success: false, message });
  } finally {
    cleanupMulterFiles(uploaded);
  }
});

// 给已有的原型追加新版本
router.post("/:id/versions", receiveUpload, (req, res) => {
  const uploaded = allUploadedFiles(req);
  let versionDir = "";
  let stagingDir = "";
  let committed = false;

  try {
    const proto = store.getPrototypeById(req.params.id);
    if (!proto || proto.isDeleted) {
      return res.status(404).json({ success: false, message: "原型不存在" });
    }

    const collected = collectPrototypeUpload(req);
    const { changelog } = req.body;

    const maxVersionNum = proto.versions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
    const nextVersionNum = Math.max(proto.versions.length, maxVersionNum) + 1;
    const versionId = `v-${nextVersionNum}-${crypto.randomUUID().slice(0, 6)}`;
    const protoDir = path.join(STORAGE_DIR, "prototypes", proto.id);
    versionDir = path.join(protoDir, `v${nextVersionNum}`);
    stagingDir = path.join(protoDir, `.staging-${crypto.randomUUID().slice(0, 8)}`);

    const { entryFile } = buildVersionDir(collected, stagingDir, versionDir);

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
    committed = true;
    return res.status(201).json({ success: true, data: proto });
  } catch (err) {
    removeDirQuietly(stagingDir);
    // 不删 protoDir —— 该原型已存在且已在库中
    if (!committed) removeDirQuietly(versionDir);
    const { status, message } = toErrorResponse(err, "新版本解压失败");
    return res.status(status).json({ success: false, message });
  } finally {
    cleanupMulterFiles(uploaded);
  }
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
