import React, { useState, useRef, useEffect, useMemo } from "react";
import { Check, X, Send, CornerDownRight, Pin } from "lucide-react";
import { type Comment, type CommentTargetInfo, PRESET_AVATARS } from "../types/index.js";
import {
  getUniqueElementSelector,
  findBestMatchingElement,
  isElementVisibleInDOM,
  getInlinePageIdentifier
} from "../utils/domMatcher.js";

interface CommentOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  currentSubPath: string;
  scrollVersion: number;
  comments: Comment[];
  isAddingComment: boolean;
  onExitAddMode: () => void;
  activeCommentId: string | null;
  onSelectComment: (id: string | null) => void;
  onSubmitNewComment: (params: {
    pagePath: string;
    xPercent: number;
    yPercent: number;
    docX: number;
    docY: number;
    target?: CommentTargetInfo;
    content: string;
  }) => Promise<void>;
}

export const CommentOverlay: React.FC<CommentOverlayProps> = ({
  iframeRef,
  currentSubPath,
  scrollVersion,
  comments,
  isAddingComment,
  onExitAddMode,
  activeCommentId,
  onSelectComment,
  onSubmitNewComment
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  interface DraftState {
    clientX: number;
    clientY: number;
    xPercent: number;
    yPercent: number;
    docX: number;
    docY: number;
    target?: CommentTargetInfo;
  }

  const [draftPoint, setDraftPoint] = useState<DraftState | null>(null);
  const [draftText, setDraftText] = useState("");
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 监听 Esc 退出批注或取消激活
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draftPoint) {
          setDraftPoint(null);
          setDraftText("");
        } else if (activeCommentId) {
          onSelectComment(null);
        } else if (isAddingComment) {
          onExitAddMode();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAddingComment, draftPoint, activeCommentId, onExitAddMode, onSelectComment]);

  // 切换页面时清空草稿
  useEffect(() => {
    setDraftPoint(null);
    setDraftText("");
  }, [currentSubPath]);

  // 画布点击事件
  // 退出批注模式时自动清理未提交的草稿框
  useEffect(() => {
    if (!isAddingComment && draftPoint) {
      setDraftPoint(null);
      setDraftText("");
    }
  }, [isAddingComment, draftPoint]);

  // 鼠标右键：退出批注模式，并关闭所有未关闭的批注框（草稿框或激活卡片）
  const handleOverlayContextMenu = (e: React.MouseEvent) => {
    if (isAddingComment || draftPoint || activeCommentId) {
      e.preventDefault();
      e.stopPropagation();
      setDraftPoint(null);
      setDraftText("");
      setHoveredCommentId(null);
      if (activeCommentId) {
        onSelectComment(null);
      }
      if (isAddingComment) {
        onExitAddMode();
      }
    }
  };

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingComment) {
      if (activeCommentId) {
        onSelectComment(null);
      }
      return;
    }
    if (draftPoint) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const xPercent = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
    const yPercent = Math.max(0, Math.min(100, (clickY / rect.height) * 100));

    let targetInfo: CommentTargetInfo | undefined;
    let docX = clickX;
    let docY = clickY;

    try {
      const iframeDoc = iframeRef.current?.contentDocument;
      const iframeWin = iframeRef.current?.contentWindow;
      if (iframeDoc && iframeWin) {
        const scrollX = iframeWin?.scrollX ?? iframeDoc?.documentElement?.scrollLeft ?? iframeDoc?.body?.scrollLeft ?? 0;
        const scrollY = iframeWin?.scrollY ?? iframeDoc?.documentElement?.scrollTop ?? iframeDoc?.body?.scrollTop ?? 0;
        docX = clickX + scrollX;
        docY = clickY + scrollY;

        const targetEl = iframeDoc.elementFromPoint(clickX, clickY) as HTMLElement | null;
        const inlinePageId = targetEl
          ? getInlinePageIdentifier(targetEl, iframeDoc)
          : ((iframeDoc.querySelector('.page.active, [class*="active"][id^="page"]') as HTMLElement | null)?.id || undefined);

        if (targetEl && targetEl !== iframeDoc?.body && targetEl !== iframeDoc?.documentElement) {
          const elRect = targetEl.getBoundingClientRect();
          const offsetXPercent = elRect.width > 0 ? Math.max(0, Math.min(100, ((clickX - elRect.left) / elRect.width) * 100)) : 50;
          const offsetYPercent = elRect.height > 0 ? Math.max(0, Math.min(100, ((clickY - elRect.top) / elRect.height) * 100)) : 50;

          const textSnippet = (targetEl.innerText || targetEl.getAttribute("placeholder") || targetEl.getAttribute("title") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 24);

          targetInfo = {
            selector: getUniqueElementSelector(targetEl, iframeDoc),
            tagName: targetEl.tagName,
            innerTextSnippet: textSnippet || undefined,
            elementOffsetXPercent: Math.round(offsetXPercent),
            elementOffsetYPercent: Math.round(offsetYPercent),
            inlinePageId
          };
        } else if (inlinePageId) {
          targetInfo = {
            inlinePageId
          };
        }
      }
    } catch (err) {
      console.warn("Unable to capture DOM element from iframe:", err);
    }

    setDraftPoint({
      clientX: clickX,
      clientY: clickY,
      xPercent,
      yPercent,
      docX,
      docY,
      target: targetInfo
    });
  };

  const handleSendDraft = async () => {
    if (!draftPoint || !draftText.trim()) return;
    setSubmitting(true);
    try {
      await onSubmitNewComment({
        pagePath: currentSubPath,
        xPercent: draftPoint.xPercent,
        yPercent: draftPoint.yPercent,
        docX: draftPoint.docX,
        docY: draftPoint.docY,
        target: draftPoint.target,
        content: draftText.trim()
      });
      setDraftPoint(null);
      setDraftText("");
      onExitAddMode();
    } finally {
      setSubmitting(false);
    }
  };

  // 严格按当前外部 URL 子页面筛选
  const pageComments = useMemo(() => {
    return comments.filter((c) => {
      const cPath = (c.pagePath || "index.html").replace(/^\//, "");
      const currPath = (currentSubPath || "index.html").replace(/^\//, "");
      return cPath === currPath;
    });
  }, [comments, currentSubPath]);

  // 实时屏幕绝对批注 (带内联多页面感知与多维特征消歧)
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

  const computedPins = useMemo(() => {
    void scrollVersion;

    const iframeDoc = iframeRef.current?.contentDocument;
    const iframeWin = iframeRef.current?.contentWindow;

    const scrollX = iframeWin?.scrollX ?? iframeDoc?.documentElement?.scrollLeft ?? iframeDoc?.body?.scrollLeft ?? 0;
    const scrollY = iframeWin?.scrollY ?? iframeDoc?.documentElement?.scrollTop ?? iframeDoc?.body?.scrollTop ?? 0;

    return pageComments.map((comment, index) => {
      let screenX = -9999;
      let screenY = -9999;
      let isVisible = true;

      // 1. 若锚定了具体 DOM 元素
      if (iframeDoc && comment.target && (comment.target.selector || comment.target.tagName)) {
        try {
          const el = findBestMatchingElement(iframeDoc, comment.target, comment.docX, comment.docY);
          if (el) {
            const isVis = isElementVisibleInDOM(el, iframeDoc);
            if (!isVis) {
              // 关键！目标元素在当前内联页面不可见（被隐藏在其它 tab/page 中），绝对不展示在当前页面！
              return {
                comment,
                index,
                screenX: -9999,
                screenY: -9999,
                isVisible: false
              };
            }
            const r = el.getBoundingClientRect();
            const offX = (r.width * (comment.target.elementOffsetXPercent ?? 50)) / 100;
            const offY = (r.height * (comment.target.elementOffsetYPercent ?? 50)) / 100;
            screenX = r.left + offX;
            screenY = r.top + offY;
          } else {
            // 元素未找到，不落入兜底避免误显在其他内联页面
            return {
              comment,
              index,
              screenX: -9999,
              screenY: -9999,
              isVisible: false
            };
          }
        } catch {
          // fallback
        }
      }

      // 2. 仅针对无特定小元素的纯背景批注
      if (screenX === -9999 && isVisible) {
        // 若纯背景批注记录了所属内联容器 ID，检查该容器在当前是否可见
        if (comment.target?.inlinePageId && iframeDoc) {
          const pageEl = iframeDoc.getElementById(comment.target.inlinePageId);
          if (pageEl && !isElementVisibleInDOM(pageEl, iframeDoc)) {
            return {
              comment,
              index,
              screenX: -9999,
              screenY: -9999,
              isVisible: false
            };
          }
        }

        if (typeof comment.docY === "number" && typeof comment.docX === "number") {
          screenX = comment.docX - scrollX;
          screenY = comment.docY - scrollY;
        } else if (containerRef.current) {
          const w = containerRef.current.clientWidth;
          const h = containerRef.current.clientHeight;
          screenX = (w * comment.xPercent) / 100;
          screenY = (h * comment.yPercent) / 100;
        }
      }

      const pinNumber = commentIndexMap.get(comment.id) ?? (index + 1);

      return {
        comment,
        pinNumber,
        index,
        screenX,
        screenY,
        isVisible
      };
    });
  }, [pageComments, scrollVersion, iframeRef]);

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      onContextMenu={handleOverlayContextMenu}
      className={`absolute inset-0 z-20 ${
        isAddingComment ? "cursor-crosshair bg-indigo-500/5 select-none" : "pointer-events-none"
      }`}
    >
      {/* 渲染当前子页面已打点的批注 Pin */}
      {computedPins.map(({ comment, pinNumber, screenX, screenY, isVisible }) => {
        if (!isVisible || screenX < -50 || screenY < -50) return null;

        const isResolved = comment.status === "resolved";
        const isActive = comment.id === activeCommentId;
        const isHovered = comment.id === hoveredCommentId;
        const shouldShowCard = isHovered || isActive;

        const avatarInfo =
          PRESET_AVATARS.find((a) => a.id === comment.author.avatar) || PRESET_AVATARS[0];

        return (
          <div
            key={comment.id}
            style={{
              transform: `translate3d(${screenX}px, ${screenY}px, 0)`,
              zIndex: isActive ? 45 : 20
            }}
            className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 pointer-events-auto will-change-transform"
            onMouseEnter={() => setHoveredCommentId(comment.id)}
            onMouseLeave={() => setHoveredCommentId(null)}
          >
            {/* 核心 Pin 图标按钮 */}
            {/* 主 Pin 图标按钮 (小巧精致，去除弹起动效) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectComment(isActive ? null : comment.id);
              }}
              className={`relative flex items-center justify-center rounded-full font-bold transition-all ${
                isResolved
                  ? "w-5 h-5 bg-slate-400 text-white hover:bg-slate-500 ring-1.5 ring-white shadow-sm text-[10px]"
                  : isActive
                  ? "w-6 h-6 bg-indigo-600 text-white ring-2 ring-indigo-500 ring-offset-2 ring-offset-white shadow-md text-xs"
                  : "w-5 h-5 bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-110 ring-1.5 ring-white shadow-sm text-[11px]"
              }`}
            >
              {isResolved ? <Check className="w-3 h-3" /> : pinNumber}
            </button>

            {/* 激活或悬停时展示的浮动气泡卡片 */}
            {shouldShowCard && (
              <div
                className="absolute left-1/2 bottom-full mb-2 -translate-x-1/2 w-64 p-3.5 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 text-left z-40 pointer-events-auto animate-in fade-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
                onContextMenu={handleOverlayContextMenu}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${avatarInfo.bg} text-white`}
                    >
                      {avatarInfo.emoji}
                    </div>
                    <span className="text-xs font-bold text-slate-800 truncate max-w-[110px]">
                      {comment.author.name}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setHoveredCommentId(null);
                      onSelectComment(null);
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    title="收起浮窗"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {comment.target?.tagName && (
                  <div className="mb-2 px-2 py-0.5 rounded-md bg-slate-100 text-[10px] text-slate-600 truncate flex items-center space-x-1">
                    <Pin className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                    <span className="font-semibold uppercase">{comment.target.tagName}</span>
                    {comment.target.innerTextSnippet && (
                      <span className="text-slate-400 truncate">: "{comment.target.innerTextSnippet}"</span>
                    )}
                  </div>
                )}

                <p className="text-xs text-slate-800 line-clamp-3 leading-relaxed font-normal whitespace-pre-wrap">
                  {comment.content}
                </p>

                {comment.replies.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-indigo-600 font-medium">
                    <div className="flex items-center">
                      <CornerDownRight className="w-3 h-3 mr-1" />
                      <span>{comment.replies.length} 条回复</span>
                    </div>
                    <span className="text-slate-400">在侧栏查看全部</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 正在添加的待提交草稿 */}
      {draftPoint && (
        <div
          style={{ transform: `translate3d(${draftPoint.clientX}px, ${draftPoint.clientY}px, 0)` }}
          className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-40"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={handleOverlayContextMenu}
        >
          {/* 准星标记 */}
          {/* 准星标记 (小巧稳定无弹跳) */}
          <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shadow-md ring-2 ring-indigo-400 ring-offset-2 ring-offset-white">
            {comments.length + 1}
          </div>

          {/* 输入弹窗卡片 */}
          <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                添加批注 #{comments.length + 1}
              </span>
              <button
                onClick={() => {
                  setDraftPoint(null);
                  setDraftText("");
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {draftPoint.target && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/70 border border-indigo-100 text-[11px] text-indigo-700">
                <Pin className="w-3 h-3 shrink-0" />
                <span className="font-semibold uppercase">{draftPoint.target.tagName}</span>
                {draftPoint.target.innerTextSnippet && (
                  <span className="text-indigo-500 truncate">: "{draftPoint.target.innerTextSnippet}"</span>
                )}
              </div>
            )}

            {/* Enter 直接发表，Ctrl+Enter 换行 */}
            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const target = e.currentTarget;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;
                    const next = draftText.substring(0, start) + "\n" + draftText.substring(end);
                    setDraftText(next);
                    setTimeout(() => {
                      target.selectionStart = target.selectionEnd = start + 1;
                    }, 0);
                  } else if (!e.shiftKey && !(e.nativeEvent as any).isComposing) {
                    e.preventDefault();
                    handleSendDraft();
                  }
                }
              }}
              placeholder="输入批注内容 (Enter 发表，Ctrl+Enter 换行)..."
              rows={3}
              className="w-full p-2.5 text-xs text-slate-900 bg-white placeholder:text-slate-400 font-medium rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none shadow-sm"
            />

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-400">
                Enter 发表 · Ctrl+Enter 换行 · Esc 取消
              </span>
              <button
                onClick={handleSendDraft}
                disabled={submitting || !draftText.trim()}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
              >
                <Send className="w-3 h-3" />
                <span>{submitting ? "发表中..." : "发表"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
