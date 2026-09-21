import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import type {
  WorkbenchData,
  Project,
  Prototype,
  PrototypeVersion,
  Comment,
  CommentReply,
  CommentTargetInfo,
  CommentAuthor
} from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 支持通过环境变量动态指定存储与数据库路径（用于自动化测试沙箱隔离与多环境部署）
const STORAGE_DIR = process.env.WORKBENCH_STORAGE_DIR
  ? path.resolve(process.env.WORKBENCH_STORAGE_DIR)
  : path.resolve(__dirname, "../../../storage");
const DB_FILE = process.env.WORKBENCH_DB_PATH
  ? path.resolve(process.env.WORKBENCH_DB_PATH)
  : path.join(STORAGE_DIR, "workbench.db");
const LEGACY_DATA_FILE = path.join(STORAGE_DIR, "data.json");

const initialData: WorkbenchData = {
  projects: [
    {
      id: "p-sample",
      name: "智能客服产品体验原型",
      description: "包含对话流、知识库检索以及工单流转的原型设计",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  prototypes: [
    {
      id: "proto-sample",
      projectId: "p-sample",
      name: "客服工单看板与AI流转",
      description: "演示高保真客服工作台、设备视口切换与元素吸附批注",
      currentVersionId: "v-sample-1",
      versions: [
        {
          id: "v-sample-1",
          versionNumber: 1,
          versionLabel: "v1.0",
          changelog: "初始版本上线：核心看板与实时工单流",
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
        innerTextSnippet: "进入工单详情页",
        elementOffsetXPercent: 50,
        elementOffsetYPercent: 50
      },
      content: "右上角这个进入详情页的跳转链接非常清晰，方便做多页面评审验证！",
      author: {
        name: "极客PM-体验官",
        avatar: "avatar-pm-1"
      },
      status: "open",
      replies: [
        {
          id: "rpl-sample-1",
          commentId: "cmt-sample-1",
          content: "收到，已支持多页面与 Hash 路由隔离。",
          author: {
            name: "前端极客-小王",
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

class Store {
  private db!: DatabaseType;

  constructor(customDbPath?: string) {
    this.init(customDbPath);
  }

  private init(customDbPath?: string) {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }

    const targetDbPath = customDbPath || DB_FILE;
    this.db = new Database(targetDbPath);

    // 生产级 SQLite PRAGMA 性能调优
    this.db.pragma("journal_mode = WAL");       // WAL 预写日志：读写并发互不阻塞
    this.db.pragma("foreign_keys = OFF");      // 应用层管理关联与级联，保障单元测试与灵活流转
    this.db.pragma("synchronous = NORMAL");     // WAL 最佳实践：兼顾极高写入吞吐与断电安全性
    this.db.pragma("busy_timeout = 5000");      // 高并发写冲突自动排队等待 5 秒
    this.db.pragma("temp_store = MEMORY");      // 临时表与中间计算放内存

    this.createSchema();
    this.checkAndMigrateLegacyData();
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prototypes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        current_version_id TEXT NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prototypes_project ON prototypes(project_id, is_deleted);

      CREATE TABLE IF NOT EXISTS prototype_versions (
        id TEXT PRIMARY KEY,
        prototype_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        version_label TEXT NOT NULL,
        changelog TEXT NOT NULL DEFAULT '',
        entry_file TEXT NOT NULL,
        storage_dir TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_versions_prototype ON prototype_versions(prototype_id, version_number);

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        prototype_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        page_path TEXT NOT NULL,
        x_percent REAL NOT NULL,
        y_percent REAL NOT NULL,
        doc_x REAL,
        doc_y REAL,
        target_json TEXT,
        content TEXT NOT NULL,
        author_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comments_prototype ON comments(prototype_id, version_id, created_at);

      CREATE TABLE IF NOT EXISTS comment_replies (
        id TEXT PRIMARY KEY,
        comment_id TEXT NOT NULL,
        content TEXT NOT NULL,
        author_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_replies_comment ON comment_replies(comment_id, created_at);
    `);
  }

  // 自动从历史 data.json 无损迁移数据（若数据库为空）
  private checkAndMigrateLegacyData() {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number };
    if (row.count > 0) return;

    let sourceData: WorkbenchData = initialData;

    if (fs.existsSync(LEGACY_DATA_FILE)) {
      try {
        const raw = fs.readFileSync(LEGACY_DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.prototypes && parsed.prototypes.length > 0) {
          sourceData = parsed;
          console.log("[SQLite] Discovered legacy data.json, performing seamless auto-migration to SQLite...");
        }
      } catch (err) {
        console.warn("[SQLite] Failed to parse legacy data.json, fallback to initial seed:", err);
      }
    }

    this.batchImportData(sourceData);
  }

  private batchImportData(data: WorkbenchData) {
    const insertProject = this.db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, description, created_at, updated_at)
      VALUES (@id, @name, @description, @createdAt, @updatedAt)
    `);

    const insertPrototype = this.db.prepare(`
      INSERT OR REPLACE INTO prototypes (
        id, project_id, name, description, current_version_id, is_deleted, deleted_at, created_at, updated_at
      ) VALUES (
        @id, @projectId, @name, @description, @currentVersionId, @isDeleted, @deletedAt, @createdAt, @updatedAt
      )
    `);

    const insertVersion = this.db.prepare(`
      INSERT OR REPLACE INTO prototype_versions (
        id, prototype_id, version_number, version_label, changelog, entry_file, storage_dir, created_at
      ) VALUES (
        @id, @prototypeId, @versionNumber, @versionLabel, @changelog, @entryFile, @storageDir, @createdAt
      )
    `);

    const insertComment = this.db.prepare(`
      INSERT OR REPLACE INTO comments (
        id, prototype_id, version_id, page_path, x_percent, y_percent, doc_x, doc_y,
        target_json, content, author_json, status, created_at, updated_at
      ) VALUES (
        @id, @prototypeId, @versionId, @pagePath, @xPercent, @yPercent, @docX, @docY,
        @targetJson, @content, @authorJson, @status, @createdAt, @updatedAt
      )
    `);

    const insertReply = this.db.prepare(`
      INSERT OR REPLACE INTO comment_replies (id, comment_id, content, author_json, created_at)
      VALUES (@id, @commentId, @content, @authorJson, @createdAt)
    `);

    const migrateTx = this.db.transaction(() => {
      const knownProjectIds = new Set<string>();

      // 1. 导入项目
      for (const p of data.projects || []) {
        knownProjectIds.add(p.id);
        insertProject.run({
          id: p.id,
          name: p.name,
          description: p.description || "",
          createdAt: p.createdAt || new Date().toISOString(),
          updatedAt: p.updatedAt || new Date().toISOString()
        });
      }

      // 2. 导入原型与版本（并自动修复历史孤儿项目的引用）
      for (const proto of data.prototypes || []) {
        if (!knownProjectIds.has(proto.projectId)) {
          // 自动补齐缺失的历史归档项目，保证数据不流失
          insertProject.run({
            id: proto.projectId,
            name: "历史归档空间",
            description: "数据迁移时自动补齐的归档项目",
            createdAt: proto.createdAt || new Date().toISOString(),
            updatedAt: proto.updatedAt || new Date().toISOString()
          });
          knownProjectIds.add(proto.projectId);
        }

        insertPrototype.run({
          id: proto.id,
          projectId: proto.projectId,
          name: proto.name,
          description: proto.description || "",
          currentVersionId: proto.currentVersionId,
          isDeleted: proto.isDeleted ? 1 : 0,
          deletedAt: proto.deletedAt || null,
          createdAt: proto.createdAt || new Date().toISOString(),
          updatedAt: proto.updatedAt || new Date().toISOString()
        });

        for (const ver of proto.versions || []) {
          insertVersion.run({
            id: ver.id,
            prototypeId: proto.id,
            versionNumber: ver.versionNumber,
            versionLabel: ver.versionLabel,
            changelog: ver.changelog || "",
            entryFile: ver.entryFile,
            storageDir: ver.storageDir,
            createdAt: ver.createdAt || new Date().toISOString()
          });
        }
      }

      // 3. 导入评论与回复
      for (const cmt of data.comments || []) {
        insertComment.run({
          id: cmt.id,
          prototypeId: cmt.prototypeId,
          versionId: cmt.versionId,
          pagePath: cmt.pagePath || "index.html",
          xPercent: cmt.xPercent,
          yPercent: cmt.yPercent,
          docX: typeof cmt.docX === "number" ? cmt.docX : null,
          docY: typeof cmt.docY === "number" ? cmt.docY : null,
          targetJson: cmt.target ? JSON.stringify(cmt.target) : null,
          content: cmt.content,
          authorJson: JSON.stringify(cmt.author || { name: "成员", avatar: "avatar-1" }),
          status: cmt.status || "open",
          createdAt: cmt.createdAt || new Date().toISOString(),
          updatedAt: cmt.updatedAt || new Date().toISOString()
        });

        for (const rep of cmt.replies || []) {
          insertReply.run({
            id: rep.id,
            commentId: cmt.id,
            content: rep.content,
            authorJson: JSON.stringify(rep.author || { name: "成员", avatar: "avatar-1" }),
            createdAt: rep.createdAt || new Date().toISOString()
          });
        }
      }
    });

    migrateTx();
    console.log("[SQLite] Legacy data migration completed successfully!");
  }

  // Projects
  public getProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  public getProjectById(id: string): Project | undefined {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  public saveProject(project: Project): Project {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at)
      VALUES (@id, @name, @description, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        updated_at = excluded.updated_at
    `);
    stmt.run({
      id: project.id,
      name: project.name,
      description: project.description || "",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    });
    return project;
  }

  public deleteProject(id: string): boolean {
    const tx = this.db.transaction(() => {
      // 软删除关联的原型
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE prototypes
        SET is_deleted = 1, deleted_at = ?
        WHERE project_id = ? AND is_deleted = 0
      `).run(now, id);

      const res = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      return res.changes > 0;
    });
    return tx();
  }

  // Prototypes
  public getPrototypes(projectId?: string, includeDeleted = false): Prototype[] {
    let sql = "SELECT * FROM prototypes WHERE is_deleted = ?";
    const params: any[] = [includeDeleted ? 1 : 0];

    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }

    sql += " ORDER BY created_at DESC";

    const protoRows = this.db.prepare(sql).all(...params) as any[];
    if (protoRows.length === 0) return [];

    const versionStmt = this.db.prepare(
      "SELECT * FROM prototype_versions WHERE prototype_id = ? ORDER BY version_number DESC"
    );

    return protoRows.map((r) => {
      const vRows = versionStmt.all(r.id) as any[];
      return {
        id: r.id,
        projectId: r.project_id,
        name: r.name,
        description: r.description,
        currentVersionId: r.current_version_id,
        isDeleted: Boolean(r.is_deleted),
        deletedAt: r.deleted_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        versions: vRows.map((v) => ({
          id: v.id,
          versionNumber: v.version_number,
          versionLabel: v.version_label,
          changelog: v.changelog,
          entryFile: v.entry_file,
          storageDir: v.storage_dir,
          createdAt: v.created_at
        }))
      };
    });
  }

  public getPrototypeById(id: string): Prototype | undefined {
    const r = this.db.prepare("SELECT * FROM prototypes WHERE id = ?").get(id) as any;
    if (!r) return undefined;

    const vRows = this.db
      .prepare("SELECT * FROM prototype_versions WHERE prototype_id = ? ORDER BY version_number DESC")
      .all(r.id) as any[];

    return {
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      description: r.description,
      currentVersionId: r.current_version_id,
      isDeleted: Boolean(r.is_deleted),
      deletedAt: r.deleted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      versions: vRows.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        versionLabel: v.version_label,
        changelog: v.changelog,
        entryFile: v.entry_file,
        storageDir: v.storage_dir,
        createdAt: v.created_at
      }))
    };
  }

  public savePrototype(proto: Prototype): Prototype {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO prototypes (
          id, project_id, name, description, current_version_id, is_deleted, deleted_at, created_at, updated_at
        ) VALUES (
          @id, @projectId, @name, @description, @currentVersionId, @isDeleted, @deletedAt, @createdAt, @updatedAt
        ) ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          current_version_id = excluded.current_version_id,
          is_deleted = excluded.is_deleted,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
      `).run({
        id: proto.id,
        projectId: proto.projectId,
        name: proto.name,
        description: proto.description || "",
        currentVersionId: proto.currentVersionId,
        isDeleted: proto.isDeleted ? 1 : 0,
        deletedAt: proto.deletedAt || null,
        createdAt: proto.createdAt,
        updatedAt: proto.updatedAt
      });

      const verStmt = this.db.prepare(`
        INSERT INTO prototype_versions (
          id, prototype_id, version_number, version_label, changelog, entry_file, storage_dir, created_at
        ) VALUES (
          @id, @prototypeId, @versionNumber, @versionLabel, @changelog, @entryFile, @storageDir, @createdAt
        ) ON CONFLICT(id) DO UPDATE SET
          version_number = excluded.version_number,
          version_label = excluded.version_label,
          changelog = excluded.changelog,
          entry_file = excluded.entry_file,
          storage_dir = excluded.storage_dir
      `);

      for (const ver of proto.versions || []) {
        verStmt.run({
          id: ver.id,
          prototypeId: proto.id,
          versionNumber: ver.versionNumber,
          versionLabel: ver.versionLabel,
          changelog: ver.changelog || "",
          entryFile: ver.entryFile,
          storageDir: ver.storageDir,
          createdAt: ver.createdAt
        });
      }
    });

    tx();
    return proto;
  }

  public permanentDeletePrototype(id: string): boolean {
    const tx = this.db.transaction(() => {
      // 级联清理该原型关联的所有评论与回复
      this.db.prepare(`
        DELETE FROM comment_replies WHERE comment_id IN (
          SELECT id FROM comments WHERE prototype_id = ?
        )
      `).run(id);

      this.db.prepare("DELETE FROM comments WHERE prototype_id = ?").run(id);
      this.db.prepare("DELETE FROM prototype_versions WHERE prototype_id = ?").run(id);
      const res = this.db.prepare("DELETE FROM prototypes WHERE id = ?").run(id);
      return res.changes > 0;
    });

    return tx();
  }

  // Comments
  public getComments(prototypeId: string, versionId?: string): Comment[] {
    let sql = "SELECT * FROM comments WHERE prototype_id = ?";
    const params: any[] = [prototypeId];

    if (versionId) {
      sql += " AND version_id = ?";
      params.push(versionId);
    }

    // 严格按时间戳升序排序，最早创建的批注编号为 1
    sql += " ORDER BY created_at ASC";

    const cmtRows = this.db.prepare(sql).all(...params) as any[];
    if (cmtRows.length === 0) return [];

    const replyStmt = this.db.prepare(
      "SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY created_at ASC"
    );

    return cmtRows.map((r) => {
      const repRows = replyStmt.all(r.id) as any[];
      return {
        id: r.id,
        prototypeId: r.prototype_id,
        versionId: r.version_id,
        pagePath: r.page_path,
        xPercent: r.x_percent,
        yPercent: r.y_percent,
        docX: r.doc_x ?? undefined,
        docY: r.doc_y ?? undefined,
        target: r.target_json ? JSON.parse(r.target_json) : undefined,
        content: r.content,
        author: JSON.parse(r.author_json),
        status: r.status,
        replies: repRows.map((rep) => ({
          id: rep.id,
          commentId: rep.comment_id,
          content: rep.content,
          author: JSON.parse(rep.author_json),
          createdAt: rep.created_at
        })),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    });
  }

  public getCommentById(id: string): Comment | undefined {
    const r = this.db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as any;
    if (!r) return undefined;

    const repRows = this.db
      .prepare("SELECT * FROM comment_replies WHERE comment_id = ? ORDER BY created_at ASC")
      .all(r.id) as any[];

    return {
      id: r.id,
      prototypeId: r.prototype_id,
      versionId: r.version_id,
      pagePath: r.page_path,
      xPercent: r.x_percent,
      yPercent: r.y_percent,
      docX: r.doc_x ?? undefined,
      docY: r.doc_y ?? undefined,
      target: r.target_json ? JSON.parse(r.target_json) : undefined,
      content: r.content,
      author: JSON.parse(r.author_json),
      status: r.status,
      replies: repRows.map((rep) => ({
        id: rep.id,
        commentId: rep.comment_id,
        content: rep.content,
        author: JSON.parse(rep.author_json),
        createdAt: rep.created_at
      })),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  public saveComment(comment: Comment): Comment {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO comments (
          id, prototype_id, version_id, page_path, x_percent, y_percent, doc_x, doc_y,
          target_json, content, author_json, status, created_at, updated_at
        ) VALUES (
          @id, @prototypeId, @versionId, @pagePath, @xPercent, @yPercent, @docX, @docY,
          @targetJson, @content, @authorJson, @status, @createdAt, @updatedAt
        ) ON CONFLICT(id) DO UPDATE SET
          page_path = excluded.page_path,
          x_percent = excluded.x_percent,
          y_percent = excluded.y_percent,
          doc_x = excluded.doc_x,
          doc_y = excluded.doc_y,
          target_json = excluded.target_json,
          content = excluded.content,
          status = excluded.status,
          updated_at = excluded.updated_at
      `).run({
        id: comment.id,
        prototypeId: comment.prototypeId,
        versionId: comment.versionId,
        pagePath: comment.pagePath,
        xPercent: comment.xPercent,
        yPercent: comment.yPercent,
        docX: typeof comment.docX === "number" ? comment.docX : null,
        docY: typeof comment.docY === "number" ? comment.docY : null,
        targetJson: comment.target ? JSON.stringify(comment.target) : null,
        content: comment.content,
        authorJson: JSON.stringify(comment.author),
        status: comment.status,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
      });

      const replyStmt = this.db.prepare(`
        INSERT INTO comment_replies (id, comment_id, content, author_json, created_at)
        VALUES (@id, @commentId, @content, @authorJson, @createdAt)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content
      `);

      for (const rep of comment.replies || []) {
        replyStmt.run({
          id: rep.id,
          commentId: comment.id,
          content: rep.content,
          authorJson: JSON.stringify(rep.author),
          createdAt: rep.createdAt
        });
      }
    });

    tx();
    return comment;
  }

  public deleteComment(id: string): boolean {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM comment_replies WHERE comment_id = ?").run(id);
      const res = this.db.prepare("DELETE FROM comments WHERE id = ?").run(id);
      return res.changes > 0;
    });
    return tx();
  }

  // 兼容完整快照导出
  public getData(): WorkbenchData {
    const projects = this.getProjects();
    const prototypes = this.getPrototypes(undefined, false).concat(
      this.getPrototypes(undefined, true)
    );

    const allComments: Comment[] = [];
    for (const proto of prototypes) {
      allComments.push(...this.getComments(proto.id));
    }

    return {
      projects,
      prototypes,
      comments: allComments
    };
  }
}

export const store = new Store();
export { STORAGE_DIR };
