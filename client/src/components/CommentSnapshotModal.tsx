import React, { useEffect, useState } from "react";
import { Camera, ExternalLink, X } from "lucide-react";
import { type Comment } from "../types/index.js";
import { api } from "../services/api.js";
import { ModalPortal } from "./common/ModalPortal.js";

interface CommentSnapshotModalProps {
  comment: Comment;
  pinNumber: number;
  onClose: () => void;
}

/**
 * 批注创建时的页面快照。
 * Pin 位置来自入库时记录的视口百分比，和当前原型是否还能定位无关。
 */
export const CommentSnapshotModal: React.FC<CommentSnapshotModalProps> = ({
  comment,
  pinNumber,
  onClose
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const snapshot = comment.snapshot;
  if (!snapshot) return null;

  const url = api.commentSnapshotUrl(comment.id, snapshot.capturedAt);

  return (
    <ModalPortal className="!bg-slate-950/80">
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 text-sm">批注页面快照</h3>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                #{pinNumber} · {comment.pagePath}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-1 shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title="在新标签页查看原图"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-slate-900/95 p-4 flex items-center justify-center">
          {failed ? (
            <div className="py-20 text-center text-slate-400">
              <Camera className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">快照文件已丢失或无法加载</p>
            </div>
          ) : (
            <div className="relative inline-block leading-none">
              <img
                src={url}
                alt={`批注 #${pinNumber} 的页面快照`}
                onError={() => setFailed(true)}
                className="block max-w-full max-h-[72vh] w-auto h-auto rounded-lg shadow-xl bg-white"
              />
              <span
                className="absolute z-10 flex items-center justify-center w-[17.5px] h-[17.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600 text-white text-[9px] font-bold ring-1 ring-white shadow-[0_0_0_2px_rgba(99,102,241,0.3)]"
                style={{ left: `${snapshot.markerXPercent}%`, top: `${snapshot.markerYPercent}%` }}
                title="批注位置"
              >
                {pinNumber}
              </span>
            </div>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 flex items-center justify-between shrink-0 text-[11px] text-slate-400">
          <span>快照记录于批注创建时，不受原型后续改版影响</span>
          <span>
            {new Date(snapshot.capturedAt).toLocaleString([], {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })}
          </span>
        </div>
      </div>
    </ModalPortal>
  );
};
