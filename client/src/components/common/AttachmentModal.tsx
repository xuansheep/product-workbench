import React, { useRef, useState } from "react";
import { Link2, Paperclip, Upload, X } from "lucide-react";
import { MAX_ATTACHMENT_SIZE } from "../../types/index.js";
import { ModalPortal } from "./ModalPortal.js";

interface AttachmentModalProps {
  protoName: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => Promise<void>;
}

export const AttachmentModal: React.FC<AttachmentModalProps> = ({ protoName, onClose, onSubmit }) => {
  const [type, setType] = useState<"url" | "file">("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePickFile = (picked: File | null) => {
    if (picked && picked.size > MAX_ATTACHMENT_SIZE) {
      setFile(null);
      setError(`文件大小不能超过 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB`);
      return;
    }
    setError("");
    setFile(picked);
  };

  const canSubmit = type === "url" ? url.trim().length > 0 : Boolean(file);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const formData = new FormData();
    formData.append("type", type);
    formData.append("name", name);
    if (type === "url") {
      formData.append("url", url.trim());
    } else if (file) {
      formData.append("file", file);
    }

    setSaving(true);
    setError("");
    try {
      await onSubmit(formData);
      onClose();
    } catch (err: any) {
      setError(err.message || "附件保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Paperclip className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">添加关联附件</h3>
              <p className="text-xs text-slate-400 truncate max-w-[240px]">关联至【{protoName}】</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 附件类型切换 */}
          <div className="flex items-center space-x-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setType("url")}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 ${
                type === "url" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>外部链接</span>
            </button>
            <button
              type="button"
              onClick={() => setType("file")}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center space-x-1.5 ${
                type === "file" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>上传文件</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
              附件名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空则自动使用链接地址或文件名"
              maxLength={200}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 bg-white"
            />
          </div>

          {type === "url" ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                链接地址 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 bg-white"
              />
              <p className="text-[10px] text-slate-400 mt-1.5">仅支持 http / https 协议</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                附件文件 <span className="text-rose-500">*</span>
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-slate-50 rounded-2xl p-5 text-center cursor-pointer transition-all"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => handlePickFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {file ? (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-emerald-800 truncate max-w-xs mx-auto">{file.name}</p>
                    <p className="text-[10px] text-emerald-600">
                      {(file.size / 1024 / 1024).toFixed(2)} MB · 点击可更换
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="w-5 h-5 text-indigo-500 mx-auto" />
                    <p className="text-xs font-semibold text-slate-700">点击选择文件</p>
                    <p className="text-[10px] text-slate-400">
                      图片 / PDF / 文本文档可在新页面预览，其他类型将直接下载；单文件不超过{" "}
                      {MAX_ATTACHMENT_SIZE / 1024 / 1024}MB
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{error}</p>
          )}

          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-100 transition-colors disabled:opacity-50"
            >
              {saving ? "保存中..." : "添加附件"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
};
