export interface Project {
  id: string;
  name: string;
  description: string;
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
  selector?: string;             // 目标元素 CSS 选择器
  tagName?: string;              // BUTTON, DIV, INPUT 等
  innerTextSnippet?: string;     // 目标元素文本前缀，如 "立即接单"
  elementOffsetXPercent?: number;// 相对目标元素内部的 X% 偏移 (0-100)
  elementOffsetYPercent?: number;// 相对目标元素内部的 Y% 偏移 (0-100)
}

export interface Comment {
  id: string;
  prototypeId: string;
  versionId: string;
  pagePath: string;              // 规范化相对子路径与 hash，如 "index.html" 或 "order.html#/pay"
  xPercent: number;              // 视口相对备用坐标 (0-100)
  yPercent: number;              // 视口相对备用坐标 (0-100)
  docX?: number;                 // 文档绝对坐标 X (像素)
  docY?: number;                 // 文档绝对坐标 Y (像素)
  target?: CommentTargetInfo;    // 锚定目标 DOM 元素信息
  content: string;
  author: CommentAuthor;
  status: "open" | "resolved";
  replies: CommentReply[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchData {
  projects: Project[];
  prototypes: Prototype[];
  comments: Comment[];
}
