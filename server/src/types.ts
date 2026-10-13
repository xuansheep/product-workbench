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
  anchorKind?: "element" | "container"; // 缺省时按 selector 是否存在推断
  selector?: string;             // element 锚点：相对 viewContainerSelector 作用域的选择器
  viewContainerSelector?: string;// 视图容器选择器，锚点解析的硬边界
  containerOffsetXPercent?: number; // container 锚点：相对容器 padding box 的 X% 偏移 (0-100)
  containerOffsetYPercent?: number; // container 锚点：相对容器 padding box 的 Y% 偏移 (0-100)
  tagName?: string;              // BUTTON, DIV, INPUT 等
  innerTextSnippet?: string;     // 目标元素文本前缀，如 "立即接单"
  elementOffsetXPercent?: number;// 相对目标元素内部的 X% 偏移 (0-100)
  elementOffsetYPercent?: number;// 相对目标元素内部的 Y% 偏移 (0-100)
  inlinePageId?: string;         // 所属内联页面/视图容器标识（如 page-overview）
}

export interface Comment {
  id: string;
  prototypeId: string;
  versionId: string;
  pagePath: string;              // 规范化相对子路径与 hash，如 "index.html" 或 "order.html#/pay"
  xPercent?: number;             // 已废弃：不再参与渲染定位，仅历史数据保留
  yPercent?: number;             // 已废弃：不再参与渲染定位，仅历史数据保留
  docX?: number;                 // 已废弃：不再参与渲染定位，仅历史数据保留
  docY?: number;                 // 已废弃：不再参与渲染定位，仅历史数据保留
  target?: CommentTargetInfo;    // 锚定目标 DOM 元素信息
  content: string;
  author: CommentAuthor;
  status: "open" | "resolved";
  replies: CommentReply[];
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  prototypeId: string;
  name: string;                  // 展示名与下载名；用户留空时由服务端回退为 url 或原始文件名
  type: "url" | "file";
  url?: string;                  // type=url，已归一化的 http(s) 地址
  fileName?: string;             // type=file，上传时的原始文件名
  mimeType?: string;             // type=file，按扩展名推导的可信类型（非客户端声明值）
  size?: number;                 // type=file，字节数
  createdAt: string;
}

export interface WorkbenchData {
  projects: Project[];
  prototypes: Prototype[];
  comments: Comment[];
  attachments: Attachment[];
}
