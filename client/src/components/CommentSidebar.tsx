import React, { useState, useMemo } from "react";
import {
  X,
  MessageSquare,
  CheckCircle2,
  Circle,
  CornerDownRight,
  Send,
  Trash2,
  Filter,
  Layers,
  Pin,
  Compass,
  ArrowUpRight,
  Crosshair
} from "lucide-react";
import { type Comment, type UserAccount, PRESET_AVATARS } from "../types/index.js";
import { ConfirmModal } from "./common/ConfirmModal.js";

interface CommentSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  comments: Comment[];
  currentSubPath: string;
  activeCommentId: string | null;
  onSelectComment: (id: string | null) => void;
  onToggleStatus: (commentId: string, currentStatus: "open" | "resolved") => Promise<void>;
  onAddReply: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onNavigateToPage?: (pagePath: string) => void;
  currentVersionLabel: string;
  account: UserAccount;
}

export const CommentSidebar: React.FC<CommentSidebarProps> = ({
  isOpen,
  onClose,
  comments,
  currentSubPath,
  activeCommentId,
  onSelectComment,
  onToggleStatus,
  onAddReply,
  onDeleteComment,
  onNavigateToPage,
  currentVersionLabel,
  account
}) => {
  const [scope, setScope] = useState<"current" | "all">("current");
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "resolved">("all");
  const [replyInputMap, setReplyInputMap] = useState<Record<string, string>>({});
  const [submittingReplyId, setSubmittingReplyId] = useState<string | null>(null);

  // 自定义删除确认弹窗状态
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const norm = (p?: string) => (p || "index.html").replace(/^\//, "");
  const currNorm = norm(currentSubPath);

  // 范围过滤
  const scopedComments = comments.filter((c) => {
    if (scope === "current") {
      return norm(c.pagePath) === currNorm;
    }
    return true;
  });

  // 状态过滤
  const filteredComments = scopedComments.filter((c) => {
    if (filterStatus === "open") return c.status === "open";
    if (filterStatus === "resolved") return c.status === "resolved";
    return true;
  });

  const handleReplyChange = (commentId: string, text: string) => {
    setReplyInputMap((prev) => ({ ...prev, [commentId]: text }));
  };

  const handleSendReply = async (commentId: string) => {
    const text = (replyInputMap[commentId] || "").trim();
    if (!text) return;
    setSubmittingReplyId(commentId);
    try {
      await onAddReply(commentId, text);
      setReplyInputMap((prev) => ({ ...prev, [commentId]: "" }));
    } finally {
      setSubmittingReplyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingCommentId) return;
    try {
      await onDeleteComment(deletingCommentId);
    } finally {
      setDeletingCommentId(null);
    }
  };

  // 维护按创建时间升序排序的全局序号映射，最早创建的评论永远是 #1
  const commentIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...comments].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    sorted.forEach((c, idx) => {
      map.set(c.id, idx + 1);
    });
    return map;
  }, [comments]);

  const currentCount = comments.filter((c) => norm(c.pagePath) === currNorm).length;
  const openCount = scopedComments.filter((c) => c.status === "open").length;

  if (!isOpen) return null;

  return (
    <>
      <aside className="w-80 sm:w-96 bg-white border-l border-slate-200 flex flex-col h-full shadow-2xl z-30 select-none animate-in slide-in-from-right duration-200">
        {/* 标题栏 */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-2">
                <span>批注与协作</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                  {openCount} 待处理
                </span>
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 切换当前页面 vs 全部批注 */}
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center space-x-1">
          <button
            onClick={() => setScope("current")}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
              scope === "current"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            当前页面 ({currentCount})
          </button>
          <button
            onClick={() => setScope("all")}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
              scope === "all"
                ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            全部批注 ({comments.length})
          </button>
        </div>

        {/* 状态筛选标签 */}
        <div className="px-4 py-2 bg-slate-50/80 border-b border-slate-100 flex items-center space-x-1 text-xs">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
              filterStatus === "all"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            全部 ({scopedComments.length})
          </button>
          <button
            onClick={() => setFilterStatus("open")}
            className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
              filterStatus === "open"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            待处理 ({openCount})
          </button>
          <button
            onClick={() => setFilterStatus("resolved")}
            className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
              filterStatus === "resolved"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            已解决 ({scopedComments.length - openCount})
          </button>
        </div>

        {/* 评论列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {filteredComments.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">暂无批注</p>
              <p className="text-[10px] mt-1">快捷键 C 或点击开始批注</p>
            </div>
          ) : (
            filteredComments.map((comment) => {
              const pinNumber = commentIndexMap.get(comment.id) || 1;
              const isResolved = comment.status === "resolved";
              const isActive = comment.id === activeCommentId;
              const isDifferentPage = norm(comment.pagePath) !== currNorm;
              const avatarInfo =
                PRESET_AVATARS.find((a) => a.id === comment.author.avatar) || PRESET_AVATARS[0];

              return (
                <div
                  key={comment.id}
                  onClick={() => {
                    onSelectComment(comment.id);
                  }}
                  title="点击立即在页面中定位到对应位置"
                  className={`p-4 rounded-2xl border transition-all cursor-pointer group ${
                    isActive
                      ? "border-indigo-500 bg-indigo-50/25 shadow-md ring-2 ring-indigo-500/10"
                      : isResolved
                      ? "border-slate-200/80 bg-slate-50/60 opacity-80 hover:border-slate-300"
                      : "border-slate-200/80 bg-white hover:border-indigo-300 hover:shadow-sm"
                  }`}
                >
                  {/* 所属页面与元素锚定徽章 */}
                  <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                    <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 min-w-0">
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono shrink-0 ${
                        isActive
                          ? "bg-indigo-600 text-white shadow-sm"
                          : isResolved
                          ? "bg-slate-200 text-slate-500"
                          : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                      }`}>
                        #{pinNumber}
                      </span>
                      <Compass className="w-3 h-3 text-indigo-500 shrink-0" />
                      <span className="font-mono text-slate-600 truncate">{comment.pagePath}</span>
                    </div>

                    {isDifferentPage ? (
                      <span className="flex items-center space-x-0.5 text-[10px] text-indigo-600 font-semibold shrink-0 group-hover:underline">
                        <span>跳转并定位</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </span>
                    ) : (
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-0.5 text-[10px] text-indigo-500 font-medium shrink-0">
                        <span>定位</span>
                        <Crosshair className="w-3 h-3" />
                      </span>
                    )}
                  </div>

                  {/* 头部信息 */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${avatarInfo.bg} text-white shrink-0`}
                      >
                        {avatarInfo.emoji}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-800 leading-none">
                          {comment.author.name}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {new Date(comment.createdAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </span>
                      </div>
                    </div>

                    {/* 状态与删除操作 */}
                    <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onToggleStatus(comment.id, comment.status)}
                        title={isResolved ? "重新打开" : "标记为已解决"}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                          isResolved
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : "bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600"
                        }`}
                      >
                        {isResolved ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>已解决</span>
                          </>
                        ) : (
                          <>
                            <Circle className="w-3 h-3 text-slate-400" />
                            <span>待处理</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setDeletingCommentId(comment.id)}
                        title="删除此评论"
                        className="p-1 text-slate-300 hover:text-rose-500 rounded-md transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* 锚定元素标签 */}
                  {comment.target?.tagName && (
                    <div className="mt-2 inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600 max-w-full">
                      <Pin className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                      <span className="font-semibold uppercase">{comment.target.tagName}</span>
                      {comment.target.innerTextSnippet && (
                        <span className="text-slate-400 truncate">: "{comment.target.innerTextSnippet}"</span>
                      )}
                    </div>
                  )}

                  {/* 评论正文 */}
                  <p className="text-xs text-slate-800 font-normal leading-relaxed mt-2 whitespace-pre-wrap">
                    {comment.content}
                  </p>

                  {/* 回复列表 */}
                  {comment.replies && comment.replies.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
                      {comment.replies.map((reply) => {
                        const repAvatar =
                          PRESET_AVATARS.find((a) => a.id === reply.author.avatar) || PRESET_AVATARS[0];
                        return (
                          <div key={reply.id} className="flex items-start space-x-2 bg-slate-50 p-2 rounded-xl">
                            <div
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${repAvatar.bg} text-white shrink-0`}
                            >
                              {repAvatar.emoji}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-slate-700">{reply.author.name}</span>
                                <span className="text-[9px] text-slate-400">
                                  {new Date(reply.createdAt).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit"
                                  })}
                                </span>
                              </div>
                              <p className="text-xs text-slate-700 mt-0.5 leading-relaxed font-normal">{reply.content}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 回复输入框 */}
                  <div
                    className="mt-2.5 pt-2 border-t border-slate-100 flex items-center space-x-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={replyInputMap[comment.id] || ""}
                      onChange={(e) => handleReplyChange(comment.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSendReply(comment.id);
                      }}
                      placeholder="回复此条批注..."
                      className="flex-1 px-2.5 py-1 text-xs text-slate-900 bg-white placeholder:text-slate-400 font-medium rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
                    />
                    <button
                      onClick={() => handleSendReply(comment.id)}
                      disabled={submittingReplyId === comment.id || !(replyInputMap[comment.id] || "").trim()}
                      className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-40"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 自定义删除确认弹窗 */}
      <ConfirmModal
        isOpen={Boolean(deletingCommentId)}
        title="删除评论批注"
        description="确定要删除此条评论及其所有回复讨论吗？该操作不可撤销。"
        confirmText="彻底删除"
        type="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingCommentId(null)}
      />
    </>
  );
};
