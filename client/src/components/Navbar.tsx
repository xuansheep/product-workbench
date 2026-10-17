import React from "react";
import { Layers, Trash2, User, ChevronRight, FolderKanban } from "lucide-react";
import { type UserAccount, PRESET_AVATARS, type Project } from "../types/index.js";

interface NavbarProps {
  currentProject: Project | null;
  onBackToProjects: () => void;
  onOpenTrash: () => void;
  trashCount: number;
  account: UserAccount;
  onOpenAccountModal: () => void;
  isViewerMode?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentProject,
  onBackToProjects,
  onOpenTrash,
  trashCount,
  account,
  onOpenAccountModal,
  isViewerMode
}) => {
  const currentAvatarInfo = PRESET_AVATARS.find((a) => a.id === account.avatar) || PRESET_AVATARS[0];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30 select-none shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* 左侧：Logo 与 面包屑 */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToProjects}
            className="flex items-center space-x-2.5 text-slate-800 hover:text-indigo-600 transition-colors group"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-100 group-hover:scale-105 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
              产品工作台
            </span>
          </button>

          {currentProject && (
            <div className="hidden sm:flex items-center space-x-2 text-sm text-slate-400 pl-2">
              <ChevronRight className="w-4 h-4" />
              <button
                onClick={onBackToProjects}
                className="flex items-center space-x-1.5 font-medium text-slate-600 hover:text-indigo-600 transition-colors px-2 py-1 rounded-md hover:bg-slate-100"
              >
                <FolderKanban className="w-4 h-4 text-slate-400" />
                <span className="max-w-[200px] truncate">{currentProject.name}</span>
              </button>
            </div>
          )}
        </div>

        {/* 右侧：回收站 & 本地账户信息 */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onOpenTrash}
            title="查看回收站"
            className="relative p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
          >
            <Trash2 className="w-5 h-5" />
            {trashCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow">
                {trashCount > 9 ? "9+" : trashCount}
              </span>
            )}
          </button>

          <div className="h-5 w-px bg-slate-200 mx-1"></div>

          {/* 账户胶囊 */}
          <button
            onClick={onOpenAccountModal}
            className="flex items-center space-x-2.5 p-1.5 pr-3 rounded-full hover:bg-slate-100 border border-slate-200/80 transition-all text-left group"
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shadow-sm ${currentAvatarInfo.bg} text-white font-medium`}
            >
              {currentAvatarInfo.emoji}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors leading-tight max-w-[120px] truncate">
                {account.name}
              </span>
              <span className="text-[10px] text-slate-400 leading-tight">账户</span>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
};
