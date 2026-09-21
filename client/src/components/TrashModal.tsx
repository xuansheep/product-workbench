import React, { useState } from "react";
import { X, Trash2, RotateCcw, Calendar } from "lucide-react";
import { type Prototype } from "../types/index.js";
import { ConfirmModal } from "./common/ConfirmModal.js";

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  trashList: Prototype[];
  onRestore: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
}

export const TrashModal: React.FC<TrashModalProps> = ({
  isOpen,
  onClose,
  trashList,
  onRestore,
  onPermanentDelete
}) => {
  const [operatingId, setOperatingId] = useState<string | null>(null);
  const [permanentDeleteTargetId, setPermanentDeleteTargetId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRestore = async (id: string) => {
    setOperatingId(id);
    try {
      await onRestore(id);
    } finally {
      setOperatingId(null);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!permanentDeleteTargetId) return;
    const target = permanentDeleteTargetId;
    setPermanentDeleteTargetId(null);
    setOperatingId(target);
    try {
      await onPermanentDelete(target);
    } finally {
      setOperatingId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">回收站</h3>
                <p className="text-xs text-slate-400">已删除的原型在此安全隔离，支持恢复或彻底清除</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {trashList.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                  <Trash2 className="w-6 h-6" />
                </div>
                <p className="text-slate-600 font-medium text-sm">回收站空空如也</p>
                <p className="text-slate-400 text-xs mt-1">没有被软删除的原型文件</p>
              </div>
            ) : (
              <div className="space-y-3">
                {trashList.map((proto) => (
                  <div
                    key={proto.id}
                    className="p-4 rounded-xl border border-slate-200/80 hover:border-slate-300 bg-slate-50/50 flex items-center justify-between transition-all"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-semibold text-slate-800 text-sm truncate">{proto.name}</h4>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-200 text-slate-600">
                          {proto.versions?.length || 1} 个版本
                        </span>
                      </div>
                      <div className="flex items-center space-x-3 mt-1.5 text-xs text-slate-400">
                        <span>所属项目: {proto.projectName || "未知"}</span>
                        <span>·</span>
                        <span className="flex items-center space-x-1">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            {proto.deletedAt ? new Date(proto.deletedAt).toLocaleDateString() : "近期"}
                          </span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={() => handleRestore(proto.id)}
                        disabled={operatingId === proto.id}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>还原</span>
                      </button>
                      <button
                        onClick={() => setPermanentDeleteTargetId(proto.id)}
                        disabled={operatingId === proto.id}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>彻底删除</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 彻底删除确认弹窗 */}
      <ConfirmModal
        isOpen={Boolean(permanentDeleteTargetId)}
        title="彻底物理删除原型"
        description="确定要彻底删除该原型吗？物理磁盘上的所有静态资源与历史版本将一并清空，无法找回！"
        confirmText="确认彻底销毁"
        type="danger"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTargetId(null)}
      />
    </>
  );
};
