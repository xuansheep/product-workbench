import { Router } from "express";
import crypto from "node:crypto";
import { store } from "../db/store.js";
import type { Comment, CommentReply, CommentTargetInfo } from "../types.js";

const router = Router();

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
