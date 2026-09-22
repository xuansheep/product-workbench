import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkbenchData, Project, Prototype, Comment } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 支持通过环境变量动态指定存储目录与数据文件路径（用于自动化测试沙箱隔离与多环境部署）
const STORAGE_DIR = process.env.WORKBENCH_STORAGE_DIR
  ? path.resolve(process.env.WORKBENCH_STORAGE_DIR)
  : path.resolve(__dirname, "../../../storage");
const DATA_FILE = process.env.WORKBENCH_DATA_PATH
  ? path.resolve(process.env.WORKBENCH_DATA_PATH)
  : path.join(STORAGE_DIR, "data.json");

const initialData: WorkbenchData = {
  projects: [
    {
      id: "p-sample",
      name: "智能客服产品线原型",
      description: "对话式知识库与智能质检流转系统原型集",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  prototypes: [
    {
      id: "proto-sample",
      projectId: "p-sample",
      name: "客服AI工作台",
      description: "示例原型展示，包含多页面切换与文档坐标批注",
      currentVersionId: "v-sample-1",
      versions: [
        {
          id: "v-sample-1",
          versionNumber: 1,
          versionLabel: "v1.0",
          changelog: "初始版本上线，支持实时交互",
          entryFile: "index.html",
          storageDir: "/prototypes/proto-sample/v1",
          createdAt: new Date().toISOString()
        }
      ],
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  comments: [
    {
      id: "cmt-sample-1",
      prototypeId: "proto-sample",
      versionId: "v-sample-1",
      pagePath: "index.html",
      xPercent: 88,
      yPercent: 4.5,
      docX: 980,
      docY: 35,
      target: {
        selector: "#nav-to-detail",
        tagName: "A",
        innerTextSnippet: "进入详情页",
        elementOffsetXPercent: 50,
        elementOffsetYPercent: 50
      },
      content: "右上角页面跳转链接响应非常迅速，验证通过。",
      author: {
        name: "极客PM-张工",
        avatar: "avatar-pm-1"
      },
      status: "open",
      replies: [
        {
          id: "rpl-sample-1",
          commentId: "cmt-sample-1",
          content: "收到，已支持多页面与 Hash 路由平滑吸附跟随。",
          author: {
            name: "前端架构-小李",
            avatar: "avatar-dev-1"
          },
          createdAt: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]
};

// 与旧 SQLite 对 TEXT 列的字节序比较保持一致，避免排序语义发生漂移
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 对外统一按版本号降序暴露 versions（对齐旧 SQL 的 ORDER BY version_number DESC）
function sortedPrototype(proto: Prototype): Prototype {
  return { ...proto, versions: [...proto.versions].sort((a, b) => b.versionNumber - a.versionNumber) };
}

// 对外统一按创建时间升序暴露 replies，保证批注回复的先后顺序稳定
function sortedComment(comment: Comment): Comment {
  return { ...comment, replies: [...comment.replies].sort((a, b) => compareText(a.createdAt, b.createdAt)) };
}

/**
 * 本地 JSON 文件存储。
 *
 * 内存态即数据真相，结构与数据模型完全一致（versions 内嵌在原型里、replies 内嵌在批注里），
 * 落盘后就是可直接阅读与手工编辑的 storage/data.json。
 *
 * 约定：读方法返回存活的顶层对象，写方法负责整体落盘，调用方遵循「读 → 改 → save」即可。
 * 所有写操作都是同步的，Node 单线程下不存在并发写交错的窗口，因此不需要额外加锁。
 */
class Store {
  private data: WorkbenchData;
  private readonly dataFile: string;

  constructor(customDataPath?: string) {
    this.dataFile = customDataPath || DATA_FILE;
    this.data = this.load();
    console.log(`[Store] 数据文件就绪 | file=${this.dataFile}`);
  }

  private load(): WorkbenchData {
    if (!fs.existsSync(this.dataFile)) {
      // 首次启动写入示例数据，保证前端有可浏览的初始内容
      const seed = JSON.parse(JSON.stringify(initialData)) as WorkbenchData;
      this.persist(seed);
      return seed;
    }

    try {
      return JSON.parse(fs.readFileSync(this.dataFile, "utf-8")) as WorkbenchData;
    } catch (err) {
      // 解析失败必须让服务启动失败：静默重新播种会把「数据损坏」伪装成「全新开始」，
      // 用户随后的第一次写入就会真正覆盖掉原文件。
      throw new Error(
        `数据文件解析失败，请修复或移除后重启 | file=${this.dataFile} | reason=${(err as Error).message}`
      );
    }
  }

  // 原子落盘：先写同目录临时文件再 rename 覆盖，进程中途崩溃不会留下半截 JSON
  private persist(data: WorkbenchData) {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const tempFile = `${this.dataFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tempFile, this.dataFile);
  }

  // 写入统一入口：变更函数抛出异常时不落盘，保证内存态与磁盘态一致
  private mutate<T>(fn: (data: WorkbenchData) => T): T {
    const result = fn(this.data);
    this.persist(this.data);
    return result;
  }

  // 内存列表按 id 新增或整体替换
  private upsert<T extends { id: string }>(list: T[], item: T): T {
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index === -1) {
      list.push(item);
    } else {
      list[index] = item;
    }
    return item;
  }

  // Projects
  public getProjects(): Project[] {
    return [...this.data.projects].sort((a, b) => compareText(b.createdAt, a.createdAt));
  }

  public getProjectById(id: string): Project | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  public saveProject(project: Project): Project {
    return this.mutate((data) => this.upsert(data.projects, project));
  }

  public deleteProject(id: string): boolean {
    return this.mutate((data) => {
      // 级联软删除项目下的原型，避免原型失去所属项目后成为孤儿数据
      const now = new Date().toISOString();
      for (const proto of data.prototypes) {
        if (proto.projectId === id && !proto.isDeleted) {
          proto.isDeleted = true;
          proto.deletedAt = now;
        }
      }

      const index = data.projects.findIndex((p) => p.id === id);
      if (index === -1) return false;
      data.projects.splice(index, 1);
      return true;
    });
  }

  // Prototypes
  // includeDeleted 语义与旧实现保持一致：true 表示「只要已删除的」，供回收站列表使用
  public getPrototypes(projectId?: string, includeDeleted = false): Prototype[] {
    return this.data.prototypes
      .filter((p) => p.isDeleted === includeDeleted && (!projectId || p.projectId === projectId))
      .sort((a, b) => compareText(b.createdAt, a.createdAt))
      .map(sortedPrototype);
  }

  public getPrototypeById(id: string): Prototype | undefined {
    const proto = this.data.prototypes.find((p) => p.id === id);
    return proto ? sortedPrototype(proto) : undefined;
  }

  public savePrototype(proto: Prototype): Prototype {
    return this.mutate((data) => this.upsert(data.prototypes, proto));
  }

  public permanentDeletePrototype(id: string): boolean {
    return this.mutate((data) => {
      const index = data.prototypes.findIndex((p) => p.id === id);
      if (index === -1) return false;

      data.prototypes.splice(index, 1);
      // 级联清理该原型下的批注；回复内嵌在批注对象里，随之一起消失
      data.comments = data.comments.filter((c) => c.prototypeId !== id);
      return true;
    });
  }

  // Comments
  public getComments(prototypeId: string, versionId?: string): Comment[] {
    return this.data.comments
      .filter((c) => c.prototypeId === prototypeId && (!versionId || c.versionId === versionId))
      .sort((a, b) => compareText(a.createdAt, b.createdAt))
      .map(sortedComment);
  }

  public getCommentById(id: string): Comment | undefined {
    const comment = this.data.comments.find((c) => c.id === id);
    return comment ? sortedComment(comment) : undefined;
  }

  public saveComment(comment: Comment): Comment {
    return this.mutate((data) => this.upsert(data.comments, comment));
  }

  public deleteComment(id: string): boolean {
    return this.mutate((data) => {
      const index = data.comments.findIndex((c) => c.id === id);
      if (index === -1) return false;
      data.comments.splice(index, 1);
      return true;
    });
  }

  // 兼容完整快照导出
  public getData(): WorkbenchData {
    const prototypes = this.getPrototypes(undefined, false).concat(this.getPrototypes(undefined, true));
    return {
      projects: this.getProjects(),
      prototypes,
      comments: prototypes.flatMap((proto) => this.getComments(proto.id))
    };
  }
}

export const store = new Store();
export { STORAGE_DIR };
