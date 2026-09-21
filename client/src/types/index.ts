export interface Project {
  id: string;
  name: string;
  description: string;
  prototypeCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrototypeVersion {
  id: string;
  versionNumber: number;
  versionLabel: string;
  changelog: string;
  entryFile: string;
  storageDir: string;
  createdAt: string;
}

export interface Prototype {
  id: string;
  projectId: string;
  name: string;
  description: string;
  currentVersionId: string;
  versions: PrototypeVersion[];
  isDeleted: boolean;
  deletedAt: string | null;
  projectName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentAuthor {
  name: string;
  avatar: string;
}

export interface CommentReply {
  id: string;
  commentId: string;
  content: string;
  author: CommentAuthor;
  createdAt: string;
}

export interface CommentTargetInfo {
  selector?: string;
  tagName?: string;
  innerTextSnippet?: string;
  elementOffsetXPercent?: number;
  elementOffsetYPercent?: number;
  inlinePageId?: string; // 所属内联页面/视图容器标识（如 page-overview、page-devices）
}

export interface Comment {
  id: string;
  prototypeId: string;
  versionId: string;
  pagePath: string;
  xPercent: number;
  yPercent: number;
  docX?: number;
  docY?: number;
  target?: CommentTargetInfo;
  content: string;
  author: CommentAuthor;
  status: "open" | "resolved";
  replies: CommentReply[];
  createdAt: string;
  updatedAt: string;
}

export interface UserAccount {
  id: string;
  name: string;
  avatar: string;
  role?: string;
  color: string;
}

export interface PresetAvatar {
  id: string;
  label: string;
  emoji: string;
  bg: string;
}

export const PRESET_AVATARS: PresetAvatar[] = [
  // 1-12: 兼容历史已有头像 ID
  { id: "avatar-pm-1", label: "冲锋火箭", emoji: "🚀", bg: "bg-indigo-500" },
  { id: "avatar-pm-2", label: "领航罗盘", emoji: "🧭", bg: "bg-blue-500" },
  { id: "avatar-ui-1", label: "灵感画板", emoji: "🎨", bg: "bg-pink-500" },
  { id: "avatar-ui-2", label: "闪烁光芒", emoji: "✨", bg: "bg-purple-500" },
  { id: "avatar-dev-1", label: "敏捷闪电", emoji: "⚡", bg: "bg-emerald-500" },
  { id: "avatar-dev-2", label: "极客工具", emoji: "🛠️", bg: "bg-cyan-500" },
  { id: "avatar-qa-1", label: "精细透镜", emoji: "🔍", bg: "bg-amber-500" },
  { id: "avatar-ops-1", label: "稳固盾牌", emoji: "🛡️", bg: "bg-slate-600" },
  { id: "avatar-biz-1", label: "商务皮箱", emoji: "💼", bg: "bg-orange-500" },
  { id: "avatar-ai-1", label: "未来智械", emoji: "🤖", bg: "bg-violet-600" },
  { id: "avatar-sec-1", label: "安全金锁", emoji: "🔐", bg: "bg-rose-500" },
  { id: "avatar-guest-1", label: "璀璨星辰", emoji: "🌟", bg: "bg-teal-500" },

  // 13-32: 扩展至 32 个多样化头像
  { id: "avatar-13", label: "灵动小猫", emoji: "🐱", bg: "bg-amber-600" },
  { id: "avatar-14", label: "元气小狗", emoji: "🐶", bg: "bg-sky-500" },
  { id: "avatar-15", label: "聪慧赤狐", emoji: "🦊", bg: "bg-orange-600" },
  { id: "avatar-16", label: "悠然熊猫", emoji: "🐼", bg: "bg-stone-700" },
  { id: "avatar-17", label: "威武金狮", emoji: "🦁", bg: "bg-yellow-600" },
  { id: "avatar-18", label: "梦幻独角兽", emoji: "🦄", bg: "bg-fuchsia-500" },
  { id: "avatar-19", label: "睿智夜枭", emoji: "🦉", bg: "bg-indigo-600" },
  { id: "avatar-20", label: "敏捷海豚", emoji: "🐬", bg: "bg-blue-600" },
  { id: "avatar-21", label: "创新明灯", emoji: "💡", bg: "bg-amber-400" },
  { id: "avatar-22", label: "聚焦靶心", emoji: "🎯", bg: "bg-red-500" },
  { id: "avatar-23", label: "极客咖啡", emoji: "☕", bg: "bg-amber-800" },
  { id: "avatar-24", label: "幸运四叶草", emoji: "🍀", bg: "bg-emerald-600" },
  { id: "avatar-25", label: "预知晶球", emoji: "🔮", bg: "bg-purple-600" },
  { id: "avatar-26", label: "恒久纯钻", emoji: "💎", bg: "bg-cyan-600" },
  { id: "avatar-27", label: "荣耀金杯", emoji: "🏆", bg: "bg-yellow-500" },
  { id: "avatar-28", label: "沉浸耳机", emoji: "🎧", bg: "bg-violet-500" },
  { id: "avatar-29", label: "严谨眼镜", emoji: "👓", bg: "bg-slate-700" },
  { id: "avatar-30", label: "团队拼图", emoji: "🧩", bg: "bg-teal-600" },
  { id: "avatar-31", label: "初生青芽", emoji: "🌿", bg: "bg-lime-600" },
  { id: "avatar-32", label: "澎湃浩浪", emoji: "🌊", bg: "bg-sky-600" }
];
