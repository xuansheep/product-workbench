import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  Plus,
  FileCode,
  Archive,
  History,
  Trash2,
  Edit2,
  Clock,
  ChevronRight,
  ArrowLeft,
  Info,
  Paperclip
} from "lucide-react";
import { type Project, type Prototype, type Attachment } from "../types/index.js";
import { api } from "../services/api.js";
import { ConfirmModal } from "./common/ConfirmModal.js";
import { AttachmentList } from "./common/AttachmentList.js";
import { AttachmentModal } from "./common/AttachmentModal.js";

interface PrototypeListProps {
  project: Project;
  prototypes: Prototype[];
  onBackToProjects: () => void;
  onOpenViewer: (proto: Prototype) => void;
  onUploadPrototype: (formData: FormData) => Promise<void>;
  onUploadNewVersion: (protoId: string, formData: FormData) => Promise<void>;
  onUpdatePrototype: (id: string, name: string, description: string) => Promise<void>;
  onDeletePrototype: (protoId: string) => Promise<void>;
}

export const PrototypeList: React.FC<PrototypeListProps> = ({
  project,
  prototypes,
  onBackToProjects,
  onOpenViewer,
  onUploadPrototype,
  onUploadNewVersion,
  onUpdatePrototype,
  onDeletePrototype
}) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadTargetProto, setUploadTargetProto] = useState<Prototype | null>(null);
  const [deletingProtoId, setDeletingProtoId] = useState<string | null>(null);

  const [editingProto, setEditingProto] = useState<Prototype | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // 附件按原型 id 分组缓存，列表页一次请求取全，避免每张卡片各发一次
  const [attachmentsByProto, setAttachmentsByProto] = useState<Record<string, Attachment[]>>({});
  const [attachmentTargetProto, setAttachmentTargetProto] = useState<Prototype | null>(null);

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [changelog, setChangelog] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 附件加载失败不该拖垮卡片列表，记录日志后按空列表渲染即可
    api
      .getAttachmentsByProject(project.id)
      .then((list) => {
        const grouped: Record<string, Attachment[]> = {};
        for (const att of list) {
          if (!grouped[att.prototypeId]) grouped[att.prototypeId] = [];
          grouped[att.prototypeId].push(att);
        }
        setAttachmentsByProto(grouped);
      })
      .catch((err) => console.error("Failed to load attachments:", err));
  }, [project.id]);

  const handleAddAttachment = async (formData: FormData) => {
    if (!attachmentTargetProto) return;
    const created = await api.addAttachment(attachmentTargetProto.id, formData);
    setAttachmentsByProto((prev) => ({
      ...prev,
      [created.prototypeId]: [created, ...(prev[created.prototypeId] || [])]
    }));
  };

  const handleDeleteAttachment = async (protoId: string, id: string) => {
    try {
      await api.deleteAttachment(id);
      setAttachmentsByProto((prev) => ({
        ...prev,
        [protoId]: (prev[protoId] || []).filter((a) => a.id !== id)
      }));
    } catch (err: any) {
      alert(err.message || "附件删除失败");
    }
  };

  const handleOpenUpload = (targetProto?: Prototype) => {
    setUploadTargetProto(targetProto || null);
    setName(targetProto ? targetProto.name : "");
    setDesc(targetProto ? targetProto.description : "");
    setChangelog(targetProto ? `迭代更新 v${targetProto.versions.length + 1}.0` : "初始版本上传");
    setSelectedFile(null);
    setIsUploadModalOpen(true);
  };

  const handleOpenEdit = (proto: Prototype, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProto(proto);
    setEditName(proto.name);
    setEditDesc(proto.description);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProto || !editName.trim()) return;
    setEditSaving(true);
    try {
      await onUpdatePrototype(editingProto.id, editName.trim(), editDesc.trim());
      setEditingProto(null);
    } catch (err: any) {
      alert(err.message || "保存失败");
    } finally {
      setEditSaving(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      alert("请选择要上传的原型文件 (.zip 或 .html)");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("changelog", changelog.trim());

      if (uploadTargetProto) {
        await onUploadNewVersion(uploadTargetProto.id, formData);
      } else {
        formData.append("projectId", project.id);
        formData.append("name", name.trim() || selectedFile.name.replace(/\.[^/.]+$/, ""));
        formData.append("description", desc.trim());
        await onUploadPrototype(formData);
      }
      setIsUploadModalOpen(false);
    } catch (err: any) {
      alert(err.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProtoId) return;
    try {
      await onDeletePrototype(deletingProtoId);
    } finally {
      setDeletingProtoId(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* 导航与项目头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1.5">
          <button
            onClick={onBackToProjects}
            className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors group mb-1"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>返回所有项目</span>
          </button>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-3">
            <span>{project.name}</span>
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {prototypes.length} 个原型
            </span>
          </h1>
          <p className="text-xs text-slate-500 max-w-2xl">{project.description || "暂无项目描述"}</p>
        </div>

        <button
          onClick={() => handleOpenUpload()}
          className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-md shadow-indigo-200 transition-all active:scale-95 shrink-0"
        >
          <Upload className="w-4 h-4" />
          <span>上传新原型</span>
        </button>
      </div>

      {/* 原型卡片列表 */}
      {prototypes.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center max-w-lg mx-auto my-12">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
            <FileCode className="w-7 h-7" />
          </div>
          <h3 className="font-bold text-slate-800 text-base">该项目下暂无原型</h3>
          <p className="text-xs text-slate-400 mt-1.5 mb-6 max-w-sm mx-auto">
            支持上传单 HTML 页面、Axure / Figma 导出的静态站点 Zip 压缩包，自动提取入口并支持多人批注协作。
          </p>
          <button
            onClick={() => handleOpenUpload()}
            className="px-5 py-2.5 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-700 transition-all inline-flex items-center space-x-2 shadow-md shadow-indigo-100"
          >
            <Upload className="w-4 h-4" />
            <span>立即上传第一个原型</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {prototypes.map((proto) => {
            const currentVer =
              proto.versions.find((v) => v.id === proto.currentVersionId) ||
              proto.versions[0] ||
              { versionLabel: "v1.0", changelog: "初始版本" };
            const protoAttachments = attachmentsByProto[proto.id] || [];
            return (
              <div
                key={proto.id}
                onClick={() => onOpenViewer(proto)}
                className="group bg-white rounded-2xl border border-slate-200/80 hover:border-indigo-400/80 p-5 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all cursor-pointer flex flex-col justify-between relative"
              >
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <FileCode className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100/80 text-indigo-700">
                          {currentVer.versionLabel}
                        </span>
                        <span className="ml-1.5 text-[10px] text-slate-400">
                          共 {proto.versions.length} 个历史版本
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleOpenEdit(proto, e)}
                        title="编辑原型信息"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenUpload(proto);
                        }}
                        title="上传新版本"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingProtoId(proto.id);
                        }}
                        title="移至回收站"
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-slate-900 text-base group-hover:text-indigo-600 transition-colors line-clamp-1">
                      {proto.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed min-h-[32px]">
                      {proto.description || "暂无描述"}
                    </p>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100 text-xs text-slate-500 flex items-center space-x-2">
                    <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="truncate">最近日志: {currentVer.changelog || "无更新说明"}</span>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <div className="flex items-center space-x-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{new Date(proto.updatedAt).toLocaleDateString()}</span>
                  </div>

                  {/* 常驻附件入口：没有附件时也要露出，否则用户无从发现可以从卡片添加 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttachmentTargetProto(proto);
                    }}
                    title="管理关联附件"
                    className={`flex items-center space-x-1 px-1.5 py-0.5 rounded-md transition-colors hover:text-indigo-600 hover:bg-indigo-50 ${
                      protoAttachments.length > 0 ? "text-indigo-500 font-semibold" : ""
                    }`}
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>{protoAttachments.length}</span>
                  </button>

                  <div className="flex items-center space-x-1 font-semibold text-indigo-600 group-hover:translate-x-0.5 transition-transform">
                    <span>打开工作台</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* 附件悬浮浮层：绝对定位完全脱离文档流，卡片高度与网格对齐不受影响。
                    pt-2 而非 mt-2 —— 外边距会造成无法跨越的悬停空隙，内边距本身就是可悬停区域 */}
                <div className="absolute left-0 right-0 top-full z-30 pt-2 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-[opacity,visibility] duration-150">
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-indigo-500/5 p-3"
                  >
                    <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-slate-100">
                      <span className="text-[11px] font-bold text-slate-600">
                        关联附件 ({protoAttachments.length})
                      </span>
                      <button
                        onClick={() => setAttachmentTargetProto(proto)}
                        className="flex items-center space-x-0.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                      >
                        <Plus className="w-3 h-3" />
                        <span>添加</span>
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <AttachmentList
                        attachments={protoAttachments}
                        onDelete={(id) => handleDeleteAttachment(proto.id, id)}
                        compact
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 上传模态框 */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">
                    {uploadTargetProto ? `给【${uploadTargetProto.name}】上传新版本` : "上传新原型"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {uploadTargetProto
                      ? `上传后将自动递增为 v${uploadTargetProto.versions.length + 1}.0`
                      : "支持 .zip 静态网站压缩包或单 .html 页面"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? "border-indigo-500 bg-indigo-50/50"
                    : selectedFile
                    ? "border-emerald-500 bg-emerald-50/30"
                    : "border-slate-200 hover:border-indigo-400 hover:bg-slate-50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.html,.htm"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="space-y-1.5">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-semibold text-emerald-800 truncate max-w-xs mx-auto">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-emerald-600">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 点击可更换
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                      <Archive className="w-5 h-5" />
                    </div>
                    <p className="text-xs font-semibold text-slate-700">点击选择或拖拽文件到这里</p>
                    <p className="text-[10px] text-slate-400">支持 Axure/墨刀导出的 .zip 压缩包或单 .html 页面</p>
                  </div>
                )}
              </div>

              {!uploadTargetProto && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    原型名称
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="默认使用上传文件名"
                    maxLength={50}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 bg-white"
                  />
                </div>
              )}

              {!uploadTargetProto && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                    原型简述
                  </label>
                  <input
                    type="text"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="说明此原型的业务范围或模块..."
                    maxLength={100}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 bg-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  版本更新说明 (Changelog)
                </label>
                <textarea
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  placeholder="记录本次上传所包含的功能改动..."
                  rows={2}
                  maxLength={150}
                  className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none text-slate-900 bg-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-100 transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {uploading ? (
                    <span>正在上传解析...</span>
                  ) : (
                    <span>{uploadTargetProto ? "发布新版本" : "立即上传"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 编辑原型信息弹窗 */}
      {editingProto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">编辑原型信息</h3>
                  <p className="text-xs text-slate-400">修改原型名称与简述，不影响已有版本与批注</p>
                </div>
              </div>
              <button
                onClick={() => setEditingProto(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  原型名称 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="例如：智能客服工单系统"
                  required
                  maxLength={50}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  原型简述
                </label>
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="说明此原型的业务范围或模块..."
                  maxLength={100}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-900 bg-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setEditingProto(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editSaving || !editName.trim()}
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-100 transition-colors disabled:opacity-50"
                >
                  {editSaving ? "保存中..." : "保存修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 附件新增弹窗：必须挂在组件层，放进悬浮浮层会随鼠标移开被一起卸载 */}
      {attachmentTargetProto && (
        <AttachmentModal
          protoName={attachmentTargetProto.name}
          onClose={() => setAttachmentTargetProto(null)}
          onSubmit={handleAddAttachment}
        />
      )}

      {/* 自定义删除确认弹窗 */}
      <ConfirmModal
        isOpen={Boolean(deletingProtoId)}
        title="移至回收站"
        description="确定将此原型移至回收站吗？可随时在回收站还原。"
        confirmText="移入回收站"
        type="warning"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingProtoId(null)}
      />
    </div>
  );
};
