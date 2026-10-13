/**
 * 注入到 iframe 内的批注浮窗样式。
 *
 * 全部为固定值、不依赖 Tailwind：宿主文档的 utility class 无法穿透 Shadow 边界，
 * 而把宿主 Tailwind 产物整体复制进来会带上 Preflight，冲垮原型排版。
 */
export const LAYER_CSS = `
:host { all: initial; }

* { box-sizing: border-box; margin: 0; padding: 0; }

.dot {
  position: absolute;
  left: 0; top: 0;
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px;
  transform: translate(-50%, -50%);
  border: 1.5px solid #fff;
  border-radius: 9999px;
  background: #4f46e5;
  color: #fff;
  font: 700 11px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.12s ease, background-color 0.12s ease;
}
.dot:hover { transform: translate(-50%, -50%) scale(1.15); background: #4338ca; }
.dot.is-active {
  width: 24px; height: 24px;
  font-size: 12px;
  background: #4f46e5;
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px #4f46e5;
}
.dot.is-resolved { background: #94a3b8; }
.dot.is-resolved:hover { background: #64748b; }
.dot svg { width: 12px; height: 12px; }

.dot.is-draft {
  background: #4f46e5;
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px #a5b4fc;
  animation: wb-pulse 1.4s ease-in-out infinite;
}
@keyframes wb-pulse {
  0%, 100% { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #a5b4fc; }
  50% { box-shadow: 0 0 0 2px #fff, 0 0 0 7px rgba(165, 180, 252, 0.35); }
}

/* 外层只承担逐帧跟随定位，入场缩放交给内层 .card，两者不抢同一个 transform */
.card-slot {
  position: absolute;
  left: 0; top: 0;
}

.card {
  position: absolute;
  left: 0; top: 0;
  width: 256px;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.18), 0 8px 10px -6px rgba(15, 23, 42, 0.12);
  color: #1e293b;
  font: 400 12px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  pointer-events: auto;
  /* 每帧由 placeCard 覆写成朝向批注点的边，这里的默认值只在极端尺寸下兜底 */
  transform-origin: 50% 100%;
  animation: wb-card-pop 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes wb-card-pop {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}
.card.is-draft { width: 288px; padding: 16px; }

.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card-who { display: flex; align-items: center; gap: 8px; min-width: 0; }
.avatar {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px;
  border-radius: 9999px;
  font-size: 10px;
  color: #fff;
  flex: none;
}
.name { font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { font-size: 10px; color: #94a3b8; flex: none; }

.icon-btn {
  display: flex; align-items: center; justify-content: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  flex: none;
}
.icon-btn:hover { background: #f1f5f9; color: #475569; }
.icon-btn svg { width: 14px; height: 14px; }

.anchor {
  display: flex; align-items: center; gap: 6px;
  margin-top: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f1f5f9;
  font-size: 10px;
  color: #475569;
  overflow: hidden;
}
.anchor .tag { font-weight: 700; text-transform: uppercase; flex: none; }
.anchor .text { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.anchor svg { width: 10px; height: 10px; color: #6366f1; flex: none; }

.body { margin-top: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }

.replies {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 8px; padding-top: 6px;
  border-top: 1px solid #f1f5f9;
  font-size: 10px;
  color: #4f46e5;
  font-weight: 500;
}

.draft-title { font-weight: 700; color: #1e293b; }

textarea {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  background: #fff;
  color: #0f172a;
  font: 500 12px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  resize: none;
  outline: none;
}
textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15); }
textarea::placeholder { color: #94a3b8; }

.draft-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.hint { font-size: 10px; color: #94a3b8; }
.submit {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: #4f46e5;
  color: #fff;
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  cursor: pointer;
}
.submit:hover { background: #4338ca; }
.submit:disabled { opacity: 0.5; cursor: default; }
.submit svg { width: 12px; height: 12px; }

/* 批注模式的整页蒙板。fixed 定位只覆盖视口内容区，不需要跟随文档尺寸计算 */
.mask {
  position: fixed;
  left: 0; top: 0; right: 0; bottom: 0;
  display: none;
  background: rgba(99, 102, 241, 0.05);
  pointer-events: none;
}

.hl {
  position: absolute;
  left: 0; top: 0;
  display: none;
  border: 2px dashed #6366f1;
  border-radius: 6px;
  pointer-events: none;
}
`;

/**
 * 在 iframe 的 realm 里构造一份共享 CSSStyleSheet，供所有 ShadowRoot 复用。
 * 跨 realm adopt 在部分浏览器会抛异常，因此必须用 iframeWin.CSSStyleSheet。
 */
export function makeSheetInstaller(doc: Document): (shadow: ShadowRoot) => void {
  const win = doc.defaultView as (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null;
  try {
    const Construct = win?.CSSStyleSheet;
    if (!Construct) throw new Error("CSSStyleSheet 不可用");
    const sheet = new Construct();
    sheet.replaceSync(LAYER_CSS);
    return (shadow: ShadowRoot) => {
      shadow.adoptedStyleSheets = [sheet];
    };
  } catch {
    return (shadow: ShadowRoot) => {
      const style = doc.createElement("style");
      style.textContent = LAYER_CSS;
      shadow.appendChild(style);
    };
  }
}
