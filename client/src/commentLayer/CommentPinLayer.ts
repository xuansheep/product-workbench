import { type Comment, type CommentTargetInfo, PRESET_AVATARS } from "../types/index.js";
import {
  buildAnchorDescriptor,
  containerSelectorOf,
  findAnchorElement,
  invalidateContainerSignatures,
  normalizeTableTarget,
  resolveAnchor
} from "../utils/commentAnchor.js";
import { makeSheetInstaller } from "./layerStyles.js";
import { buildCheckIcon, buildCommentCard, buildDraftCard, type DraftCardView } from "./cardView.js";
import { captureViewportSnapshot, type CapturedSnapshot } from "../utils/commentSnapshot.js";

// 宿主自身不参与布局。只列关键属性：all:initial 的整套重置放在 shadow 的 :host 规则里，
// 否则浏览器会把 all 展开成数百条声明，让 style 属性膨胀到几 KB
const PIN_HOST_STYLE =
  "position:absolute;display:block;width:0;height:0;" +
  "z-index:2147483000;contain:layout style;pointer-events:none;";

// 卡片与高亮统一放在 body 级单例层，避免被锚点祖先的 overflow:hidden 裁切
const CARD_LAYER_STYLE =
  "position:absolute;left:0;top:0;display:block;width:0;height:0;" +
  "z-index:2147483000;pointer-events:none;";

const CARD_FALLBACK_WIDTH = 256;
const CARD_GAP = 8;
const VIEWPORT_PADDING = 8;
const DOT_SIZE = 20;
const DRAFT_ID = "__draft__";
const PATROL_INTERVAL = 1500;
const HOVER_HIDE_DELAY = 120;

const BLOCKED_EVENTS = [
  "mousedown",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "pointerdown",
  "pointerup",
  "contextmenu"
] as const;

// 一个文档只允许存在一个浮窗层。新层建立时挤掉同文档的旧层，避免残留无法回收的孤儿宿主
const liveLayers = new Map<Document, CommentPinLayer>();

export interface DraftPayload {
  pagePath: string;
  target: CommentTargetInfo;
  content: string;
  /** 发表时截取的视口快照；采集失败时为 null */
  snapshot: CapturedSnapshot | null;
}

export interface CommentPinLayerOptions {
  doc: Document;
  win: Window;
  getComments: () => Comment[];
  getCurrentPath: () => string;
  getActiveCommentId: () => string | null;
  /** 为 false 时进入纯预览：不绘制任何浮窗 */
  isPinsVisible: () => boolean;
  onSelectComment: (id: string | null) => void;
  onSubmitDraft: (payload: DraftPayload) => Promise<void>;
  onDraftChange?: (hasDraft: boolean) => void;
}

interface PinRecord {
  host: HTMLElement;
  dot: HTMLElement;
  anchorEl: HTMLElement;
  kind: "element" | "container";
}

interface PositionBackup {
  refs: number;
  changed: boolean;
  prev: string;
}

interface AnchorEntry {
  comment: Comment;
  el: HTMLElement;
  kind: "element" | "container";
}

interface DraftState {
  target: CommentTargetInfo;
  record: PinRecord;
  view: DraftCardView;
}

/**
 * iframe 内批注浮窗的唯一所有者。
 *
 * 浮窗作为被锚定元素的子节点注入，位置由布局引擎保证，滚动与原型内部变化都不需要重算。
 * React 只通过这里的命令式门面下发状态，不直接触碰 iframe 文档。
 */
export class CommentPinLayer {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly opts: CommentPinLayerOptions;
  private readonly installSheet: (shadow: ShadowRoot) => void;
  private readonly observer: MutationObserver;

  private reconcileRaf: number | null = null;
  private cardRaf: number | null = null;
  private highlightRaf: number | null = null;
  private patrolTimer: number | null = null;
  private hoverTimer: number | null = null;
  private selfWriteDepth = 0;

  private readonly pins = new Map<string, PinRecord>();
  private readonly posBackup = new WeakMap<HTMLElement, PositionBackup>();

  private cardLayerHost: HTMLElement | null = null;
  private cardShadow: ShadowRoot | null = null;
  private cardSlot: HTMLElement | null = null;
  private cardRoot: HTMLElement | null = null;
  private cardOwnerEl: HTMLElement | null = null;
  private cardOwnerId: string | null = null;
  private cardSignature: string | null = null;
  private highlight: HTMLElement | null = null;
  private mask: HTMLElement | null = null;

  private draft: DraftState | null = null;
  private addMode = false;
  private disposed = false;
  private hoveredId: string | null = null;
  private submitting = false;
  private hoverPoint: { raw: HTMLElement; clientX: number; clientY: number } | null = null;

  constructor(opts: CommentPinLayerOptions) {
    this.opts = opts;
    this.doc = opts.doc;
    this.win = opts.win;
    this.installSheet = makeSheetInstaller(this.doc);
    this.observer = new MutationObserver((records) => this.onMutations(records));

    liveLayers.get(this.doc)?.dispose();
    liveLayers.set(this.doc, this);
  }

  // ---------------------------------------------------------------- 生命周期

  mount(): void {
    if (!this.doc.body) return;
    this.ensureCardLayer();
    this.observe();
    this.win.addEventListener("resize", this.onResize);
    this.patrolTimer = this.win.setInterval(() => this.reconcile(), PATROL_INTERVAL);
    this.reconcile();
  }

  dispose(): void {
    this.disposed = true;
    if (liveLayers.get(this.doc) === this) liveLayers.delete(this.doc);
    this.stopCardFollow();
    if (this.reconcileRaf !== null) this.win.cancelAnimationFrame(this.reconcileRaf);
    if (this.highlightRaf !== null) this.win.cancelAnimationFrame(this.highlightRaf);
    if (this.patrolTimer !== null) this.win.clearInterval(this.patrolTimer);
    if (this.hoverTimer !== null) this.win.clearTimeout(this.hoverTimer);
    this.reconcileRaf = null;
    this.highlightRaf = null;
    this.patrolTimer = null;
    this.hoverTimer = null;

    this.observer.disconnect();
    this.setAddMode(false);
    this.win.removeEventListener("resize", this.onResize);
    this.removeAllPins();
    this.withSelfWrite(() => this.cardLayerHost?.remove());
    this.cardLayerHost = null;
    this.cardShadow = null;
  }

  // ---------------------------------------------------------------- 对外操作

  setAddMode(on: boolean): void {
    if (on === this.addMode) return;
    this.addMode = on;
    if (this.mask) this.mask.style.display = on ? "block" : "none";

    if (on) {
      this.doc.addEventListener("click", this.onDocClickCapture, true);
      this.doc.addEventListener("mousedown", this.onDocMouseDownCapture, true);
      this.doc.addEventListener("mousemove", this.onDocMouseMoveCapture, true);
      return;
    }

    this.doc.removeEventListener("click", this.onDocClickCapture, true);
    this.doc.removeEventListener("mousedown", this.onDocMouseDownCapture, true);
    this.doc.removeEventListener("mousemove", this.onDocMouseMoveCapture, true);
    this.cancelDraft();
    this.hideHighlight();
  }

  hasDraft(): boolean {
    return this.draft !== null;
  }

  /** 浮窗层绑定的是否就是当前这个文档。iframe 换文档后必须重建 */
  isBoundTo(doc: Document | null): boolean {
    return doc !== null && this.doc === doc;
  }

  cancelDraft(): boolean {
    const draft = this.draft;
    if (!draft) return false;

    this.draft = null;
    this.hideCard();
    this.releasePositioned(draft.record.anchorEl);
    this.withSelfWrite(() => draft.record.host.remove());
    this.opts.onDraftChange?.(false);
    return true;
  }

  /** 侧栏点击某条批注：滚动定位并展开卡片 */
  focusComment(comment: Comment): boolean {
    const anchor = this.resolveForComment(comment);
    if (!anchor) return false;

    if (anchor.kind === "container") {
      const rect = anchor.el.getBoundingClientRect();
      const offsetY = ((comment.target?.containerOffsetYPercent ?? 50) / 100) * rect.height;
      const top = this.win.scrollY + rect.top + offsetY - this.win.innerHeight / 2;
      this.win.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    } else {
      this.scrollIntoViewCentered(anchor.el);
    }

    this.reconcile();
    return true;
  }

  /**
   * 居中到目标元素。
   * smooth 的 scrollTo / scrollIntoView 在 iframe 内会被静默忽略或被打断（实测同一调用时灵时不灵），
   * 因此这里用瞬时 scrollIntoView 保证定位一定生效，同时也覆盖内层滚动容器。
   */
  private scrollIntoViewCentered(el: HTMLElement): void {
    el.scrollIntoView({ block: "center", inline: "center" });
  }

  reconcile(): void {
    if (this.disposed || this.reconcileRaf !== null) return;
    this.reconcileRaf = this.win.requestAnimationFrame(() => {
      this.reconcileRaf = null;
      if (this.disposed) return;
      try {
        this.syncPins();
      } catch (err) {
        console.warn("[CommentPinLayer] reconcile 失败", err);
      }
    });
  }

  /** 诊断入口：回答「这条批注为什么没渲染」 */
  debugSnapshot(): unknown {
    const byId = new Map(this.opts.getComments().map((c) => [c.id, c]));
    return {
      addMode: this.addMode,
      hasDraft: this.draft !== null,
      pins: [...this.pins.entries()].map(([id, record]) => ({
        commentId: id,
        anchorKind: record.kind,
        anchorTag: record.anchorEl.tagName,
        anchorConnected: this.doc.contains(record.anchorEl),
        selector: byId.get(id)?.target?.selector ?? null,
        viewContainer: containerSelectorOf(byId.get(id)?.target),
        rect: record.host.getBoundingClientRect().toJSON()
      })),
      unresolved: this.opts
        .getComments()
        .filter((c) => this.fileOf(c.pagePath) === this.fileOf(this.opts.getCurrentPath()))
        .filter((c) => !this.pins.has(c.id) && c.id !== this.cardOwnerId)
        .map((c) => ({
          commentId: c.id,
          selector: c.target?.selector ?? null,
          viewContainer: containerSelectorOf(c.target),
          reason: c.target ? "锚点非唯一或不可渲染" : "无 target"
        }))
    };
  }

  // ---------------------------------------------------------------- 同步

  private syncPins(): void {
    if (!this.doc.body) return;

    if (!this.opts.isPinsVisible()) {
      this.removeAllPins();
      this.hideCard();
      return;
    }

    const order = this.commentOrder();
    const activeId = this.opts.getActiveCommentId();
    const currentFile = this.fileOf(this.opts.getCurrentPath());

    const desired = new Map<string, AnchorEntry>();
    for (const comment of this.opts.getComments()) {
      if (this.fileOf(comment.pagePath) !== currentFile) continue;
      const anchor = this.resolveForComment(comment);
      if (anchor) desired.set(comment.id, { comment, el: anchor.el, kind: anchor.kind });
    }

    for (const [id, record] of [...this.pins]) {
      if (!desired.has(id) || !this.doc.contains(record.anchorEl)) this.removePin(id);
    }

    // 同一锚点上的多个 Pin 做轻微错位，避免完全重叠
    const stacking = new Map<HTMLElement, number>();
    for (const [id, entry] of desired) {
      const index = stacking.get(entry.el) ?? 0;
      stacking.set(entry.el, index + 1);
      this.upsertPin(id, entry, index, order.get(id) ?? 1, activeId === id);
    }

    this.syncCard(desired, activeId);
  }

  private resolveForComment(comment: Comment): { el: HTMLElement; kind: "element" | "container" } | null {
    return resolveAnchor(this.doc, comment.target);
  }

  private upsertPin(
    id: string,
    entry: AnchorEntry,
    stackIndex: number,
    pinNumber: number,
    isActive: boolean
  ): void {
    const [left, top] = this.computeOffsets(entry.comment.target, entry.el, entry.kind);
    const existing = this.pins.get(id);

    if (existing && existing.anchorEl === entry.el) {
      existing.kind = entry.kind;
      this.applyHostBox(existing.host, left, top, stackIndex);
      this.paintDot(existing.dot, entry.comment, pinNumber, isActive);
      return;
    }
    if (existing) this.removePin(id);

    const host = this.doc.createElement("wb-pin");
    host.setAttribute("data-wb-pin", "1");
    host.setAttribute("data-wb-comment", id);
    host.style.cssText = PIN_HOST_STYLE;
    this.applyHostBox(host, left, top, stackIndex);

    const shadow = host.attachShadow({ mode: "open" });
    this.installSheet(shadow);

    const dot = this.doc.createElement("button");
    dot.type = "button";
    dot.className = "dot";
    this.wireDot(shadow, dot, id);
    shadow.appendChild(dot);

    this.ensurePositioned(entry.el);
    this.withSelfWrite(() => entry.el.appendChild(host));

    this.pins.set(id, { host, dot, anchorEl: entry.el, kind: entry.kind });
    this.paintDot(dot, entry.comment, pinNumber, isActive);
  }

  private removePin(id: string): void {
    const record = this.pins.get(id);
    if (!record) return;

    this.pins.delete(id);
    if (this.hoveredId === id) this.hoveredId = null;
    if (this.cardOwnerId === id) this.hideCard();
    this.releasePositioned(record.anchorEl);
    this.withSelfWrite(() => record.host.remove());
  }

  private removeAllPins(): void {
    for (const id of [...this.pins.keys()]) this.removePin(id);
  }

  private computeOffsets(
    target: CommentTargetInfo | undefined,
    anchorEl: HTMLElement,
    kind: "element" | "container"
  ): [number, number] {
    const rawX = kind === "element" ? target?.elementOffsetXPercent : target?.containerOffsetXPercent;
    const rawY = kind === "element" ? target?.elementOffsetYPercent : target?.containerOffsetYPercent;

    const width = anchorEl.clientWidth;
    const height = anchorEl.clientHeight;
    const half = DOT_SIZE / 2;
    const limitX = width > DOT_SIZE ? (half / width) * 100 : 50;
    const limitY = height > DOT_SIZE ? (half / height) * 100 : 50;

    const x = rawX ?? 50;
    const y = rawY ?? 50;
    return [
      Math.min(Math.max(x, limitX), 100 - limitX),
      Math.min(Math.max(y, limitY), 100 - limitY)
    ];
  }

  private applyHostBox(host: HTMLElement, left: number, top: number, stackIndex: number): void {
    host.style.left = `${left}%`;
    host.style.top = `${top}%`;
    host.style.transform = stackIndex ? `translate(${stackIndex * 6}px, ${stackIndex * 6}px)` : "";
  }

  private paintDot(dot: HTMLElement, comment: Comment, pinNumber: number, isActive: boolean): void {
    const resolved = comment.status === "resolved";
    const classes = ["dot"];
    if (resolved) classes.push("is-resolved");
    if (isActive) classes.push("is-active");
    dot.className = classes.join(" ");
    dot.setAttribute("aria-label", `批注 #${pinNumber}`);

    dot.textContent = "";
    if (resolved) dot.appendChild(buildCheckIcon(this.doc));
    else dot.textContent = String(pinNumber);
  }

  private wireDot(shadow: ShadowRoot, dot: HTMLElement, id: string): void {
    for (const type of BLOCKED_EVENTS) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
    shadow.addEventListener("contextmenu", (event) => event.preventDefault());

    dot.addEventListener("click", (event) => {
      event.preventDefault();
      this.opts.onSelectComment(this.opts.getActiveCommentId() === id ? null : id);
    });
    dot.addEventListener("mouseenter", () => this.setHovered(id));
    dot.addEventListener("mouseleave", () => this.clearHovered(id));
  }

  private commentOrder(): Map<string, number> {
    const order = new Map<string, number>();
    [...this.opts.getComments()]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .forEach((comment, index) => order.set(comment.id, index + 1));
    return order;
  }

  private fileOf(path?: string): string {
    return (path || "index.html").replace(/^\//, "").split("#")[0];
  }

  // ---------------------------------------------------------------- position 补写与回滚

  private ensurePositioned(el: HTMLElement): void {
    const backup = this.posBackup.get(el);
    if (backup) {
      backup.refs += 1;
      return;
    }

    const alreadyPositioned = this.win.getComputedStyle(el).position !== "static";
    this.posBackup.set(el, { refs: 1, changed: !alreadyPositioned, prev: el.style.position });
    if (alreadyPositioned) return;

    // 只写 position。写 z-index 会新建层叠上下文，改变原型自身的绘制顺序
    this.withSelfWrite(() => {
      el.style.position = "relative";
      el.setAttribute("data-wb-anchor", "1");
    });
  }

  private releasePositioned(el: HTMLElement): void {
    const backup = this.posBackup.get(el);
    if (!backup) return;

    backup.refs -= 1;
    if (backup.refs > 0) return;

    this.posBackup.delete(el);
    if (!backup.changed) return;

    this.withSelfWrite(() => {
      el.style.position = backup.prev;
      el.removeAttribute("data-wb-anchor");
    });
  }

  // ---------------------------------------------------------------- Observer

  private withSelfWrite<T>(fn: () => T): T {
    this.selfWriteDepth += 1;
    this.observer.disconnect();
    try {
      return fn();
    } finally {
      this.selfWriteDepth -= 1;
      if (this.selfWriteDepth === 0) {
        // 丢弃自身写入产生的记录，这是不成环的决定性保证
        this.observer.takeRecords();
        this.observe();
      }
    }
  }

  private observe(): void {
    if (!this.doc.body) return;
    this.observer.observe(this.doc.body, {
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
      subtree: true,
      childList: true
    });
  }

  private onMutations(records: MutationRecord[]): void {
    if (this.selfWriteDepth > 0) return;
    for (const record of records) {
      if (!this.isOwnRecord(record)) {
        // 原型动了 DOM，容器内容指纹可能已变，作废缓存让本轮重算
        invalidateContainerSignatures();
        this.reconcile();
        return;
      }
    }
  }

  private isOwnRecord(record: MutationRecord): boolean {
    const target = record.target as Element;
    // 自己的属性写入都在 withSelfWrite 内完成（observer 已断开且丢弃记录），产生不了记录。
    // 因此只认我们自己创建的元素，绝不按 data-wb-anchor 判定：锚点元素身上的 class/style/hidden
    // 变更是原型自己做的（如切页把容器置为 display:none），误吞会导致陈旧 Pin 残留到巡检才消失。
    if (target.nodeType === 1 && target.tagName?.startsWith("WB-")) return true;
    if (record.type === "childList") {
      const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].filter(
        (node) => node.nodeType === 1
      ) as Element[];
      if (nodes.length > 0 && nodes.every((node) => node.tagName.startsWith("WB-"))) return true;
    }
    return false;
  }

  private onResize = (): void => {
    this.reconcile();
  };

  // ---------------------------------------------------------------- 批注模式

  private onDocClickCapture = (event: MouseEvent): void => {
    if (this.isLayerPath(event.composedPath())) return;
    // 捕获阶段阻断，原型元素的内联 onclick 不会执行
    event.preventDefault();
    event.stopPropagation();
    this.beginDraft(event.clientX, event.clientY, (event.target as HTMLElement) ?? this.doc.body);
  };

  private onDocMouseDownCapture = (event: MouseEvent): void => {
    if (this.isLayerPath(event.composedPath())) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private onDocMouseMoveCapture = (event: MouseEvent): void => {
    if (!this.addMode || this.draft) return;
    this.highlightAnchor((event.target as HTMLElement) ?? this.doc.body, event.clientX, event.clientY);
  };

  private isLayerPath(path: EventTarget[]): boolean {
    return path.some((node) => {
      const tag = (node as Element)?.tagName;
      return typeof tag === "string" && tag.startsWith("WB-");
    });
  }

  private beginDraft(clientX: number, clientY: number, rawTarget: HTMLElement): void {
    this.cancelDraft();

    let target: CommentTargetInfo;
    try {
      target = buildAnchorDescriptor(
        normalizeTableTarget(rawTarget, clientX),
        this.doc,
        clientX,
        clientY
      );
    } catch (err) {
      console.warn("[CommentPinLayer] 锚点计算失败", err);
      return;
    }

    const anchor = resolveAnchor(this.doc, target);
    if (!anchor) return;

    const [left, top] = this.computeOffsets(target, anchor.el, anchor.kind);

    const host = this.doc.createElement("wb-pin");
    host.setAttribute("data-wb-pin", "1");
    host.setAttribute("data-wb-draft", "1");
    host.style.cssText = PIN_HOST_STYLE;
    this.applyHostBox(host, left, top, 0);

    const shadow = host.attachShadow({ mode: "open" });
    this.installSheet(shadow);

    const dot = this.doc.createElement("button");
    dot.type = "button";
    dot.className = "dot is-draft";
    dot.textContent = String(this.opts.getComments().length + 1);
    for (const type of BLOCKED_EVENTS) {
      shadow.addEventListener(type, (event) => event.stopPropagation());
    }
    shadow.appendChild(dot);

    this.ensurePositioned(anchor.el);
    this.withSelfWrite(() => anchor.el.appendChild(host));

    const record: PinRecord = { host, dot, anchorEl: anchor.el, kind: anchor.kind };
    const view = this.renderDraftCard(target, host);
    this.draft = { target, record, view };
    this.opts.onDraftChange?.(true);
    view.focus();
  }

  private renderDraftCard(target: CommentTargetInfo, pinHost: HTMLElement): DraftCardView {
    this.ensureCardLayer();
    if (!this.cardShadow) throw new Error("卡片层未就绪");

    this.clearCardRoot();

    const label =
      target.anchorKind === "container"
        ? "页面空白处"
        : `${target.tagName ?? ""}${target.innerTextSnippet ? ` · ${target.innerTextSnippet}` : ""}`;

    const view = buildDraftCard(this.doc, this.opts.getComments().length + 1, label || null, {
      onCancel: () => this.cancelDraft(),
      onSubmit: (content, includeSnapshot) => void this.submitDraft(content, includeSnapshot)
    });
    for (const type of BLOCKED_EVENTS) {
      view.root.addEventListener(type, (event) => event.stopPropagation());
    }

    this.mountCard(view.root);
    this.cardOwnerEl = pinHost;
    this.cardOwnerId = DRAFT_ID;
    this.startCardFollow();
    // 先落位再让调用方聚焦：否则焦点落在尚未定位的卡片上，浏览器会把文档滚到顶部
    this.placeCard();
    return view;
  }

  private async submitDraft(content: string, includeSnapshot: boolean): Promise<void> {
    const draft = this.draft;
    if (!draft || this.submitting) return;

    this.submitting = true;
    draft.view.setSubmitting(true);
    try {
      // 截图是同步重活，先让浏览器把 loading 状态画出来再开始，否则按钮会一直停在原样
      await this.nextPaint();
      const snapshot = includeSnapshot ? await this.captureDraftSnapshot(draft) : null;
      await this.opts.onSubmitDraft({
        pagePath: this.opts.getCurrentPath(),
        target: draft.target,
        content,
        snapshot
      });
      this.cancelDraft();
    } catch (err) {
      console.warn("[CommentPinLayer] 发表批注失败", err);
      draft.view.setSubmitting(false);
    } finally {
      this.submitting = false;
    }
  }

  // 双重 rAF：第一帧提交样式，第二帧回调时第一帧已经画完
  private nextPaint(): Promise<void> {
    return new Promise((resolve) => {
      this.win.requestAnimationFrame(() => {
        this.win.requestAnimationFrame(() => resolve());
      });
    });
  }

  // 快照要带上批注点，先在视口坐标里算出 Pin 中心的实际位置，再交给截图工具
  private async captureDraftSnapshot(draft: DraftState): Promise<CapturedSnapshot | null> {
    const el = draft.record.anchorEl;
    if (!this.doc.contains(el)) return null;

    const rect = el.getBoundingClientRect();
    const [xPercent, yPercent] = this.computeOffsets(draft.target, el, draft.record.kind);
    const marker = {
      x: rect.left + (xPercent / 100) * el.clientWidth,
      y: rect.top + (yPercent / 100) * el.clientHeight
    };
    return captureViewportSnapshot(this.win, this.doc, marker);
  }

  private highlightAnchor(rawTarget: HTMLElement, clientX: number, clientY: number): void {
    this.hoverPoint = { raw: rawTarget, clientX, clientY };
    if (this.highlightRaf !== null) return;

    this.highlightRaf = this.win.requestAnimationFrame(() => {
      this.highlightRaf = null;
      const point = this.hoverPoint;
      this.hoverPoint = null;
      if (!point || !this.highlight || !this.cardLayerHost) return;

      try {
        const anchor = findAnchorElement(normalizeTableTarget(point.raw, point.clientX), this.doc);
        const rect = anchor.el.getBoundingClientRect();
        const layerRect = this.cardLayerHost.getBoundingClientRect();
        this.highlight.style.display = "block";
        this.highlight.style.transform = `translate3d(${Math.round(rect.left - layerRect.left)}px, ${Math.round(
          rect.top - layerRect.top
        )}px, 0)`;
        this.highlight.style.width = `${Math.round(rect.width)}px`;
        this.highlight.style.height = `${Math.round(rect.height)}px`;
      } catch {
        this.hideHighlight();
      }
    });
  }

  private hideHighlight(): void {
    if (this.highlight) this.highlight.style.display = "none";
  }

  // ---------------------------------------------------------------- 卡片层

  private ensureCardLayer(): void {
    if (this.cardLayerHost && this.doc.contains(this.cardLayerHost)) return;
    if (!this.doc.body) return;

    const host = this.doc.createElement("wb-card-layer");
    host.setAttribute("data-wb-pin", "1");
    host.style.cssText = CARD_LAYER_STYLE;

    const shadow = host.attachShadow({ mode: "open" });
    this.installSheet(shadow);

    // 蒙板先入树：靠 DOM 顺序压在原型内容之上，又在选中框与卡片之下
    const mask = this.doc.createElement("div");
    mask.className = "mask";
    mask.style.display = this.addMode ? "block" : "none";
    shadow.appendChild(mask);

    const highlight = this.doc.createElement("div");
    highlight.className = "hl";
    shadow.appendChild(highlight);

    this.withSelfWrite(() => this.doc.body.appendChild(host));

    this.cardLayerHost = host;
    this.cardShadow = shadow;
    this.highlight = highlight;
    this.mask = mask;
  }

  private syncCard(desired: Map<string, AnchorEntry>, activeId: string | null): void {
    if (this.draft) return;

    const targetId = activeId ?? this.hoveredId;
    if (!targetId) {
      this.hideCard();
      return;
    }

    const entry = desired.get(targetId);
    const record = this.pins.get(targetId);
    if (!entry || !record) {
      this.hideCard();
      return;
    }

    const signature = this.signatureOf(entry.comment);
    if (this.cardOwnerId === targetId && this.cardSignature === signature && this.cardRoot) {
      this.cardOwnerEl = record.host;
      return;
    }
    this.renderCommentCard(entry.comment, targetId, record.host, signature);
  }

  private renderCommentCard(
    comment: Comment,
    commentId: string,
    pinHost: HTMLElement,
    signature: string
  ): void {
    this.ensureCardLayer();
    if (!this.cardShadow) return;

    this.clearCardRoot();

    const pinNumber = this.commentOrder().get(comment.id) ?? 1;
    const avatar = PRESET_AVATARS.find((a) => a.id === comment.author.avatar) ?? PRESET_AVATARS[0];
    const card = buildCommentCard(this.doc, comment, pinNumber, avatar.emoji, () =>
      this.opts.onSelectComment(null)
    );

    for (const type of BLOCKED_EVENTS) {
      card.addEventListener(type, (event) => event.stopPropagation());
    }
    card.addEventListener("mouseenter", () => this.setHovered(commentId));
    card.addEventListener("mouseleave", () => this.clearHovered(commentId));

    this.mountCard(card);
    this.cardOwnerEl = pinHost;
    this.cardOwnerId = commentId;
    this.cardSignature = signature;
    // 先落位再起跟随：否则首帧停在卡片层原点，会被看成从左上角闪到批注点
    this.placeCard();
    this.startCardFollow();
  }

  /**
   * 卡片分两层挂载：外层 slot 由跟随循环独占 translate3d 定位，内层卡片独占
   * transform 做入场缩放，两者合在一个元素上会互相覆盖。
   */
  private mountCard(card: HTMLElement): void {
    const slot = this.doc.createElement("div");
    slot.className = "card-slot";
    slot.appendChild(card);
    this.cardShadow?.appendChild(slot);
    this.cardSlot = slot;
    this.cardRoot = card;
  }

  private clearCardRoot(): void {
    this.stopCardFollow();
    this.cardSlot?.remove();
    this.cardSlot = null;
    this.cardRoot = null;
    this.cardOwnerId = null;
    this.cardOwnerEl = null;
    this.cardSignature = null;
  }

  private hideCard(): void {
    this.clearCardRoot();
  }

  private signatureOf(comment: Comment): string {
    return [comment.updatedAt, comment.status, comment.content, comment.replies.length].join("|");
  }

  private startCardFollow(): void {
    if (this.cardRaf !== null) return;
    const loop = () => {
      this.placeCard();
      this.cardRaf = this.win.requestAnimationFrame(loop);
    };
    this.cardRaf = this.win.requestAnimationFrame(loop);
  }

  private stopCardFollow(): void {
    if (this.cardRaf === null) return;
    this.win.cancelAnimationFrame(this.cardRaf);
    this.cardRaf = null;
  }

  /**
   * 卡片逐帧跟随 Pin。只有卡片打开时才跑，关闭即停。
   * 卡片位置不准也不会影响 Pin 本身的正确性——Pin 由布局引擎保证。
   */
  private placeCard(): void {
    const card = this.cardRoot;
    const slot = this.cardSlot;
    const pin = this.cardOwnerEl;
    const layer = this.cardLayerHost;
    if (!card || !slot || !pin || !layer) return;

    const pinRect = pin.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const cardWidth = card.offsetWidth || CARD_FALLBACK_WIDTH;
    const cardHeight = card.offsetHeight;
    const viewWidth = this.win.innerWidth;
    const viewHeight = this.win.innerHeight;

    const above = pinRect.top - cardHeight - CARD_GAP >= VIEWPORT_PADDING;
    const viewY = above ? pinRect.top - cardHeight - CARD_GAP : pinRect.bottom + CARD_GAP;

    let viewX = pinRect.left - cardWidth / 2;
    const maxX = Math.max(VIEWPORT_PADDING, viewWidth - cardWidth - VIEWPORT_PADDING);
    viewX = Math.min(Math.max(viewX, VIEWPORT_PADDING), maxX);

    slot.style.transform = `translate3d(${Math.round(viewX - layerRect.left)}px, ${Math.round(
      viewY - layerRect.top
    )}px, 0)`;
    card.style.maxHeight = `${Math.max(120, viewHeight - VIEWPORT_PADDING * 2)}px`;

    // 缩放原点取卡片离批注点最近的那条边，入场才有从批注点里长出来的观感
    const originX = ((pinRect.left + pinRect.width / 2 - viewX) / cardWidth) * 100;
    card.style.transformOrigin = `${Math.min(100, Math.max(0, originX))}% ${above ? 100 : 0}%`;
  }

  // ---------------------------------------------------------------- hover

  private setHovered(id: string): void {
    if (this.hoverTimer !== null) {
      this.win.clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.reconcile();
  }

  private clearHovered(id: string): void {
    if (this.hoveredId !== id) return;
    if (this.hoverTimer !== null) this.win.clearTimeout(this.hoverTimer);
    this.hoverTimer = this.win.setTimeout(() => {
      this.hoverTimer = null;
      if (this.hoveredId !== id) return;
      this.hoveredId = null;
      this.reconcile();
    }, HOVER_HIDE_DELAY);
  }
}
