import { type Comment } from "../types/index.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
  close: ["M18 6 6 18", "m6 6 12 12"],
  pin: ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"],
  send: ["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"],
  reply: ["m15 10 5 5-5 5", "M4 4v7a4 4 0 0 0 4 4h12"],
  check: ["M20 6 9 17l-5-5"]
} as const;

function icon(doc: Document, paths: readonly string[]): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Pin 进入「已解决」态时替换数字的勾选标记
export function buildCheckIcon(doc: Document): SVGSVGElement {
  return icon(doc, ICONS.check);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function anchorRow(doc: Document, label: string | null): HTMLElement | null {
  if (!label) return null;
  const row = el(doc, "div", "anchor");
  row.appendChild(icon(doc, ICONS.pin));
  row.appendChild(el(doc, "span", "tag", label));
  return row;
}

export function buildCommentCard(
  doc: Document,
  comment: Comment,
  pinNumber: number,
  avatarEmoji: string,
  onClose: () => void
): HTMLElement {
  const card = el(doc, "div", "card");

  const head = el(doc, "div", "card-head");
  const who = el(doc, "div", "card-who");
  who.appendChild(el(doc, "span", "avatar", avatarEmoji));
  who.appendChild(el(doc, "span", "name", comment.author.name));
  who.appendChild(el(doc, "span", "time", formatTime(comment.createdAt)));
  head.appendChild(who);

  const close = el(doc, "button", "icon-btn");
  close.type = "button";
  close.title = "收起浮窗";
  close.appendChild(icon(doc, ICONS.close));
  close.addEventListener("click", onClose);
  head.appendChild(close);
  card.appendChild(head);

  const label = comment.target?.tagName
    ? `${comment.target.tagName}${comment.target.innerTextSnippet ? ` · ${comment.target.innerTextSnippet}` : ""}`
    : null;
  const anchor = anchorRow(doc, comment.target?.anchorKind === "container" ? "页面空白处" : label);
  if (anchor) card.appendChild(anchor);

  card.appendChild(el(doc, "div", "body", comment.content));

  if (comment.replies.length > 0) {
    const replies = el(doc, "div", "replies");
    const left = el(doc, "span");
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "4px";
    const replyIcon = icon(doc, ICONS.reply);
    replyIcon.style.width = "12px";
    replyIcon.style.height = "12px";
    left.appendChild(replyIcon);
    left.appendChild(el(doc, "span", undefined, `${comment.replies.length} 条回复`));
    replies.appendChild(left);
    replies.appendChild(el(doc, "span", undefined, "在侧栏查看全部"));
    card.appendChild(replies);
  }

  card.setAttribute("aria-label", `批注 #${pinNumber}`);
  return card;
}

export interface DraftCardHandlers {
  onCancel: () => void;
  onSubmit: (content: string) => void;
}

export interface DraftCardView {
  root: HTMLElement;
  focus: () => void;
  setSubmitting: (submitting: boolean) => void;
}

export function buildDraftCard(
  doc: Document,
  pinNumber: number,
  anchorLabel: string | null,
  handlers: DraftCardHandlers
): DraftCardView {
  const card = el(doc, "div", "card is-draft");

  const head = el(doc, "div", "card-head");
  head.appendChild(el(doc, "span", "draft-title", `添加批注 #${pinNumber}`));
  const close = el(doc, "button", "icon-btn");
  close.type = "button";
  close.title = "取消";
  close.appendChild(icon(doc, ICONS.close));
  close.addEventListener("click", handlers.onCancel);
  head.appendChild(close);
  card.appendChild(head);

  const anchor = anchorRow(doc, anchorLabel);
  if (anchor) card.appendChild(anchor);

  const textarea = el(doc, "textarea");
  textarea.rows = 3;
  textarea.placeholder = "输入批注内容 (Enter 发表，Ctrl+Enter 换行)...";

  const submit = el(doc, "button", "submit");
  submit.type = "button";
  submit.appendChild(icon(doc, ICONS.send));
  submit.appendChild(el(doc, "span", undefined, "发表"));
  submit.disabled = true;

  const send = () => {
    const content = textarea.value.trim();
    if (content) handlers.onSubmit(content);
  };

  // 拦截一切按键，避免触发宿主或原型的快捷键；Enter 发表，Ctrl/Cmd+Enter 换行，Esc 取消
  textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      handlers.onCancel();
      return;
    }
    if (event.key !== "Enter" || (event as KeyboardEvent).isComposing) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`;
      textarea.selectionStart = textarea.selectionEnd = start + 1;
      return;
    }
    if (event.shiftKey) return;
    event.preventDefault();
    send();
  });
  textarea.addEventListener("input", () => {
    submit.disabled = !textarea.value.trim();
  });

  submit.addEventListener("click", send);

  const foot = el(doc, "div", "draft-foot");
  foot.appendChild(el(doc, "span", "hint", "Enter 发表 · Ctrl+Enter 换行 · Esc 取消"));
  foot.appendChild(submit);
  card.appendChild(textarea);
  card.appendChild(foot);

  return {
    root: card,
    focus: () => textarea.focus({ preventScroll: true }),
    setSubmitting: (submitting: boolean) => {
      submit.disabled = submitting || !textarea.value.trim();
      submit.querySelector("span")!.textContent = submitting ? "发表中..." : "发表";
    }
  };
}
