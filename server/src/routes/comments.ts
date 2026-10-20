import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { store, STORAGE_DIR } from "../db/store.js";
import {
  COMMENT_ID_PATTERN,
  MAX_SNAPSHOT_SIZE,
  isJpegFile,
  removeSnapshotFile,
  snapshotFilePath
} from "../utils/commentSnapshot.js";
import type { Comment, CommentReply, CommentSnapshot, CommentTargetInfo } from "../types.js";

const router = Router();

const snapshotUpload = multer({
  dest: path.join(STORAGE_DIR, ".temp_uploads"),
  limits: { fileSize: MAX_SNAPSHOT_SIZE, files: 1 }
});

// 快照元数据决定前端在图上还原批注点的位置，四个数值都必须落在视口范围内
function parseSnapshotMeta(body: any): Omit<CommentSnapshot, "capturedAt"> | null {
  const width = Number(body?.width);
  const height = Number(body?.height);
  const markerXPercent = Number(body?.markerXPercent);
  const markerYPercent = Number(body?.markerYPercent);
  if (!Number.isFinite(width) || width < 1 || width > 20000) return null;
  if (!Number.isFinite(height) || height < 1 || height > 20000) return null;
  if (!Number.isFinite(markerXPercent) || markerXPercent < 0 || markerXPercent > 100) return null;
  if (!Number.isFinite(markerYPercent) || markerYPercent < 0 || markerYPercent > 100) return null;
  return {
    width: Math.round(width),
    height: Math.round(height),
    markerXPercent: Math.round(markerXPercent * 100) / 100,
    markerYPercent: Math.round(markerYPercent * 100) / 100
  };
}

// 批注必须带可锚定目标，否则注入层无法定位，会产生无法渲染的批注
function isAnchorable(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as CommentTargetInfo;
  return Boolean(t.selector || t.viewContainerSelector || t.inlinePageId);
}

// 获取指定原型的所有评论（支持 ?versionId 过滤）
router.get("/prototype/:protoId", (req, res) => {
  const { versionId } = req.query;
  const list = store.getComments(req.params.protoId, typeof versionId === "string" ? versionId : undefined);
  res.json({ success: true, data: list });
});

// 新增批注（锚定到原型内部 DOM，位置由布局引擎保证）
router.post("/prototype/:protoId", (req, res) => {
  const { protoId } = req.params;
  const proto = store.getPrototypeById(protoId);
  if (!proto) {
    return res.status(404).json({ success: false, message: "原型不存在" });
  }

  const { versionId, pagePath, target, content, author } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, message: "评论内容不能为空" });
  }
  if (!isAnchorable(target)) {
    return res.status(400).json({ success: false, message: "批注缺少可锚定目标" });
  }

  const comment: Comment = {
    id: `cmt-${crypto.randomUUID().slice(0, 8)}`,
    prototypeId: protoId,
    versionId: versionId || proto.currentVersionId,
    pagePath: (pagePath || "index.html").trim(),
    target: target as CommentTargetInfo,
    content: content.trim(),
    author: {
      name: author?.name?.trim() || "匿名成员",
      avatar: author?.avatar || "avatar-1"
    },
    status: "open",
    replies: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.saveComment(comment);
  res.status(201).json({ success: true, data: comment });
});

// 保存批注创建时的页面快照。图片落盘，批注只存体积很小的元数据
router.post("/:commentId/snapshot", (req, res) => {
  snapshotUpload.single("image")(req, res, (err: any) => {
    const file = req.file;
    try {
      if (err) {
        const tooLarge = err.code === "LIMIT_FILE_SIZE";
        return res.status(tooLarge ? 413 : 400).json({
          success: false,
          message: tooLarge
            ? `页面快照大小不能超过 ${Math.round(MAX_SNAPSHOT_SIZE / 1024 / 1024)}MB`
            : `页面快照上传失败: ${err.message}`
        });
      }

      const comment = COMMENT_ID_PATTERN.test(req.params.commentId)
        ? store.getCommentById(req.params.commentId)
        : undefined;
      if (!comment) {
        return res.status(404).json({ success: false, message: "评论不存在" });
      }
      if (!file || file.size === 0) {
        return res.status(400).json({ success: false, message: "页面快照内容为空" });
      }

      const meta = parseSnapshotMeta(req.body);
      if (!meta) {
        return res.status(400).json({ success: false, message: "页面快照参数无效" });
      }
      if (!isJpegFile(file.path)) {
        return res.status(400).json({ success: false, message: "页面快照格式无效" });
      }

      const target = snapshotFilePath(comment.id);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try {
        fs.renameSync(file.path, target);
      } catch {
        // 临时目录与快照目录跨文件系统时 rename 会失败，退化为复制
        fs.copyFileSync(file.path, target);
        fs.unlinkSync(file.path);
      }

      comment.snapshot = { ...meta, capturedAt: new Date().toISOString() };
      comment.updatedAt = comment.snapshot.capturedAt;
      store.saveComment(comment);
      res.status(201).json({ success: true, data: comment });
    } catch (e: any) {
      res.status(500).json({ success: false, message: `页面快照保存失败: ${e.message}` });
    } finally {
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  });
});

// 读取页面快照。图片按评论 id 永久缓存，内容不会随批注回复变化
router.get("/:commentId/snapshot", (req, res) => {
  const comment = COMMENT_ID_PATTERN.test(req.params.commentId)
    ? store.getCommentById(req.params.commentId)
    : undefined;
  if (!comment?.snapshot) {
    return res.status(404).json({ success: false, message: "页面快照不存在" });
  }

  const file = snapshotFilePath(comment.id);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ success: false, message: "页面快照文件已丢失" });
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(file);
});

// 回复评论
router.post("/:commentId/replies", (req, res) => {
  const comment = store.getCommentById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ success: false, message: "评论不存在" });
  }

  const { content, author } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, message: "回复内容不能为空" });
  }

  const reply: CommentReply = {
    id: `rpl-${crypto.randomUUID().slice(0, 8)}`,
    commentId: comment.id,
    content: content.trim(),
    author: {
      name: author?.name?.trim() || "团队成员",
      avatar: author?.avatar || "avatar-1"
    },
    createdAt: new Date().toISOString()
  };

  comment.replies.push(reply);
  comment.updatedAt = new Date().toISOString();
  store.saveComment(comment);

  res.status(201).json({ success: true, data: reply, comment });
});

// 切换评论状态（open / resolved）
router.patch("/:commentId/status", (req, res) => {
  const comment = store.getCommentById(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ success: false, message: "评论不存在" });
  }

  const { status } = req.body;
  if (status !== "open" && status !== "resolved") {
    return res.status(400).json({ success: false, message: "状态值不合法" });
  }

  comment.status = status;
  comment.updatedAt = new Date().toISOString();
  store.saveComment(comment);
  res.json({ success: true, data: comment });
});

// 删除评论
router.delete("/:commentId", (req, res) => {
  const comment = store.getCommentById(req.params.commentId);
  const deleted = store.deleteComment(req.params.commentId);
  if (!deleted) {
    return res.status(404).json({ success: false, message: "评论不存在" });
  }
  // 记录删掉后快照文件再无入口，顺手清理，避免磁盘上留下孤儿图片
  if (comment) removeSnapshotFile(comment.id);
  res.json({ success: true, message: "评论已删除" });
});

export default router;
