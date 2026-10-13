import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Laptop,
  Tablet,
  Smartphone,
  Maximize2,
  ExternalLink,
  RotateCw,
  MessageSquare,
  Crosshair,
  ChevronDown,
  Compass,
  Paperclip,
  Plus,
  FileText
} from "lucide-react";
import {
  type Prototype,
  type Comment,
  type Attachment,
  type UserAccount,
  type CommentTargetInfo
} from "../types/index.js";
import { api } from "../services/api.js";
import { CommentSidebar } from "./CommentSidebar.js";
import { AttachmentList } from "./common/AttachmentList.js";
import { AttachmentModal } from "./common/AttachmentModal.js";
import { resolveAnchor } from "../utils/commentAnchor.js";
import { CommentPinLayer, type DraftPayload } from "../commentLayer/CommentPinLayer.js";

type ViewportType = "responsive" | "macbook" | "ipad" | "iphone";

interface PrototypeViewerProps {
  proto: Prototype;
  onBack: () => void;
  account: UserAccount;
}

export const PrototypeViewer: React.FC<PrototypeViewerProps> = ({ proto, onBack, account }) => {
  const [selectedVersionId, setSelectedVersionId] = useState<string>(
    proto.currentVersionId || proto.versions[0]?.id || ""
  );
  const [viewport, setViewport] = useState<ViewportType>("responsive");
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isAttachmentPanelOpen, setIsAttachmentPanelOpen] = useState(false);
  const [isVersionNotePanelOpen, setIsVersionNotePanelOpen] = useState(false);
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [currentSubPath, setCurrentSubPath] = useState<string>("index.html");

  const currentVersion =
    proto.versions.find((v) => v.id === selectedVersionId) || proto.versions[0];

  // 原型入口基础 URL
  const baseEntryUrl = currentVersion
    ? `/static${currentVersion.storageDir}/${currentVersion.entryFile}`
    : "";

  // 状态驱动受控的 iframe URL
  const [iframeSrc, setIframeSrc] = useState<string>(baseEntryUrl);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mainContainerRef = useRef<HTMLElement>(null);
  const attachmentPanelRef = useRef<HTMLDivElement>(null);
  const versionNotePanelRef = useRef<HTMLDivElement>(null);
  // 记录跨文件跳转时待定位的评论 ID
  const pendingScrollCommentIdRef = useRef<string | null>(null);
  // iframe 内批注浮窗层的唯一实例
  const layerRef = useRef<CommentPinLayer | null>(null);
  // 浮窗层只创建一次，通过它读取最新的 props/state，避免闭包读到旧值
  const latestRef = useRef({
    proto,
    account,
    selectedVersionId,
    currentSubPath,
    comments,
    activeCommentId,
    isSidebarOpen,
    isAddingComment
  });
  latestRef.current = {
    proto,
    account,
    selectedVersionId,
    currentSubPath,
    comments,
    activeCommentId,
    isSidebarOpen,
    isAddingComment
  };

  // 版本切换时重置 iframe URL
  useEffect(() => {
    if (baseEntryUrl) {
      setIframeSrc(baseEntryUrl);
      setCurrentSubPath(currentVersion?.entryFile || "index.html");
    }
  }, [baseEntryUrl, currentVersion]);

  // 加载评论列表
  const loadComments = async () => {
    try {
      const data = await api.getComments(proto.id, selectedVersionId);
      const sorted = [...data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setComments(sorted);
    } catch (err) {
      console.error("Failed to load comments:", err);
    }
  };

  useEffect(() => {
    loadComments();
  }, [proto.id, selectedVersionId]);

  // 附件归属原型而非版本，切换版本不重新加载
  const loadAttachments = async () => {
    try {
      setAttachments(await api.getAttachmentsByPrototype(proto.id));
    } catch (err) {
      console.error("Failed to load attachments:", err);
    }
  };

  useEffect(() => {
    loadAttachments();
  }, [proto.id]);

  // 点击附件面板以外的区域收起
  useEffect(() => {
    if (!isAttachmentPanelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!attachmentPanelRef.current?.contains(e.target as Node)) {
        setIsAttachmentPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAttachmentPanelOpen]);

  // 点击版本更新说明面板以外的区域收起
  useEffect(() => {
    if (!isVersionNotePanelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!versionNotePanelRef.current?.contains(e.target as Node)) {
        setIsVersionNotePanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isVersionNotePanelOpen]);

  // 全局及 iframe 内部快捷键统一分发
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    // 事件从 Shadow DOM 冒出后 e.target 会被重定向为宿主节点，必须走 composedPath 判断
    const path = e.composedPath?.() ?? [];
    const fromEditing = path.some((node) => {
      const el = node as HTMLElement | null;
      const tag = el?.tagName?.toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || Boolean(el?.isContentEditable);
    });
    const fromLayer = path.some((node) => {
      const tag = (node as Element)?.tagName;
      return typeof tag === "string" && tag.startsWith("WB-");
    });
    if (fromEditing || fromLayer) return;

    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      setIsAddingComment((prev) => !prev);
    } else if (e.key === "Escape") {
      // 先取消未提交的草稿，再退出批注模式
      if (layerRef.current?.cancelDraft()) return;
      setIsAddingComment(false);
      setActiveCommentId(null);
      setIsAttachmentPanelOpen(false);
      setIsVersionNotePanelOpen(false);
    }
  }, []);

  // 绑定宿主 window 快捷键
  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // 绑定 iframe 内部键盘事件 (解决点击原型内部后无法响应快捷键)
  // 原型区域右键统一处理：退出批注模式并关闭未关闭的批注框
  const handlePrototypeContextMenu = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (isAddingComment || activeCommentId) {
        e.preventDefault();
        setIsAddingComment(false);
        setActiveCommentId(null);
      }
    },
    [isAddingComment, activeCommentId]
  );

  // 绑定 iframe 内部键盘与右键事件 (防止在原型内部无法响应快捷键或右键退出)
  const bindIframeKeyboard = useCallback(() => {
    try {
      const iframeWin = iframeRef.current?.contentWindow;
      const iframeDoc = iframeRef.current?.contentDocument;
      if (iframeWin) {
        iframeWin.removeEventListener("keydown", handleGlobalKeyDown);
        iframeWin.addEventListener("keydown", handleGlobalKeyDown);
        iframeWin.removeEventListener("contextmenu", handlePrototypeContextMenu as any);
        iframeWin.addEventListener("contextmenu", handlePrototypeContextMenu as any);
      }
      if (iframeDoc) {
        iframeDoc.removeEventListener("contextmenu", handlePrototypeContextMenu as any);
        iframeDoc.addEventListener("contextmenu", handlePrototypeContextMenu as any);
      }
    } catch (err) {
      // ignore
    }
  }, [handleGlobalKeyDown, handlePrototypeContextMenu]);


  // 尝试激活目标元素所在的内联子页面（如针对同一个 HTML 内的 .page、tab 等）
  const switchInlinePageIfNeeded = useCallback((targetComment: Comment): boolean => {
    const iframeDoc = iframeRef.current?.contentDocument;
    const iframeWin = iframeRef.current?.contentWindow as any;
    if (!iframeDoc || !iframeWin) return false;

    // 已经能解析出可见锚点，无需切页
    if (resolveAnchor(iframeDoc, targetComment.target)) return false;

    const inlinePageId = targetComment.target?.inlinePageId;
    if (!inlinePageId) return false;

    // 1. 若原型定义了全局 go(pageId)（如 go('sites')）。
    // 注意 go() 会先清空所有 .page 的 active 再按 id 取元素，id 不存在时抛错会留下全空白页，
    // 因此必须先确认目标容器存在再调用。
    const cleanKey = inlinePageId.replace(/^page-/, "");
    if (typeof iframeWin.go === "function" && iframeDoc.getElementById(`page-${cleanKey}`)) {
      try {
        iframeWin.go(cleanKey);
        return true;
      } catch {
        // 落到后续策略
      }
    }

    // 2. 尝试在原型导航栏中触发点击对应按钮
    const navBtn = iframeDoc.querySelector(
      `button[onclick*="'${cleanKey}'"], a[onclick*="'${cleanKey}'"], .nav-item[onclick*="'${cleanKey}'"], [data-page="${cleanKey}"]`
    ) as HTMLElement | null;
    if (navBtn) {
      navBtn.click();
      return true;
    }

    // 3. 通用激活切换：同时覆盖 .page 与 .tab-content 两种约定
    const targetPageContainer = iframeDoc.getElementById(inlinePageId);
    if (targetPageContainer) {
      const group = targetPageContainer.classList.contains("tab-content")
        ? ".tab-content"
        : targetPageContainer.classList.contains("page")
        ? ".page"
        : null;
      if (group) {
        iframeDoc.querySelectorAll(group).forEach((el) => el.classList.remove("active"));
        targetPageContainer.classList.add("active");
        return true;
      }
    }

    return false;
  }, []);

  // 智能重试定位探测器（解决跨内联页面切换或异步渲染 DOM 延时就绪问题）
  const scheduleScrollToComment = useCallback((targetComment: Comment) => {
    // 优先尝试触发内联子页面切换
    switchInlinePageIfNeeded(targetComment);
    layerRef.current?.reconcile();

    let attempts = 0;
    const maxAttempts = 8;
    const tryFocus = () => {
      attempts += 1;
      const iframeDoc = iframeRef.current?.contentDocument;
      const layer = layerRef.current;

      if (layer && iframeDoc && resolveAnchor(iframeDoc, targetComment.target)) {
        layer.focusComment(targetComment);
        return;
      }
      if (attempts < maxAttempts) {
        // 如果依然解析不出锚点，再次尝试切页或等待渲染
        if (attempts === 2) switchInlinePageIfNeeded(targetComment);
        setTimeout(tryFocus, 100);
      }
    };

    tryFocus();
  }, [switchInlinePageIfNeeded]);

  // 规范化路径用于比较
  const normalizePath = (p?: string) => {
    if (!p) return "index.html";
    let clean = p.replace(/^\//, "").split("?")[0].trim();
    if (!clean || clean === "/") clean = "index.html";
    return clean;
  };

  // 跨独立文件导航
  const handleNavigateToPage = useCallback((targetPagePath: string) => {
    if (!currentVersion) return;
    const cleanPath = targetPagePath.replace(/^\//, "");
    const targetFullUrl = `/static${currentVersion.storageDir}/${cleanPath}`;

    // 状态驱动切换
    setIframeSrc(targetFullUrl);

    // 尝试底层直接跳转，以双保险触发
    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.location.href = targetFullUrl;
      }
    } catch {
      // ignore
    }
    setTimeout(syncIframePageAndScroll, 100);
  }, [currentVersion]);

  // 获取 iframe 内部当前规范化相对路径
  const syncIframePageAndScroll = useCallback(() => {
    try {
      const iframeWin = iframeRef.current?.contentWindow;
      if (!iframeWin || !currentVersion) return;

      bindIframeKeyboard();

      const pathname = iframeWin.location.pathname;
      const hash = iframeWin.location.hash || "";
      const prefix = `/static${currentVersion.storageDir}/`;

      let relPath = "index.html";
      if (pathname.startsWith(prefix)) {
        relPath = pathname.slice(prefix.length) + hash;
      } else {
        relPath = (currentVersion.entryFile || "index.html") + hash;
      }

      if (!relPath) relPath = "index.html";

      setCurrentSubPath((prev) => (prev !== relPath ? relPath : prev));

      // 如果有待滚动的评论，且当前路径已与目标匹配，立即启动定位探测
      if (pendingScrollCommentIdRef.current) {
        const targetId = pendingScrollCommentIdRef.current;
        const targetComment = latestRef.current.comments.find((c) => c.id === targetId);
        if (targetComment && normalizePath(targetComment.pagePath) === normalizePath(relPath)) {
          pendingScrollCommentIdRef.current = null;
          scheduleScrollToComment(targetComment);
        }
      }
    } catch (err) {
      // ignore
    }
  }, [currentVersion, bindIframeKeyboard, scheduleScrollToComment]);

  // 状态变化通过 reconcile 推给浮窗层，滚动与原型内部抖动完全不进 React
  useEffect(() => {
    layerRef.current?.reconcile();
  }, [comments, activeCommentId, currentSubPath, isSidebarOpen]);

  // 批注模式开关同步到浮窗层
  useEffect(() => {
    layerRef.current?.setAddMode(isAddingComment);
  }, [isAddingComment]);

  // 组件卸载时拆除浮窗层，还原注入元素与 position 补写
  useEffect(
    () => () => {
      layerRef.current?.dispose();
      layerRef.current = null;
      if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>).__wbPinLayer;
    },
    []
  );

  // iframe 加载完成事件：绑定原型内部的事件监听
  const handleIframeLoad = () => {
    syncIframePageAndScroll();
    ensureLayer();

    try {
      const iframeWin = iframeRef.current?.contentWindow;
      const iframeDoc = iframeRef.current?.contentDocument;
      if (iframeWin && iframeDoc) {
        bindIframeKeyboard();

        const onHashChange = () => syncIframePageAndScroll();
        iframeWin.addEventListener("hashchange", onHashChange);
        iframeWin.addEventListener("popstate", onHashChange);

        // 检查是否有挂起的跨文件定位评论
        if (pendingScrollCommentIdRef.current) {
          const targetId = pendingScrollCommentIdRef.current;
          pendingScrollCommentIdRef.current = null;
          const targetComment = latestRef.current.comments.find((c) => c.id === targetId);
          if (targetComment) {
            scheduleScrollToComment(targetComment);
          }
        }
      }
    } catch (err) {
      console.warn("Iframe event binding error:", err);
    }
  };

  useEffect(() => {
    const timer = setInterval(syncIframePageAndScroll, 1000);
    return () => clearInterval(timer);
  }, [syncIframePageAndScroll]);

  // 点击侧边栏评论：快速定位到页面对应位置（支持跨内联子页面智能切换与高亮）
  const handleSelectCommentFromSidebar = (commentId: string | null) => {
    setActiveCommentId(commentId);
    if (!commentId) return;

    const targetComment = comments.find((c) => c.id === commentId);
    if (!targetComment) return;

    const isDifferentFile =
      normalizePath(targetComment.pagePath) !== normalizePath(currentSubPath);

    if (isDifferentFile) {
      pendingScrollCommentIdRef.current = commentId;
      handleNavigateToPage(targetComment.pagePath);
    } else {
      scheduleScrollToComment(targetComment);
    }
  };

  // 浮窗层提交草稿后的落库逻辑。失败时向上抛，由浮窗层保留草稿以便重试
  const handleDraftSubmit = useCallback(async (payload: DraftPayload) => {
    const latest = latestRef.current;
    try {
      const newComment = await api.addComment(latest.proto.id, {
        versionId: latest.selectedVersionId,
        pagePath: payload.pagePath || latest.currentSubPath,
        target: payload.target,
        content: payload.content,
        author: {
          name: latest.account.name,
          avatar: latest.account.avatar
        }
      });
      setComments((prev) => [...prev, newComment]);
      setActiveCommentId(newComment.id);
      setIsSidebarOpen(true);
      setIsAddingComment(false);
    } catch (err: any) {
      alert(err.message || "评论发表失败");
      throw err;
    }
  }, []);

  // iframe 文档就绪后重建浮窗层。浮窗直接注入 iframe 文档，iframe 每次加载都必须重新挂载
  const ensureLayer = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    if (!doc || !win || !doc.body) return;

    // 导航尚未开始时 contentDocument 是 about:blank，它同样有 body，必须先排除
    try {
      const href = win.location.href;
      if (!href || href === "about:blank") return;
    } catch {
      return;
    }

    if (layerRef.current?.isBoundTo(doc)) return;

    layerRef.current?.dispose();

    const layer = new CommentPinLayer({
      doc,
      win,
      getComments: () => latestRef.current.comments,
      getCurrentPath: () => latestRef.current.currentSubPath,
      getActiveCommentId: () => latestRef.current.activeCommentId,
      isPinsVisible: () => latestRef.current.isSidebarOpen,
      onSelectComment: (id) => setActiveCommentId(id),
      onSubmitDraft: handleDraftSubmit
    });

    layerRef.current = layer;
    layer.setAddMode(latestRef.current.isAddingComment);
    layer.mount();

    // 开发期诊断钩子：window.__wbPinLayer.debugSnapshot()
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__wbPinLayer = layer;
    }
  }, [handleDraftSubmit]);

  // iframe 命中缓存时 onLoad 可能先于 React 挂载监听触发，这里做一次有限重试兜底
  useEffect(() => {
    let attempts = 0;
    let timer: number | undefined;

    const tryEnsure = () => {
      attempts += 1;
      ensureLayer();
      if (!layerRef.current?.isBoundTo(iframeRef.current?.contentDocument ?? null) && attempts < 10) {
        timer = window.setTimeout(tryEnsure, 200);
      }
    };

    tryEnsure();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [currentVersion, refreshKey, ensureLayer]);

  const handleToggleCommentStatus = async (
    commentId: string,
    currentStatus: "open" | "resolved"
  ) => {
    const nextStatus = currentStatus === "open" ? "resolved" : "open";
    try {
      const updated = await api.toggleCommentStatus(commentId, nextStatus);
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
    } catch (err: any) {
      alert(err.message || "更新状态失败");
    }
  };

  const handleAddReply = async (commentId: string, content: string) => {
    try {
      const reply = await api.addReply(commentId, {
        content,
        author: {
          name: account.name,
          avatar: account.avatar
        }
      });
      setComments((prev) =>
        prev.map((c) => {
          if (c.id === commentId) {
            return { ...c, replies: [...c.replies, reply] };
          }
          return c;
        })
      );
    } catch (err: any) {
      alert(err.message || "回复失败");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await api.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (activeCommentId === commentId) {
        setActiveCommentId(null);
      }
    } catch (err: any) {
      alert(err.message || "删除失败");
    }
  };

  const handleAddAttachment = async (formData: FormData) => {
    const created = await api.addAttachment(proto.id, formData);
    setAttachments((prev) => [created, ...prev]);
  };

  const handleDeleteAttachment = async (id: string) => {
    try {
      await api.deleteAttachment(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      alert(err.message || "附件删除失败");
    }
  };

  const openCount = comments.filter((c) => c.status === "open").length;
  const versionsDesc = [...proto.versions].sort((a, b) => b.versionNumber - a.versionNumber);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">
      {/* 顶部操作栏 */}
      {/* 面板展开时抬高层级，避免被批注吸附气泡（z-40）压住 */}
      <header
        className={`h-14 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 flex items-center justify-between shrink-0 select-none shadow-md ${
          isAttachmentPanelOpen || isVersionNotePanelOpen ? "z-50" : "z-20"
        }`}
      >
        {/* 左侧：返回与原型信息 */}
        <div className="flex items-center space-x-3 min-w-0">
          <button
            onClick={onBack}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4 mr-0.5" />
            <span>返回</span>
          </button>

          <div className="h-4 w-px bg-slate-800" />

          <div className="flex items-center space-x-2 min-w-0">
            <h2 className="font-bold text-slate-100 text-sm truncate max-w-[200px]" title={proto.name}>
              {proto.name}
            </h2>

            {/* 当前页面名称 */}
            <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/50 text-[11px] text-slate-300">
              <Compass className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="font-mono truncate max-w-[160px]">{currentSubPath}</span>
            </div>

            {/* 版本切换下拉选择 */}
            <div className="relative">
              <select
                value={selectedVersionId}
                onChange={(e) => {
                  setSelectedVersionId(e.target.value);
                  setActiveCommentId(null);
                }}
                className="appearance-none bg-slate-800/90 text-indigo-400 text-xs font-semibold pl-2.5 pr-7 py-1 rounded-lg border border-slate-700/80 hover:border-indigo-500/50 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                {proto.versions.map((ver) => (
                  <option key={ver.id} value={ver.id} className="bg-slate-800 text-slate-200">
                    {ver.versionLabel} ({new Date(ver.createdAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-indigo-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* 版本更新说明：点击查看各版本更新日志 */}
            <div className="relative shrink-0" ref={versionNotePanelRef}>
              <button
                onClick={() => setIsVersionNotePanelOpen((prev) => !prev)}
                title="版本更新说明"
                className={`flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  isVersionNotePanelOpen
                    ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30"
                    : "bg-slate-800/90 text-slate-300 border-slate-700/80 hover:text-white hover:border-indigo-500/50"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>版本说明</span>
              </button>

              {isVersionNotePanelOpen && (
                <div className="absolute left-0 top-full mt-2 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-1 pb-2 mb-2 border-b border-slate-100">
                    <span className="text-[11px] font-bold text-slate-600">版本更新说明</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {versionsDesc.map((ver) => (
                      <div
                        key={ver.id}
                        className={`px-2.5 py-2 rounded-xl border ${
                          ver.id === selectedVersionId
                            ? "border-indigo-200 bg-indigo-50"
                            : "border-slate-100 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-700">
                            {ver.versionLabel}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(ver.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap break-words">
                          {ver.changelog || "无更新说明"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 关联附件：左上信息区最右侧，点击展开 */}
            <div className="relative shrink-0" ref={attachmentPanelRef}>
              <button
                onClick={() => setIsAttachmentPanelOpen((prev) => !prev)}
                title="关联附件"
                className={`flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  isAttachmentPanelOpen
                    ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/30"
                    : "bg-slate-800/90 text-slate-300 border-slate-700/80 hover:text-white hover:border-indigo-500/50"
                }`}
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span>{attachments.length}</span>
              </button>

              {isAttachmentPanelOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-slate-100">
                    <span className="text-[11px] font-bold text-slate-600">
                      关联附件 ({attachments.length})
                    </span>
                    <button
                      onClick={() => setIsAttachmentModalOpen(true)}
                      className="flex items-center space-x-0.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      <Plus className="w-3 h-3" />
                      <span>添加</span>
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto">
                    <AttachmentList
                      attachments={attachments}
                      onDelete={handleDeleteAttachment}
                      compact
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 中间：设备视口切换器 */}
        <div className="hidden md:flex items-center space-x-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => setViewport("responsive")}
            title="流动自适应 (100%)"
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              viewport === "responsive"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
            }`}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewport("macbook")}
            title="MacBook 视口 (1440 × 900)"
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              viewport === "macbook"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
            }`}
          >
            <Laptop className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewport("ipad")}
            title="iPad 视口 (820 × 1080)"
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              viewport === "ipad"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
            }`}
          >
            <Tablet className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewport("iphone")}
            title="iPhone 视口 (393 × 852)"
            className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
              viewport === "iphone"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
            }`}
          >
            <Smartphone className="w-4 h-4" />
          </button>
        </div>

        {/* 右侧：批注模式 / 评论抽屉 / 外部打开 */}
        <div className="flex items-center space-x-2">
          {/* 批注开关 */}
          <button
            onClick={() => setIsAddingComment((prev) => !prev)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isAddingComment
                ? "bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-600/30"
                : "bg-slate-800 text-slate-300 hover:bg-slate-750 hover:text-white"
            }`}
            title="批注模式 (快捷键: C，支持鼠标右键或Esc退出)"
          >
            <Crosshair className={`w-3.5 h-3.5 ${isAddingComment ? "animate-spin" : ""}`} />
            <span>批注模式</span>
          </button>

          {/* 刷新 iframe */}
          <button
            onClick={() => {
              setRefreshKey((k) => k + 1);
              setTimeout(syncIframePageAndScroll, 200);
            }}
            title="重新加载当前页面"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          {/* 新窗口独立打开 */}
          <a
            href={iframeSrc || baseEntryUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="在新标签页中独立打开原型"
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          <div className="h-4 w-px bg-slate-800" />

          {/* 评论侧栏开关 */}
          <button
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className={`relative flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isSidebarOpen
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750"
            }`}
            title="展开/收起批注列表"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>评论</span>
            {openCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-indigo-500 text-white text-[10px] font-bold">
                {openCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* 主视图区域：画布 + 评论侧边栏 */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden bg-slate-950">
        {/* 画布视口容器 */}
        <main
          ref={mainContainerRef}
          onContextMenu={handlePrototypeContextMenu}
          className="flex-1 flex items-center justify-center p-4 overflow-auto relative"
        >
          <div
            className={`relative transition-all duration-300 flex items-center justify-center bg-white overflow-hidden ${
              viewport === "responsive"
                ? "w-full h-full rounded-none"
                : viewport === "macbook"
                ? "w-[1280px] h-[800px] max-w-full max-h-full rounded-2xl shadow-2xl border-[10px] border-slate-800"
                : viewport === "ipad"
                ? "w-[820px] h-[960px] max-w-full max-h-full rounded-3xl shadow-2xl border-[12px] border-slate-800"
                : "w-[390px] h-[844px] max-w-full max-h-full rounded-[40px] shadow-2xl border-[12px] border-slate-900"
            }`}
          >
            {/* 原型独立 iframe 沙箱 */}
            <iframe
              ref={iframeRef}
              key={`${currentVersion?.id}-${refreshKey}`}
              src={iframeSrc}
              onLoad={handleIframeLoad}
              title={proto.name}
              className="w-full h-full border-none bg-white select-auto"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />

            {/* 批注浮窗由 CommentPinLayer 直接注入 iframe 文档，此处不再有覆盖层 */}
          </div>
        </main>

        {/* 右侧评论侧栏（常驻展示，点击评论不收起） */}
        <CommentSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          comments={comments}
          currentSubPath={currentSubPath}
          activeCommentId={activeCommentId}
          onSelectComment={handleSelectCommentFromSidebar}
          onToggleStatus={handleToggleCommentStatus}
          onAddReply={handleAddReply}
          onDeleteComment={handleDeleteComment}
          currentVersionLabel={currentVersion?.versionLabel || "v1.0"}
          account={account}
        />
      </div>

      {isAttachmentModalOpen && (
        <AttachmentModal
          protoName={proto.name}
          onClose={() => setIsAttachmentModalOpen(false)}
          onSubmit={handleAddAttachment}
        />
      )}
    </div>
  );
};
