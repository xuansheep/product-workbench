import React from "react";
import { createPortal } from "react-dom";

/**
 * 全屏遮罩层，经 Portal 挂到 document.body 下渲染。
 *
 * 必须走 Portal 而不能内联渲染：弹窗若落在 space-y-* 容器的子元素位置，会被
 * `> * + * { margin-top }` 命中，而 margin 对 position:fixed 元素同样生效 ——
 * inset-0 的遮罩会被压成 calc(100vh - Npx) 并从顶部下移 Npx，
 * 屏幕最上方露出一条没被盖住的缝。挂到 body 后同时免疫祖先的 transform / overflow / 层叠上下文。
 */
export const ModalPortal: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = ""
}) =>
  createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 ${className}`}
    >
      {children}
    </div>,
    document.body
  );
