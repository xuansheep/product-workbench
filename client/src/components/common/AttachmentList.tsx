import React, { useState } from "react";
import { Link2, FileText, Download, Trash2 } from "lucide-react";
import { type Attachment } from "../../types/index.js";
import { ConfirmModal } from "./ConfirmModal.js";

interface AttachmentListProps {
  attachments: Attachment[];
  onDelete: (id: string) => Promise<void>;
  /** 紧凑模式用于卡片悬浮浮层，留白更小 */
  compact?: boolean;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const AttachmentList: React.FC<AttachmentListProps> = ({ attachments, onDelete, compact }) => {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    try {
      await onDelete(deletingId);
    } finally {
      setDeletingId(null);
    }
  };

  if (attachments.length === 0) {
    return <p className="text-xs text-slate-400 py-3 text-center">暂无关联附件</p>;
  }

  return (
    <>
      <ul className={compact ? "space-y-1" : "space-y-2"}>
        {attachments.map((att) => {
          // 链接一律新窗口打开；文件由服务端决定处置方式，可预览的走预览，其余靠 download 触发下载
          const isUrl = att.type === "url";
          const href = isUrl ? att.url : att.rawUrl;
          const previewable = isUrl || att.previewable;

          return (
            <li
              key={att.id}
              className="group/item flex items-center space-x-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <span className="w-5 h-5 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                {isUrl ? <Link2 className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              </span>

              <a
                href={href}
                target={previewable ? "_blank" : undefined}
                rel={previewable ? "noopener noreferrer" : undefined}
                download={previewable ? undefined : att.name}
                onClick={(e) => e.stopPropagation()}
                title={isUrl ? att.url : att.name}
                className="flex-1 min-w-0 text-xs text-slate-700 hover:text-indigo-600 truncate"
              >
                {att.name}
              </a>

              {!isUrl && (
                <span className="text-[10px] text-slate-400 shrink-0">{formatSize(att.size)}</span>
              )}
              {!isUrl && !att.previewable && <Download className="w-3 h-3 text-slate-400 shrink-0" />}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingId(att.id);
                }}
                title="删除此附件"
                className="p-1 text-slate-300 hover:text-rose-500 rounded-md transition-colors shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          );
        })}
      </ul>

      {/* ConfirmModal 自带 ModalPortal 挂到 body，因此不会被卡片悬浮浮层的
          visibility:hidden 一并隐藏 —— 隔层浮层里也不会变成不可见或不可交互 */}
      {deletingId && (
        <ConfirmModal
          isOpen
          title="删除附件"
          description="确定要删除此附件吗？文件将从服务器一并清除，该操作不可撤销。"
          confirmText="彻底删除"
          type="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </>
  );
};
