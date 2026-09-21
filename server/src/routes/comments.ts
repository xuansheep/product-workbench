import { Router } from "express";
import crypto from "node:crypto";
import { store } from "../db/store.js";
import type { Comment, CommentReply } from "../types.js";

const router = Router();

// 获取指定原型的所有评论（支持 ?versionId 过滤）
router.get("/prototype/:protoId", (req, res) => {
  const { versionId } = req.query;
  const list = store.getComments(req.params.protoId, typeof versionId === "string" ? versionId : undefined);
  res.json({ success: true, data: list });
});

// 新增批注（支持元素吸附与文档级绝对坐标）
router.post("/prototype/:protoId", (req, res) => {
  const { protoId } = req.params;
  const proto = store.getPrototypeById(protoId);
  if (!proto) {
    return res.status(404).json({ success: false, message: "原型不存在" });
  }

  const { versionId, pagePath, xPercent, yPercent, docX, docY, target, content, author } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, message: "评论内容不能为空" });
  }
  if (typeof xPercent !== "number" || typeof yPercent !== "number") {
    return res.status(400).json({ success: false, message: "批注坐标参数无效" });
  }

  const comment: Comment = {
    id: `cmt-${crypto.randomUUID().slice(0, 8)}`,
    prototypeId: protoId,
    versionId: versionId || proto.currentVersionId,
    pagePath: (pagePath || "index.html").trim(),
    xPercent: Math.max(0, Math.min(100, xPercent)),
    yPercent: Math.max(0, Math.min(100, yPercent)),
    docX: typeof docX === "number" ? docX : undefined,
    docY: typeof docY === "number" ? docY : undefined,
    target: target && typeof target === "object" ? target : undefined,
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
  const deleted = store.deleteComment(req.params.commentId);
  if (!deleted) {
    return res.status(404).json({ success: false, message: "评论不存在" });
  }
  res.json({ success: true, message: "评论已删除" });
});

export default router;
