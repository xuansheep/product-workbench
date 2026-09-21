import React, { useState } from "react";
import { X, Check, User, ChevronDown, ChevronUp } from "lucide-react";
import { type UserAccount, PRESET_AVATARS } from "../types/index.js";

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: UserAccount;
  onUpdateAccount: (updates: Partial<UserAccount>) => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  account,
  onUpdateAccount
}) => {
  const [name, setName] = useState(account.name);
  const [selectedAvatarId, setSelectedAvatarId] = useState(account.avatar);

  // 默认双排展示（16个）；如果当前选中的头像在后16个，初始化时自动展开
  const initialIndex = PRESET_AVATARS.findIndex((a) => a.id === account.avatar);
  const [isExpanded, setIsExpanded] = useState(initialIndex >= 16);

  if (!isOpen) return null;

  const currentAvatarInfo =
    PRESET_AVATARS.find((a) => a.id === selectedAvatarId) || PRESET_AVATARS[0];

  const displayedAvatars = isExpanded
    ? PRESET_AVATARS
    : PRESET_AVATARS.slice(0, 16);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onUpdateAccount({
      name: name.trim(),
      avatar: selectedAvatarId
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 顶部标题 */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">账户设置</h3>
              <p className="text-xs text-slate-400">设置您的头像与称呼</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* 即时预览效果 */}
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">发言展示效果</span>
            <div className="flex items-center space-x-2 bg-white px-2.5 py-1 rounded-lg border border-slate-200/80 shadow-xs">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs shadow-xs ${currentAvatarInfo.bg} text-white`}
              >
                {currentAvatarInfo.emoji}
              </div>
              <span className="text-xs font-semibold text-slate-800 truncate max-w-[140px]">
                {name.trim() || "未命名成员"}
              </span>
            </div>
          </div>

          {/* 1. 自定义名称输入（置于头像选择上方） */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              姓名 / 昵称
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入你的称呼，如：小王 / 产品架构师"
                maxLength={20}
                required
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-slate-800 placeholder:text-slate-400 bg-white"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              在原型批注与发表时，将以此名称作为发言人展示
            </p>
          </div>

          {/* 2. 头像选择（32个预设，缩小间距，默认双排展示，可展开） */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                选择头像
              </label>
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="inline-flex items-center space-x-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                <span>{isExpanded ? "收起双排" : `展开全部 (${PRESET_AVATARS.length})`}</span>
                {isExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* 紧凑网格（8列，双排展示16个，展开展示32个） */}
            <div className="grid grid-cols-8 gap-1.5 sm:gap-2 p-2.5 bg-slate-50/70 rounded-2xl border border-slate-100 transition-all">
              {displayedAvatars.map((av) => {
                const isSelected = av.id === selectedAvatarId;
                return (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setSelectedAvatarId(av.id)}
                    title={av.label}
                    className={`relative aspect-square w-full rounded-xl flex items-center justify-center transition-all ${
                      isSelected
                        ? "ring-2 ring-indigo-600 ring-offset-2 scale-105 shadow-sm"
                        : "hover:scale-105 hover:shadow-xs opacity-80 hover:opacity-100"
                    } ${av.bg} text-white`}
                  >
                    <span className="text-base select-none leading-none">{av.emoji}</span>
                    {isSelected && (
                      <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow">
                        <Check className="w-2 h-2 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 底部按钮 */}
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
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md shadow-indigo-100 transition-colors"
            >
              保存设置
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
