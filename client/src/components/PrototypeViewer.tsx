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
  Compass
} from "lucide-react";
import { type Prototype, type Comment, type UserAccount, type CommentTargetInfo } from "../types/index.js";
import { api } from "../services/api.js";
import { CommentOverlay } from "./CommentOverlay.js";
import { CommentSidebar } from "./CommentSidebar.js";
import { ErrorBoundary } from "./common/ErrorBoundary.js";
import { findBestMatchingElement, isElementVisibleInDOM, getInlinePageIdentifier } from "../utils/domMatcher.js";

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
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [currentSubPath, setCurrentSubPath] = useState<string>("index.html");
  const [scrollVersion, setScrollVersion] = useState(0);

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
  // 记录跨文件跳转时待定位的评论 ID
  const pendingScrollCommentIdRef = useRef<string | null>(null);

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

  // 全局及 iframe 内部快捷键统一分发
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tagName = target?.tagName?.toUpperCase();
    if (tagName === "INPUT" || tagName === "TEXTAREA" || (target as any)?.isContentEditable) {
      return;
    }
    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      setIsAddingComment((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsAddingComment(false);
      setActiveCommentId(null);
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

  // 临时高亮目标 DOM 元素，呈现蓝紫色呼吸发光聚光灯效果

  // 执行绝对平滑滚动居中并对焦到对应评论位置
  const performScrollToComment = useCallback((targetComment: Comment) => {
    try {
      const iframeDoc = iframeRef.current?.contentDocument;
      const iframeWin = iframeRef.current?.contentWindow;
      if (!iframeDoc || !iframeWin) return;

      let targetElement: HTMLElement | null = null;
      if (targetComment.target) {
        targetElement = findBestMatchingElement(
          iframeDoc,
          targetComment.target,
          targetComment.docX,
          targetComment.docY
        );
      }

      const scrollX = iframeWin?.scrollX ?? iframeDoc?.documentElement?.scrollLeft ?? iframeDoc?.body?.scrollLeft ?? 0;
      const scrollY = iframeWin?.scrollY ?? iframeDoc?.documentElement?.scrollTop ?? iframeDoc?.body?.scrollTop ?? 0;

      if (targetElement) {
        // 1. 获取目标元素在文档中的绝对坐标
        const r = targetElement.getBoundingClientRect();
        const elDocX = r.left + scrollX + r.width / 2;
        const elDocY = r.top + scrollY + r.height / 2;

        // 2. 无论当前是否在视口中，强制让 iframeWin 平滑居中滚动！
        const targetTop = Math.max(0, elDocY - iframeWin.innerHeight / 2);
        const targetLeft = Math.max(0, elDocX - iframeWin.innerWidth / 2);

        iframeWin.scrollTo({
          top: targetTop,
          left: targetLeft,
          behavior: "smooth"
        });

        // 3. 同时触发原生 scrollIntoView 应对内部局部滚动容器（如 .layout-main）
        try {
          targetElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center"
          });
        } catch {
          targetElement.scrollIntoView();
        }

        // 4. 外层 main 视口也平滑同步居中（若外层有滚动条）
        if (mainContainerRef.current) {
          const mainEl = mainContainerRef.current;
          if (mainEl.scrollWidth > mainEl.clientWidth || mainEl.scrollHeight > mainEl.clientHeight) {
            mainEl.scrollTo({
              top: Math.max(0, (mainEl.scrollHeight - mainEl.clientHeight) / 2),
              left: Math.max(0, (mainEl.scrollWidth - mainEl.clientWidth) / 2),
              behavior: "smooth"
            });
          }
        }

      } else if (typeof targetComment.docY === "number" || typeof targetComment.yPercent === "number") {
        // 坐标兜底方案
        const scrollHeight = iframeDoc?.documentElement?.scrollHeight ?? iframeDoc?.body?.scrollHeight ?? 0;
        const scrollWidth = iframeDoc?.documentElement?.scrollWidth ?? iframeDoc?.body?.scrollWidth ?? 0;

        const targetDocY =
          typeof targetComment.docY === "number"
            ? targetComment.docY
            : (scrollHeight * (targetComment.yPercent || 0)) / 100;
        const targetDocX =
          typeof targetComment.docX === "number"
            ? targetComment.docX
            : (scrollWidth * (targetComment.xPercent || 0)) / 100;

        const top = Math.max(0, targetDocY - iframeWin.innerHeight / 2);
        const left = Math.max(0, targetDocX - iframeWin.innerWidth / 2);

        iframeWin.scrollTo({
          top,
          left,
          behavior: "smooth"
        });
      }

      // 滚动期间与完成后多次同步 Pin 坐标
      const delays = [50, 150, 300, 500, 800, 1200];
      delays.forEach((delay) => {
        setTimeout(() => {
          setScrollVersion((v) => v + 1);
        }, delay);
      });
    } catch (err) {
      console.warn("performScrollToComment error:", err);
    }
  }, []);

  // 尝试激活目标元素所在的内联子页面（如针对同一个 HTML 内的 .page、tab 等）
  const switchInlinePageIfNeeded = useCallback((targetComment: Comment): boolean => {
    const iframeDoc = iframeRef.current?.contentDocument;
    const iframeWin = iframeRef.current?.contentWindow as any;
    if (!iframeDoc || !iframeWin) return false;

    let targetElement: HTMLElement | null = null;
    if (targetComment.target) {
      targetElement = findBestMatchingElement(
        iframeDoc,
        targetComment.target,
        targetComment.docX,
        targetComment.docY
      );
    }

    // 若目标元素已经可见，无需切换内联页面
    if (targetElement && isElementVisibleInDOM(targetElement, iframeDoc)) {
      return false;
    }

    // 寻找目标元素所在的内联页面容器
    const inlinePageId =
      targetComment.target?.inlinePageId ||
      (targetElement ? getInlinePageIdentifier(targetElement, iframeDoc) : undefined);

    if (!inlinePageId) return false;

    // 1. 若原型定义了全局 go(pageId) 函数（如本原型系统 go('sites')）
    const cleanKey = inlinePageId.replace(/^page-/, "");
    if (typeof iframeWin.go === "function") {
      try {
        iframeWin.go(cleanKey);
        setScrollVersion((v) => v + 1);
        return true;
      } catch {
        // continue
      }
    }

    // 2. 尝试在原型导航栏中触发点击对应按钮
    const navBtn = iframeDoc.querySelector(
      `button[onclick*="'${cleanKey}'"], a[onclick*="'${cleanKey}'"], .nav-item[onclick*="'${cleanKey}'"], [data-page="${cleanKey}"]`
    ) as HTMLElement | null;
    if (navBtn) {
      navBtn.click();
      setScrollVersion((v) => v + 1);
      return true;
    }

    // 3. 通用样式激活切换：给目标 .page 加 active，移除其他 .page 的 active
    const targetPageContainer = iframeDoc.getElementById(inlinePageId);
    if (targetPageContainer && targetPageContainer.classList.contains("page")) {
      iframeDoc.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
      targetPageContainer.classList.add("active");
      setScrollVersion((v) => v + 1);
      return true;
    }

    return false;
  }, []);

  // 智能重试定位探测器（解决跨内联页面切换或异步渲染 DOM 延时就绪问题）
  const scheduleScrollToComment = useCallback((targetComment: Comment) => {
    // 优先尝试触发内联子页面切换
    switchInlinePageIfNeeded(targetComment);

    let attempts = 0;
    const maxAttempts = 10;
    const tryScroll = () => {
      attempts++;
      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc) {
        if (attempts < maxAttempts) setTimeout(tryScroll, 100);
        return;
      }

      let el: HTMLElement | null = null;
      if (targetComment.target) {
        el = findBestMatchingElement(
          iframeDoc,
          targetComment.target,
          targetComment.docX,
          targetComment.docY
        );
      }

      if (el && isElementVisibleInDOM(el, iframeDoc)) {
        performScrollToComment(targetComment);
      } else if (attempts < maxAttempts) {
        // 如果依然未处于可见状态，再次尝试切页或等待渲染
        if (attempts === 2) {
          switchInlinePageIfNeeded(targetComment);
        }
        setTimeout(tryScroll, 80 + attempts * 40);
      } else {
        // 达到最大重试次数，执行定位居中
        performScrollToComment(targetComment);
      }
    };

    tryScroll();
  }, [performScrollToComment, switchInlinePageIfNeeded]);

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
      setScrollVersion((v) => v + 1);

      // 如果有待滚动的评论，且当前路径已与目标匹配，立即启动多阶定位探测
      if (pendingScrollCommentIdRef.current) {
        const targetId = pendingScrollCommentIdRef.current;
        const targetComment = comments.find((c) => c.id === targetId);
        if (targetComment && normalizePath(targetComment.pagePath) === normalizePath(relPath)) {
          pendingScrollCommentIdRef.current = null;
          scheduleScrollToComment(targetComment);
        }
      }
    } catch (err) {
      // ignore
    }
  }, [currentVersion, bindIframeKeyboard, comments, scheduleScrollToComment]);

  // iframe 加载完成事件：挂载事件监听与 MutationObserver 动态突变感知
  const handleIframeLoad = () => {
    syncIframePageAndScroll();

    try {
      const iframeWin = iframeRef.current?.contentWindow;
      const iframeDoc = iframeRef.current?.contentDocument;
      if (iframeWin && iframeDoc) {
        bindIframeKeyboard();

        let scrollTicking = false;
        const onScroll = () => {
          if (!scrollTicking) {
            scrollTicking = true;
            requestAnimationFrame(() => {
              setScrollVersion((v) => v + 1);
              scrollTicking = false;
            });
          }
        };
        const onHashChange = () => syncIframePageAndScroll();

        iframeWin.addEventListener("scroll", onScroll, { passive: true });
        iframeWin.addEventListener("resize", onScroll, { passive: true });
        iframeWin.addEventListener("hashchange", onHashChange);
        iframeWin.addEventListener("popstate", onHashChange);

        iframeDoc.addEventListener("click", () => {
          setTimeout(syncIframePageAndScroll, 60);
        });

        // 核心技术点：挂载 MutationObserver 实时监听原型内部的内联页面切换与显隐变化
        if (iframeDoc.body) {
          const domObserver = new MutationObserver(() => {
            setScrollVersion((v) => v + 1);
          });
          domObserver.observe(iframeDoc.body, {
            attributes: true,
            attributeFilter: ["class", "style", "hidden"],
            subtree: true,
            childList: true
          });
        }

        // 检查是否有挂起的跨文件定位评论
        if (pendingScrollCommentIdRef.current) {
          const targetId = pendingScrollCommentIdRef.current;
          pendingScrollCommentIdRef.current = null;
          const targetComment = comments.find((c) => c.id === targetId);
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
    const timer = setInterval(syncIframePageAndScroll, 600);
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

  const handleAddCommentSubmit = async (params: {
    pagePath: string;
    xPercent: number;
    yPercent: number;
    docX: number;
    docY: number;
    target?: CommentTargetInfo;
    content: string;
  }) => {
    try {
      const newComment = await api.addComment(proto.id, {
        versionId: selectedVersionId,
        pagePath: params.pagePath || currentSubPath,
        xPercent: params.xPercent,
        yPercent: params.yPercent,
        docX: params.docX,
        docY: params.docY,
        target: params.target,
        content: params.content,
        author: {
          name: account.name,
          avatar: account.avatar
        }
      });
      setComments((prev) => [...prev, newComment]);
      setActiveCommentId(newComment.id);
      setIsSidebarOpen(true);
      setScrollVersion((v) => v + 1);
    } catch (err: any) {
      alert(err.message || "评论发表失败");
    }
  };

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

  const openCount = comments.filter((c) => c.status === "open").length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">
      {/* 顶部操作栏 */}
      <header className="h-14 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 flex items-center justify-between z-20 shrink-0 select-none shadow-md">
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

            {/* 当前原型子页面标识 */}
            <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/50 text-[11px] text-slate-300">
              <Compass className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="font-mono truncate max-w-[160px]">{currentSubPath}</span>
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

            {/* 元素锚定与视口跟随批注图层 */}
            <ErrorBoundary
              fallbackTitle="批注图层暂时遇到重载"
              onReset={() => setScrollVersion((v) => v + 1)}
            >
              <CommentOverlay
                iframeRef={iframeRef}
                currentSubPath={currentSubPath}
                scrollVersion={scrollVersion}
                comments={comments}
                isAddingComment={isAddingComment}
                onExitAddMode={() => setIsAddingComment(false)}
                activeCommentId={activeCommentId}
                onSelectComment={(id) => {
                  setActiveCommentId(id);
                }}
                onSubmitNewComment={handleAddCommentSubmit}
              />
            </ErrorBoundary>
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
          onNavigateToPage={handleNavigateToPage}
          currentVersionLabel={currentVersion?.versionLabel || "v1.0"}
          account={account}
        />
      </div>
    </div>
  );
};
