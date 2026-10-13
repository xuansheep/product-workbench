import { type CommentTargetInfo } from "../types/index.js";

// 视图容器的 id 命名签名（覆盖 #page-* / #tab-* / #view-* / *-page 等约定）
const VIEW_ID_RE = /^(page|tab|view|screen|panel|content|module|route)-|-(page|view|screen|panel|content)$/i;
// 视图容器的类名签名
const VIEW_CLASS_RE = /^(page|tab-content|tab-pane|view|screen|panel|content-page)$/;
// 状态类不进选择器：它们随交互翻转，写进路径会让锚点在切换后漂移
const STATE_CLASS_RE =
  /^(active|open|show|shown|selected|current|on|off|hidden|hide|in|out|fade|collapse|collapsed|expanded|focus|hover|visible|disabled|loading|animate|transition|is-|has-|js-)/i;
// 无法承载子节点或无法定位的元素
const VOID_TAGS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT",
  "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"
]);
// 表格结构节点上 position:relative 各浏览器行为不一致，不作为宿主
const TABLE_STRUCT_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "COLGROUP", "COL"]);
// 兄弟分组识别时排除这些标签，避免把表格行、列表项误判为视图容器
const GROUPABLE_TAGS = new Set(["DIV", "SECTION", "MAIN", "ARTICLE", "ASIDE", "FORM"]);

function safeQueryAll(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
  } catch {
    return [];
  }
}

function uniqueOrNull(root: ParentNode, selector: string): HTMLElement | null {
  const list = safeQueryAll(root, selector);
  return list.length === 1 ? list[0] : null;
}

function percent(offset: number, size: number): number {
  if (!size) return 50;
  const raw = (offset / size) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
}

function cleanText(value: string): string {
  return value.replace(/[^一-龥a-zA-Z]/g, "");
}

function textSnippet(el: HTMLElement): string | undefined {
  const text = (el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return text || undefined;
}

// 元素此刻是否真实渲染（自身或任一祖先 display:none / visibility:hidden 即为否）
export function isRendered(el: HTMLElement, doc: Document): boolean {
  if (!doc.body || !doc.body.contains(el)) return false;
  if (el.getClientRects().length === 0) return false;

  const win = doc.defaultView;
  if (!win) return true;
  for (let cur: HTMLElement | null = el; cur && cur !== doc.documentElement; cur = cur.parentElement) {
    const style = win.getComputedStyle(cur);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

// 定位元素所属的视图容器：切换页面/tab 时显隐的那一层，锚点解析的硬边界
export function findViewContainer(el: HTMLElement, doc: Document): HTMLElement {
  for (let cur: HTMLElement | null = el; cur && cur !== doc.body; cur = cur.parentElement) {
    if (cur.id && VIEW_ID_RE.test(cur.id)) return cur;
    if (cur.getAttribute("role") === "tabpanel") return cur;
    if (cur.hasAttribute("data-page") || cur.hasAttribute("data-view")) return cur;
    if (Array.from(cur.classList).some((c) => VIEW_CLASS_RE.test(c))) return cur;
  }

  // 无显式签名时按兄弟分组推断：同标签同类名集合的兄弟 ≥2 且成块
  for (let cur: HTMLElement | null = el; cur && cur !== doc.body; cur = cur.parentElement) {
    if (!GROUPABLE_TAGS.has(cur.tagName)) continue;
    if (cur.getBoundingClientRect().height < 120) continue;

    const parent = cur.parentElement;
    if (!parent) continue;
    const signature = (node: Element) => `${node.tagName}|${Array.from(node.classList).sort().join(".")}`;
    const siblings = Array.from(parent.children).filter((s) => signature(s) === signature(cur));
    if (siblings.length >= 2 && siblings.length <= 40) return cur;
  }

  return doc.body;
}

// 视图容器的唯一选择器；id 不可用时退化为 body 起的绝对 nth-child 路径
export function buildViewContainerSelector(container: HTMLElement, doc: Document): string {
  if (container === doc.body) return "body";
  if (container.id) {
    const byId = `#${CSS.escape(container.id)}`;
    if (doc.querySelectorAll(byId).length === 1) return byId;
  }

  const parts: string[] = [];
  let cur: HTMLElement | null = container;
  while (cur && cur !== doc.body && cur.parentElement) {
    const index = Array.from(cur.parentElement.children).indexOf(cur) + 1;
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${index})`);
    cur = cur.parentElement;
  }
  return parts.length ? `body > ${parts.join(" > ")}` : "body";
}

function classScore(name: string): number {
  return name.length + (name.includes("-") ? 4 : 0);
}

// 挑一个具备区分度的类名：排除状态类、工具类（容器内出现超过 3 次即视为泛化类）
function pickClass(el: HTMLElement, container: HTMLElement): string | null {
  const usable = Array.from(el.classList).filter((name) => {
    if (!/^[A-Za-z_][\w-]*$/.test(name)) return false;
    if (name.length > 40) return false;
    if (STATE_CLASS_RE.test(name)) return false;
    return container.querySelectorAll(`.${CSS.escape(name)}`).length <= 3;
  });
  usable.sort((a, b) => classScore(b) - classScore(a));
  return usable[0] ?? null;
}

// 生成相对 container 作用域的唯一选择器；走到容器仍不唯一则返回 null（调用方降级为容器锚点）
export function buildUniqueSelector(el: HTMLElement, container: HTMLElement): string | null {
  if (el === container) return null;

  if (el.id) {
    const byId = `#${CSS.escape(el.id)}`;
    if (container.querySelectorAll(byId).length === 1) return byId;
  }

  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== container && cur.parentElement) {
    if (cur.id) {
      const byId = `#${CSS.escape(cur.id)}`;
      if (container.querySelectorAll(byId).length === 1) {
        parts.unshift(byId);
        const candidate = parts.join(" > ");
        return container.querySelectorAll(candidate).length === 1 ? candidate : null;
      }
    }

    const parent: HTMLElement = cur.parentElement;
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    const nth = sameTag.length > 1 ? `:nth-of-type(${sameTag.indexOf(cur) + 1})` : "";
    const cls = pickClass(cur, container);
    const segment = `${cur.tagName.toLowerCase()}${cls ? `.${CSS.escape(cls)}` : ""}${nth}`;

    parts.unshift(segment);
    const candidate = parts.join(" > ");
    if (container.querySelectorAll(candidate).length === 1) return candidate;
    cur = cur.parentElement;
  }

  return null;
}

// 点击落在表格结构节点上时，归一化到点击点横向命中的单元格
export function normalizeTableTarget(el: HTMLElement, cx: number): HTMLElement {
  if (!TABLE_STRUCT_TAGS.has(el.tagName)) return el;

  const row = el.tagName === "TABLE" ? null : el.closest("tr");
  const scope: Element = row ?? el;
  const cells = Array.from(scope.querySelectorAll("td, th")) as HTMLElement[];
  if (cells.length === 0) return (el.closest("table") as HTMLElement | null) ?? el;

  const hit = cells.find((cell) => {
    const rect = cell.getBoundingClientRect();
    return cx >= rect.left && cx <= rect.right;
  });
  return hit ?? cells[0];
}

function canHost(el: HTMLElement): boolean {
  if (VOID_TAGS.has(el.tagName)) return false;
  if (TABLE_STRUCT_TAGS.has(el.tagName)) return false;
  if (el.tagName === "OPTION" || el.tagName === "OPTGROUP") return false;
  if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") return false;

  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  if (win.getComputedStyle(el).display === "contents") return false;
  if (el.getClientRects().length === 0) return false;
  return el.clientWidth > 0 || el.clientHeight > 0;
}

function findHostableAncestor(el: HTMLElement, container: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur && cur !== container.parentElement) {
    if (canHost(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

// 点击坐标将要承载浮窗的元素。不生成选择器，供实时高亮等每帧调用的廉价路径复用
export function findAnchorElement(
  rawTarget: HTMLElement,
  doc: Document
): { el: HTMLElement; kind: "element" | "container" } {
  const target = !rawTarget || rawTarget === doc.documentElement ? doc.body : rawTarget;
  const container = findViewContainer(target, doc);
  if (target === doc.body || target === container) return { el: container, kind: "container" };

  const host = findHostableAncestor(target, container);
  if (!host || host === container) return { el: container, kind: "container" };
  return { el: host, kind: "element" };
}

// 点击坐标 → 锚点描述符。始终产出容器锚点基线，元素不可挂载或选择器不唯一时停留在容器锚点
export function buildAnchorDescriptor(
  rawTarget: HTMLElement,
  doc: Document,
  cx: number,
  cy: number
): CommentTargetInfo {
  const target = !rawTarget || rawTarget === doc.documentElement ? doc.body : rawTarget;
  const container = findViewContainer(target, doc);
  const containerRect = container.getBoundingClientRect();

  const base: CommentTargetInfo = {
    anchorKind: "container",
    viewContainerSelector: buildViewContainerSelector(container, doc),
    containerOffsetXPercent: percent(cx - (containerRect.left + container.clientLeft), container.clientWidth),
    containerOffsetYPercent: percent(cy - (containerRect.top + container.clientTop), container.clientHeight)
  };
  if (container.id) base.inlinePageId = container.id;

  const anchor = findAnchorElement(target, doc);
  if (anchor.kind === "container") return base;

  const host = anchor.el;
  const selector = buildUniqueSelector(host, container);
  if (!selector) return base;

  const rect = host.getBoundingClientRect();
  return {
    ...base,
    anchorKind: "element",
    selector,
    tagName: host.tagName,
    innerTextSnippet: textSnippet(host),
    elementOffsetXPercent: percent(cx - (rect.left + host.clientLeft), host.clientWidth),
    elementOffsetYPercent: percent(cy - (rect.top + host.clientTop), host.clientHeight)
  };
}

// 位置型选择器在原型重建后可能"位置对、数据换了"，用文本指纹做最后一道闸
function snippetMatches(target: CommentTargetInfo, el: HTMLElement): boolean {
  if (!target.selector?.includes(":nth-of-type")) return true;
  const needle = cleanText(target.innerTextSnippet || "");
  if (needle.length < 2) return true;
  return cleanText(el.textContent || "").includes(needle);
}

// 锚点解析的硬边界：老数据只存 inlinePageId，新数据存 viewContainerSelector
export function containerSelectorOf(target?: CommentTargetInfo): string | null {
  if (!target) return null;
  return target.viewContainerSelector ?? (target.inlinePageId ? `#${CSS.escape(target.inlinePageId)}` : null);
}

// 严格解析锚点：多候选不猜，任何歧义都返回 null，由调用方决定不渲染
export function resolveAnchor(
  doc: Document,
  target?: CommentTargetInfo
): { kind: "element" | "container"; el: HTMLElement } | null {
  if (!target) return null;

  const containerSelector = containerSelectorOf(target);
  const container = containerSelector ? uniqueOrNull(doc, containerSelector) : null;

  const wantsElement = (target.anchorKind ?? (target.selector ? "element" : "container")) === "element";
  if (wantsElement && target.selector) {
    if (!container) return null;
    const candidates = safeQueryAll(container, target.selector).filter((el) => isRendered(el, doc));
    if (candidates.length !== 1) return null;

    const el = candidates[0];
    if (target.tagName && el.tagName !== target.tagName) return null;
    if (!snippetMatches(target, el)) return null;
    return { kind: "element", el };
  }

  if (!container || !isRendered(container, doc)) return null;
  return { kind: "container", el: container };
}
