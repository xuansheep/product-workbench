import { type CommentTargetInfo } from "../types/index.js";

// 视图容器的 id 命名签名（覆盖 #page-* / #tab-* / #view-* / *-page 等约定）
const VIEW_ID_RE = /^(page|tab|view|screen|panel|content|module|route)-|-(page|view|screen|panel|content)$/i;
// 视图容器的类名签名
const VIEW_CLASS_RE = /^(page|tab-content|tab-pane|view|screen|panel|content-page)$/;
// 状态类不进选择器：它们随交互翻转，写进路径会让锚点在切换后漂移
const STATE_CLASS_RE =
  /^(active|open|show|shown|selected|current|on|off|hidden|hide|in|out|fade|collapse|collapsed|expanded|focus|hover|visible|disabled|loading|animate|transition|is-|has-|js-)/i;
// 时钟类文本不进指纹：原型常常每秒刷一次时间，原样参与会让锚点自己失效
const CLOCK_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
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

// 指纹里用的类名。筛选规则必须与容器内容无关：不能复用 pickClass，
// 它的「容器内出现超过 3 次即排除」是容器相对的，容器内容一变选出的类名就跟着变，指纹会自我否决
// 文本指纹。数字必须剥掉：目标文本常是实时数据（如「压差 867 mV · 6 异常」），
// 数值一刷新就变，只有其中稳定的文字部分能做判据
function cleanText(value: string): string {
  return value.replace(/[^一-龥a-zA-Z]/g, "");
}

// 从文档根到元素的完整结构路径。容器被换掉、或容器内的局部增删让容器内选择器失效时，
// 整条路径仍可能重新命中同一个元素
function buildRootPath(el: HTMLElement, doc: Document): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== doc.documentElement && cur.parentElement) {
    const sameTag = Array.from(cur.parentElement.children).filter((c) => c.tagName === cur!.tagName);
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${sameTag.indexOf(cur) + 1})`);
    cur = cur.parentElement;
  }
  return parts.length ? `html > ${parts.join(" > ")}` : "";
}

function stableClasses(el: HTMLElement): string {
  return Array.from(el.classList)
    .filter((name) => /^[A-Za-z_][\w-]*$/.test(name) && name.length <= 40 && !STATE_CLASS_RE.test(name))
    .sort()
    .join(".");
}

// 容器内容的结构骨架：只取 tag 与稳定类名，不含文本、属性与状态类
function skeletonOf(container: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      // 浮窗宿主是渲染过程中增减的注入物，绘制层（SVG 等）不属于内容结构，两者都不进指纹
      if (child.tagName.startsWith("WB-")) continue;
      if (child.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      const cls = stableClasses(child as HTMLElement);
      parts.push(child.tagName.toLowerCase() + (cls ? `.${cls}` : ""));
      walk(child);
    }
  };
  walk(container);
  return parts.join("|");
}

// 双 32 位哈希拼成 64 位：骨架串在电芯面板这类重内容下可达数十 KB，不能直接入库
function hashOf(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 + code, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

// 骨架要遍历容器整棵子树（数千节点），按容器缓存；浮窗层在 DOM 变更时作废缓存
let signatureEpoch = 0;
const signatureCache = new WeakMap<Element, { epoch: number; value: string; legacy: string }>();

export function invalidateContainerSignatures(): void {
  signatureEpoch += 1;
}

function signatureOf(container: HTMLElement): { value: string; legacy: string } {
  const cached = signatureCache.get(container);
  if (cached && cached.epoch === signatureEpoch) return cached;

  const skeleton = skeletonOf(container);
  const head = `${skeleton.length}:${hashOf(skeleton)}`;
  const raw = (container.textContent || "").replace(/\s+/g, " ").trim();
  const text = raw.replace(CLOCK_RE, "#");
  const fresh = {
    epoch: signatureEpoch,
    value: `${head}:${text.length}:${hashOf(text)}`,
    legacy: `${head}:${raw.length}:${hashOf(raw)}`
  };
  signatureCache.set(container, fresh);
  return fresh;
}

/**
 * 容器此刻装载的是哪一份内容 —— 锚点唯一性的主判据。
 *
 * 光比结构不够：实测同一原型 42 个视图状态里，只比骨架会把「历史趋势/EMS」与「历史趋势/PCS」、
 * 两台设备各自的「概览」判成同一份内容。业务实体的身份（设备名、SN）编在文本里，所以文本也要比；
 * 而且必须**保留数字**，把数字归一化掉，两台设备就又分不开了。
 * 用 textContent 而不是 innerText：不依赖布局，容器显隐前后算出来的值一致。
 * 时间片段先归一化：实测有原型每秒刷新时钟，原样比对会让这条批注永远定位不到。
 * 归一化只吃掉时间格式，业务数字（设备编号、SN）照旧参与比对。
 * 前缀是两段长度，用于在哈希偶发相同时再挡一道。
 */
export function containerSignature(container: HTMLElement): string {
  return signatureOf(container).value;
}

// 从容器文本里抽一小撮带数字的标识（SN、型号、编号、实体名），只用于探测时的候选排序：
// 让"文字出现在目标状态里"的控件排到最前，几十个同构条目里才点得中目标实体。
// 只要含数字的：业务实体的区分度全在数字上，纯文字词（如「在保」）满页都是，没有判别力
function contentTokens(container: HTMLElement): string[] | undefined {
  const text = (container.textContent || "").replace(/\s+/g, " ");
  const matched = text.match(/[A-Za-z0-9_]*[一-龥]{1,8}[0-9A-Za-z]*|[A-Za-z0-9][A-Za-z0-9\-_.]{2,}/g) ?? [];

  const out: string[] = [];
  for (const token of matched) {
    if (out.length >= 40) break;
    if (!/\d/.test(token) || out.includes(token)) continue;
    out.push(token);
  }
  return out.length ? out : undefined;
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

// 带显式视图容器标记：切换页面/tab 时显隐的那一层
function hasViewMarker(el: HTMLElement): boolean {
  if (el.id && VIEW_ID_RE.test(el.id)) return true;
  if (el.getAttribute("role") === "tabpanel") return true;
  if (el.hasAttribute("data-page") || el.hasAttribute("data-view")) return true;
  return Array.from(el.classList).some((c) => VIEW_CLASS_RE.test(c));
}

// 覆盖层：固定定位、叠得很高的那一类。弹窗、抽屉里的内容和背后的页面无关，
// 该由它自己当容器；落到 body 会让指纹把整篇文档都吃进去，任何页面变化都判成锚点失效
function isOverlay(el: HTMLElement, doc: Document): boolean {
  const win = doc.defaultView;
  if (!win) return false;
  const style = win.getComputedStyle(el);
  return style.position === "fixed" && Number(style.zIndex) >= 100;
}

// 定位元素所属的视图容器：最内层那一层，元素选择器的作用域
export function findViewContainer(el: HTMLElement, doc: Document): HTMLElement {
  for (let cur: HTMLElement | null = el; cur && cur !== doc.body; cur = cur.parentElement) {
    if (hasViewMarker(cur)) return cur;
  }

  for (let cur: HTMLElement | null = el; cur && cur !== doc.body; cur = cur.parentElement) {
    if (isOverlay(cur, doc)) return cur;
  }

  // 无显式签名时按兄弟分组推断：同标签同类名集合的兄弟 ≥2 且成块。
  // 类名要用过滤掉状态类的那套：弹窗这类兄弟组里只有一个带 show/active，
  // 按原始 classList 比会各算一组，等于永远认不出这组兄弟
  for (let cur: HTMLElement | null = el; cur && cur !== doc.body; cur = cur.parentElement) {
    if (!GROUPABLE_TAGS.has(cur.tagName)) continue;
    if (cur.getBoundingClientRect().height < 120) continue;

    const parent = cur.parentElement;
    if (!parent) continue;
    const signature = (node: Element) => `${node.tagName}|${stableClasses(node as HTMLElement)}`;
    const siblings = Array.from(parent.children).filter((s) => signature(s) === signature(cur));
    if (siblings.length >= 2 && siblings.length <= 40) return cur;
  }

  return doc.body;
}

// 跨页面跳转的落点，也是内容指纹覆盖的范围。有显式标记就取最外层那个；
// 没有就用传进来的容器（最内层）—— 弹窗、抽屉这类浮层没有任何页面标记，
// 落回 body 会让指纹把整篇文档都吃进去，任何页面变化都判成"锚点失效"
export function findPageContainer(el: HTMLElement, doc: Document): HTMLElement {
  let found: HTMLElement | null = null;
  for (let cur: HTMLElement | null = el; cur && cur !== doc.body; cur = cur.parentElement) {
    if (hasViewMarker(cur)) found = cur;
  }
  return found ?? el;
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
  // 最内层容器只作元素选择器的作用域；指纹与跨页跳转都落在最外层容器上 ——
  // 只记最内层的话，容器选择器是 #tab-body，跨页时拼不出原型的 go('device')，永远切不过去
  const container = findViewContainer(target, doc);
  const page = findPageContainer(container, doc);
  const containerRect = container.getBoundingClientRect();

  const base: CommentTargetInfo = {
    anchorKind: "container",
    viewContainerSelector: buildViewContainerSelector(container, doc),
    pageContainerSelector: buildViewContainerSelector(page, doc),
    containerSignature: containerSignature(page),
    containerTokens: contentTokens(page),
    containerOffsetXPercent: percent(cx - (containerRect.left + container.clientLeft), container.clientWidth),
    containerOffsetYPercent: percent(cy - (containerRect.top + container.clientTop), container.clientHeight)
  };
  if (page.id) base.inlinePageId = page.id;

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
    elementPath: buildRootPath(host, doc),
    elementOffsetXPercent: percent(cx - (rect.left + host.clientLeft), host.clientWidth),
    elementOffsetYPercent: percent(cy - (rect.top + host.clientTop), host.clientHeight)
  };
}

// 容器内容指纹是否与记录时一致。不一致说明容器已被换成另一份内容，锚点不再指向原处；
// 旧格式锚点没有指纹，无从判定，一律按无法唯一确定处理
function containerUnchanged(target: CommentTargetInfo, container: HTMLElement): boolean {
  const signature = target.containerSignature;
  if (!signature) return false;

  const fresh = signatureOf(container);
  // legacy 是上一版的口径（文本不做时间归一化）。留着认它，改算法就不会把已有批注一次判死；
  // 它要求文本逐字节一致，比新口径更严，只可能更少命中，不会放宽判据
  return fresh.value === signature || fresh.legacy === signature;
}

// 元素选择器的作用域：最内层视图容器
export function containerSelectorOf(target?: CommentTargetInfo): string | null {
  if (!target) return null;
  return target.viewContainerSelector ?? (target.inlinePageId ? `#${CSS.escape(target.inlinePageId)}` : null);
}

// 状态指纹与跨页跳转的落点：最外层视图容器。老数据只存 inlinePageId，按最内层语义退回
export function pageContainerSelectorOf(target?: CommentTargetInfo): string | null {
  if (!target) return null;
  if (target.pageContainerSelector) return target.pageContainerSelector;
  return target.inlinePageId ? `#${CSS.escape(target.inlinePageId)}` : containerSelectorOf(target);
}

// 指纹是否为当前格式（骨架段 + 文本段）。老格式锚点（只有骨架段、或完全没有）拿不到判据，
// 解析必然失败 —— 这种锚点不能进探测，否则会为一条永远找不到的批注满页乱点
const SIGNATURE_RE = /^\d+:[0-9a-f]{16}:\d+:[0-9a-f]{16}$/;

export function hasUsableSignature(target?: CommentTargetInfo): boolean {
  return Boolean(target?.containerSignature && SIGNATURE_RE.test(target.containerSignature));
}

// 回退判据：容器整个不见了以后，按记录的整条结构路径再找一次，并要求文本指纹吻合。
// 只在这个前提下用：共享容器还在时，路径在两个同构的视图状态之间会互相命中 —— 那正是最初的漂移成因
function resolveByRootPath(doc: Document, target: CommentTargetInfo): HTMLElement | null {
  if (!target.elementPath) return null;

  const hits = safeQueryAll(doc, target.elementPath);
  if (hits.length !== 1) return null;

  const el = hits[0];
  if (target.tagName && el.tagName !== target.tagName) return null;
  if (!isRendered(el, doc)) return null;

  const needle = cleanText(target.innerTextSnippet || "");
  if (needle.length >= 2 && !cleanText(el.textContent || "").includes(needle)) return null;
  return el;
}

// 严格解析锚点：最外层容器内容须与记录时一致，最内层容器作用域内候选唯一。
// 唯一例外是页面级容器整个找不到（原型结构大改），才退到整条结构路径去认
export function resolveAnchor(
  doc: Document,
  target?: CommentTargetInfo
): { kind: "element" | "container"; el: HTMLElement } | null {
  if (!target) return null;

  const pageSelector = pageContainerSelectorOf(target);
  const page = pageSelector ? uniqueOrNull(doc, pageSelector) : null;
  const scopeSelector = containerSelectorOf(target);
  const scope = scopeSelector ? uniqueOrNull(doc, scopeSelector) : null;

  const wantsElement = (target.anchorKind ?? (target.selector ? "element" : "container")) === "element";
  if (wantsElement && target.selector) {
    if (!page) {
      const fallback = resolveByRootPath(doc, target);
      return fallback ? { kind: "element", el: fallback } : null;
    }
    if (!scope || !containerUnchanged(target, page)) return null;

    const candidates = safeQueryAll(scope, target.selector).filter((el) => isRendered(el, doc));
    if (candidates.length === 1) {
      const el = candidates[0];
      if (!target.tagName || el.tagName === target.tagName) return { kind: "element", el };
    }
    return null;
  }

  // 容器锚点：判据在页面级，返回的是承载百分比偏移的最内层容器
  if (!page || !containerUnchanged(target, page)) return null;
  const host = scope ?? page;
  if (!isRendered(host, doc)) return null;
  return { kind: "container", el: host };
}
