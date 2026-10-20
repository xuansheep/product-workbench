import html2canvas from "html2canvas";

export interface CapturedSnapshot {
  image: Blob;
  viewportWidth: number;
  viewportHeight: number;
  markerXPercent: number;
  markerYPercent: number;
}

// 截图缩放上限：1.5 倍足够看清原型文字，又不至于让每条批注都存下几 MB 的图
const MAX_SCALE = 1.5;
const JPEG_QUALITY = 0.85;
// foreignObject 渲染的是整页，超高/超大的页面先降级，避免生成超大画布
const MAX_FOREIGN_OBJECT_SIDE = 8000;
const MAX_FOREIGN_OBJECT_AREA = 12_000_000;

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

const SHIFT_ATTR = "data-wb-snapshot-shift";

interface ShiftTarget {
  el: HTMLElement;
  left: number; // 批注时的文档坐标
  top: number;
}

/**
 * 固定/粘性元素不随文档滚动，整页渲染时会留在页面顶部，按滚动位置裁剪后就消失了。
 * 这里记下它们此刻在文档里的位置，克隆后把它们平移到同一处，裁剪结果才与用户所见一致。
 */
function collectShiftTargets(doc: Document, scrollX: number, scrollY: number): ShiftTarget[] {
  const win = doc.defaultView;
  if (!win || !doc.body) return [];

  const targets: ShiftTarget[] = [];
  const roots: HTMLElement[] = [];
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (el.tagName.startsWith("WB-")) continue;
    // 已落在被平移的容器里，会跟着容器一起移动，不能重复平移
    if (roots.some((root) => root.contains(el))) continue;

    const style = win.getComputedStyle(el);
    if (style.position !== "fixed" && style.position !== "sticky") continue;
    if (style.display === "none" || style.visibility === "hidden") continue;

    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    roots.push(el);
    targets.push({ el, left: rect.left + scrollX, top: rect.top + scrollY });
  }

  targets.forEach((target, index) => target.el.setAttribute(SHIFT_ATTR, String(index)));
  return targets;
}

function clearShiftTargets(targets: ShiftTarget[]): void {
  for (const target of targets) target.el.removeAttribute(SHIFT_ATTR);
}

function realignShiftTargets(cloneDoc: Document, targets: ShiftTarget[]): void {
  for (const cloneEl of Array.from(cloneDoc.querySelectorAll<HTMLElement>(`[${SHIFT_ATTR}]`))) {
    const target = targets[Number(cloneEl.getAttribute(SHIFT_ATTR))];
    if (!target) continue;
    const rect = cloneEl.getBoundingClientRect();
    const dx = Math.round(target.left - rect.left);
    const dy = Math.round(target.top - rect.top);
    // 用独立的 translate 属性，不覆盖原型自己的 transform
    if (dx || dy) cloneEl.style.setProperty("translate", `${dx}px ${dy}px`);
  }
}

function cropRegion(
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  width: number,
  height: number,
  scale: number
): HTMLCanvasElement {
  const output = document.createElement("canvas");
  output.width = Math.round(width * scale);
  output.height = Math.round(height * scale);
  const ctx = output.getContext("2d");
  if (!ctx) return source;
  // JPEG 没有透明通道，先铺白底，避免页面边缘的透明区域变成黑色
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(
    source,
    Math.round(sx * scale),
    Math.round(sy * scale),
    output.width,
    output.height,
    0,
    0,
    output.width,
    output.height
  );
  return output;
}

/**
 * 截取 iframe 当前视口。marker 是视口坐标系里的批注点（CSS px），
 * 归一化成百分比后随元数据一起保存，弹窗里据此还原 Pin 的位置。
 * 快照只是辅助证据，失败时返回 null，不能影响批注落库。
 */
export async function captureViewportSnapshot(
  win: Window,
  doc: Document,
  marker: { x: number; y: number }
): Promise<CapturedSnapshot | null> {
  try {
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;
    if (!doc.body || !viewportWidth || !viewportHeight) return null;

    const scrollX = win.scrollX;
    const scrollY = win.scrollY;
    const scale = Math.min(MAX_SCALE, Math.max(1, win.devicePixelRatio || 1));
    const pageWidth = Math.max(doc.documentElement.scrollWidth, doc.documentElement.clientWidth);
    const pageHeight = Math.max(doc.documentElement.scrollHeight, doc.documentElement.clientHeight);
    const options = {
      windowWidth: viewportWidth,
      windowHeight: viewportHeight,
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      // 批注浮窗是工作台注入的，截图里只要原型本身
      ignoreElements: (el: Element) => el.tagName.startsWith("WB-")
    };

    let canvas: HTMLCanvasElement;
    if (
      pageWidth <= MAX_FOREIGN_OBJECT_SIDE &&
      pageHeight <= MAX_FOREIGN_OBJECT_SIDE &&
      pageWidth * pageHeight <= MAX_FOREIGN_OBJECT_AREA
    ) {
      // foreignObject 渲染器不支持 x/y 裁剪（会把平移量叠加两次），所以先整页渲染再自己裁视口。
      // 好处是让浏览器原生渲染，内联 SVG 图表、渐变不会因为重绘实现而失真
      const shiftTargets = collectShiftTargets(doc, scrollX, scrollY);
      try {
        const page = await html2canvas(doc.body, {
          ...options,
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight,
          scrollX: 0,
          scrollY: 0,
          foreignObjectRendering: true,
          onclone: (cloneDoc) => realignShiftTargets(cloneDoc, shiftTargets)
        });
        canvas = cropRegion(page, scrollX, scrollY, viewportWidth, viewportHeight, scale);
      } finally {
        clearShiftTargets(shiftTargets);
      }
    } else {
      // 超大页面用逐元素重绘模式，它支持直接裁剪视口
      canvas = await html2canvas(doc.body, {
        ...options,
        x: scrollX,
        y: scrollY,
        width: viewportWidth,
        height: viewportHeight,
        foreignObjectRendering: false
      });
    }

    const image = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
    });
    if (!image) return null;

    return {
      image,
      viewportWidth,
      viewportHeight,
      markerXPercent: clampPercent((marker.x / viewportWidth) * 100),
      markerYPercent: clampPercent((marker.y / viewportHeight) * 100)
    };
  } catch (err) {
    console.warn("[CommentPinLayer] 页面快照生成失败", err);
    return null;
  }
}
