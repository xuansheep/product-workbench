import { type CommentTargetInfo } from "../types/index.js";

// 精准生成全局具有唯一性的多级选择器
export function getUniqueElementSelector(el: HTMLElement, doc: Document): string {
  if (el.id) {
    const escaped = `#${CSS.escape(el.id)}`;
    if (doc.querySelectorAll(escaped).length === 1) {
      return escaped;
    }
  }

  const parts: string[] = [];
  let current: HTMLElement | null = el;

  while (current && current !== doc.body && current !== doc.documentElement) {
    let segment = current.tagName.toLowerCase();
    if (current.id) {
      segment = `#${CSS.escape(current.id)}`;
      parts.unshift(segment);
      const pathCandidate = parts.join(" > ");
      if (doc.querySelectorAll(pathCandidate).length === 1) {
        return pathCandidate;
      }
    } else {
      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (c) => c.tagName === current!.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }
      const validClass = Array.from(current.classList).find(
        (c) => !c.includes(":") && !c.includes("[") && !c.includes("/") && c.length < 30
      );
      if (validClass) {
        segment = `${current.tagName.toLowerCase()}.${CSS.escape(validClass)}${
          segment.includes(":") ? segment.slice(segment.indexOf(":")) : ""
        }`;
      }
      parts.unshift(segment);
      const pathCandidate = parts.join(" > ");
      if (doc.querySelectorAll(pathCandidate).length === 1) {
        return pathCandidate;
      }
    }
    current = current.parentElement;
  }

  const fullPath = parts.join(" > ");
  return fullPath || el.tagName.toLowerCase();
}

// 检查元素在当前时刻是否在 DOM 树中真实可见（排除自身或祖先容器 display:none、visibility:hidden 或失去 active 的内联页面）
export function isElementVisibleInDOM(el: HTMLElement, doc: Document): boolean {
  if (!doc.body.contains(el)) return false;

  // getClientRects 在 display: none 时返回长度为 0
  const rects = el.getClientRects();
  if (rects.length === 0) return false;

  const win = doc.defaultView || window;
  let curr: HTMLElement | null = el;

  while (curr && curr !== doc.body && curr !== doc.documentElement) {
    const style = win.getComputedStyle(curr);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    // 针对单文件原型常见的 .page、.tab-pane 等视图切换机制
    if (curr.classList.contains("page") && !curr.classList.contains("active")) {
      return false;
    }
    if (curr.classList.contains("tab-pane") && !curr.classList.contains("active")) {
      return false;
    }

    curr = curr.parentElement;
  }

  return true;
}

// 获取元素所属的内联页面/视图容器标识（如 id="page-overview"）
export function getInlinePageIdentifier(el: HTMLElement, doc: Document): string | undefined {
  const container = el.closest(
    '.page, [id^="page-"], [id*="view-"], [class*="page-"], .tab-pane, section, [role="tabpanel"]'
  ) as HTMLElement | null;

  if (container && container.id) {
    return container.id;
  }
  if (container && container.className) {
    const firstClass = container.className.split(" ")[0];
    if (firstClass) return firstClass;
  }

  // 兜底查看当前活跃的页面容器
  const activePage = doc.querySelector('.page.active, [class*="active"][id^="page"]') as HTMLElement | null;
  return activePage?.id || undefined;
}

// 多维度精准定位元素 (选择器 + 文本指纹 + 内联页面感知 + 空间综合加权)
export function findBestMatchingElement(
  doc: Document,
  targetInfo?: CommentTargetInfo,
  docX?: number,
  docY?: number
): HTMLElement | null {
  if (!targetInfo) return null;

  let candidates: HTMLElement[] = [];
  if (targetInfo.selector) {
    try {
      candidates = Array.from(doc.querySelectorAll(targetInfo.selector));
    } catch {
      // 容错选择器
    }
  }

  const iframeWin = doc.defaultView;
  const scrollX = iframeWin?.scrollX ?? doc?.documentElement?.scrollLeft ?? doc?.body?.scrollLeft ?? 0;
  const scrollY = iframeWin?.scrollY ?? doc?.documentElement?.scrollTop ?? doc?.body?.scrollTop ?? 0;

  // 备用：无法通过选择器找到时，按标签与相同文本过滤
  if (candidates.length === 0 && targetInfo.tagName && targetInfo.innerTextSnippet) {
    const allSameTags = Array.from(doc.getElementsByTagName(targetInfo.tagName)) as HTMLElement[];
    const cleanSnippet = targetInfo.innerTextSnippet
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
      .slice(0, 10);
    if (cleanSnippet) {
      candidates = allSameTags.filter((el) => {
        const text = (el.textContent || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
        return text.includes(cleanSnippet);
      });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // 多候选打分系统：精准区别不同内联页面与同类卡片/按钮
  let bestElement: HTMLElement | null = null;
  let bestScore = -Infinity;

  const cleanSnippet = targetInfo.innerTextSnippet
    ? targetInfo.innerTextSnippet.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "").slice(0, 10)
    : "";

  for (const el of candidates) {
    let score = 0;
    const elText = (el.textContent || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");

    // 0. 内联页面可见性权值 (+20000)
    if (isElementVisibleInDOM(el, doc)) {
      score += 20000;
    }

    // 1. 文本强匹配权值 (+10000)
    if (cleanSnippet && elText.includes(cleanSnippet)) {
      score += 10000;
    }

    // 2. 绝对文档空间距离权值 (越近越加分)
    if (typeof docX === "number" && typeof docY === "number") {
      const r = el.getBoundingClientRect();
      const elDocX = r.left + scrollX + r.width / 2;
      const elDocY = r.top + scrollY + r.height / 2;
      const dist = Math.hypot(elDocX - docX, elDocY - docY);
      score += Math.max(0, 3000 - dist);
    }

    if (score > bestScore) {
      bestScore = score;
      bestElement = el;
    }
  }

  return bestElement || candidates[0];
}
