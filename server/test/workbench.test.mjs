import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

// 不用 zlib.crc32：那是 Node 20.15+ 才有的 API，本包 engines 声明 >=16.18
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 手工拼一个 stored（不压缩）zip。
 * 存在的唯一理由：adm-zip 的写入路径会归一化条目名，只有自己拼字节才能造出
 * 含 '../' 或前导 '/' 的恶意条目，用于验证解包时的真实防护。
 */
function rawZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, "utf-8");
    const data = Buffer.from(content, "utf-8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size（stored 故等于原长）
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, eocd]);
}

// 严格沙箱隔离：单测使用独立的数据文件与存储目录
const tempDir = path.resolve(".tmp/test_workbench_runtime");
const testStorageDir = path.join(tempDir, "storage");
const testDataPath = path.join(testStorageDir, "data.json");

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(testStorageDir, { recursive: true });

process.env.WORKBENCH_STORAGE_DIR = testStorageDir;
process.env.WORKBENCH_DATA_PATH = testDataPath;

const { store, normalizeWorkbenchData } = await import("../dist/db/store.js");
const { detectEntryFile, extractZipSafely } = await import("../dist/utils/archive.js");
const {
  sanitizeExt,
  normalizeMime,
  isPreviewable,
  normalizeHttpUrl,
  decodeOriginalName,
  resolveAttachmentName,
  contentDisposition
} = await import("../dist/utils/attachment.js");

describe("Product Workbench Backend Core Test Suite", { timeout: 10000 }, () => {
  it("1. 项目管理 CRUD 流程应正常运行", () => {
    const pId = `proj-test-${Date.now()}`;
    const p = store.saveProject({
      id: pId,
      name: "测试管理项目",
      description: "用于单元测试的项目",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    assert.strictEqual(p.id, pId);

    const retrieved = store.getProjectById(pId);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.name, "测试管理项目");

    // 更新
    retrieved.name = "已更名的测试项目";
    store.saveProject(retrieved);
    const updated = store.getProjectById(pId);
    assert.strictEqual(updated?.name, "已更名的测试项目");

    // 删除
    const deleted = store.deleteProject(pId);
    assert.strictEqual(deleted, true);
    assert.strictEqual(store.getProjectById(pId), undefined);
  });

  it("2. 原型解包与入口探测机制", () => {
    const mockDir = path.join(tempDir, "sample_proto");
    fs.mkdirSync(path.join(mockDir, "sub_assets"), { recursive: true });
    fs.writeFileSync(path.join(mockDir, "index.html"), "<html><body>入口测试</body></html>");
    fs.writeFileSync(path.join(mockDir, "sub_assets/style.css"), "body { margin: 0; }");

    const entry = detectEntryFile(mockDir);
    assert.strictEqual(entry, "index.html");

    // 测试无 index.html 时探测首个 html 文件
    const mockDir2 = path.join(tempDir, "sample_proto_no_index");
    fs.mkdirSync(path.join(mockDir2, "pages"), { recursive: true });
    fs.writeFileSync(path.join(mockDir2, "pages/main.html"), "<html><body>主页</body></html>");
    const entry2 = detectEntryFile(mockDir2);
    assert.strictEqual(entry2, "pages/main.html");
  });

  it("3. Zip 安全解包与防逃逸校验", () => {
    const zipPath = path.join(tempDir, "test.zip");
    const extractTarget = path.join(tempDir, "extracted_zip");
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<h1>Hello Zip</h1>", "utf-8"));
    zip.addFile("css/app.css", Buffer.from("h1 { color: red; }", "utf-8"));
    zip.writeZip(zipPath);

    const result = extractZipSafely(fs.readFileSync(zipPath), extractTarget);
    assert.strictEqual(result.entryFile, "index.html");
    assert.ok(fs.existsSync(path.join(extractTarget, "index.html")));
    assert.ok(fs.existsSync(path.join(extractTarget, "css/app.css")));
  });

  it("4. 原型多版本流转及回收站软删除/恢复", () => {
    const protoId = `proto-unit-${Date.now()}`;
    const v1Id = `v1-${Date.now()}`;
    const proto = store.savePrototype({
      id: protoId,
      projectId: "p-sample",
      name: "财务结算大屏原型",
      description: "包含实时流水与多维对账看板",
      currentVersionId: v1Id,
      versions: [
        {
          id: v1Id,
          versionNumber: 1,
          versionLabel: "v1.0",
          changelog: "初始版本",
          entryFile: "index.html",
          storageDir: `/prototypes/${protoId}/v1`,
          createdAt: new Date().toISOString()
        }
      ],
      isDeleted: false,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.strictEqual(proto.versions.length, 1);

    // 追加版本 v2.0
    const v2Id = `v2-${Date.now()}`;
    proto.versions.unshift({
      id: v2Id,
      versionNumber: 2,
      versionLabel: "v2.0",
      changelog: "增加异常工单处理模块",
      entryFile: "index.html",
      storageDir: `/prototypes/${protoId}/v2`,
      createdAt: new Date().toISOString()
    });
    proto.currentVersionId = v2Id;
    store.savePrototype(proto);

    const updated = store.getPrototypeById(protoId);
    assert.strictEqual(updated?.versions.length, 2);
    assert.strictEqual(updated?.currentVersionId, v2Id);

    // 软删除至回收站
    updated.isDeleted = true;
    updated.deletedAt = new Date().toISOString();
    store.savePrototype(updated);

    const activeList = store.getPrototypes("p-sample", false);
    assert.strictEqual(activeList.some((x) => x.id === protoId), false);

    const trashList = store.getPrototypes(undefined, true);
    assert.strictEqual(trashList.some((x) => x.id === protoId), true);

    // 恢复
    updated.isDeleted = false;
    updated.deletedAt = null;
    store.savePrototype(updated);
    const restored = store.getPrototypes("p-sample", false);
    assert.strictEqual(restored.some((x) => x.id === protoId), true);

    // 清理
    store.permanentDeletePrototype(protoId);
    assert.strictEqual(store.getPrototypeById(protoId), undefined);
  });

  it("5. 原型元素吸附、文档坐标批注、回复与解决状态流转", () => {
    const protoId = `proto-cmt-${Date.now()}`;
    const commentId = `cmt-${Date.now()}`;

    const comment = store.saveComment({
      id: commentId,
      prototypeId: protoId,
      versionId: "v1.0",
      pagePath: "dashboard.html#/orders",
      xPercent: 32.5,
      yPercent: 48.2,
      docX: 450,
      docY: 1280,
      target: {
        selector: "#btn-accept-order",
        tagName: "BUTTON",
        innerTextSnippet: "立即接单",
        elementOffsetXPercent: 60,
        elementOffsetYPercent: 50
      },
      content: "接单按钮在小屏下建议增加脉冲提醒动效",
      author: {
        name: "极客产品经理",
        avatar: "avatar-pm-1"
      },
      status: "open",
      replies: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    assert.strictEqual(comment.status, "open");
    assert.strictEqual(comment.pagePath, "dashboard.html#/orders");
    assert.strictEqual(comment.target?.selector, "#btn-accept-order");
    assert.strictEqual(comment.docY, 1280);

    // 添加回复
    comment.replies.push({
      id: `rpl-${Date.now()}`,
      commentId: comment.id,
      content: "收到，已支持吸附跟随",
      author: {
        name: "资深研发",
        avatar: "avatar-dev-1"
      },
      createdAt: new Date().toISOString()
    });
    store.saveComment(comment);

    // 切换状态为 resolved
    comment.status = "resolved";
    store.saveComment(comment);

    const fetched = store.getCommentById(commentId);
    assert.strictEqual(fetched?.status, "resolved");
    assert.strictEqual(fetched?.replies.length, 1);
    assert.strictEqual(fetched?.target?.tagName, "BUTTON");

    // 清理
    store.deleteComment(commentId);
    assert.strictEqual(store.getCommentById(commentId), undefined);
  });

  it("6. 旧数据文件缺 attachments 字段时必须能正常归一化", () => {
    // 这是升级回归风险最高的一条：线上是「老 data.json 能不能启动」，不是「新装能不能启动」
    const legacy = normalizeWorkbenchData({
      projects: [{ id: "p1" }],
      prototypes: [{ id: "proto1" }],
      comments: [{ id: "c1" }]
    });
    assert.deepStrictEqual(legacy.attachments, []);
    assert.strictEqual(legacy.projects.length, 1);

    assert.deepStrictEqual(normalizeWorkbenchData(null).attachments, []);
    assert.deepStrictEqual(normalizeWorkbenchData(undefined).attachments, []);
    assert.deepStrictEqual(normalizeWorkbenchData({}).comments, []);
    // 字段类型损坏时按空数组兜底，避免后续 filter/map 直接抛错
    assert.deepStrictEqual(normalizeWorkbenchData({ attachments: "oops" }).attachments, []);
  });

  it("7. 附件 CRUD 与原型彻底删除时的级联清理", () => {
    const protoA = `proto-att-a-${Date.now()}`;
    const protoB = `proto-att-b-${Date.now()}`;
    for (const id of [protoA, protoB]) {
      store.savePrototype({
        id,
        projectId: `proj-${id}`,
        name: `附件原型 ${id}`,
        description: "",
        currentVersionId: "",
        versions: [],
        isDeleted: false,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    const urlAtt = store.saveAttachment({
      id: `att-url-${Date.now()}`,
      prototypeId: protoA,
      name: "需求文档",
      type: "url",
      url: "https://example.com/spec",
      createdAt: new Date().toISOString()
    });
    const fileAtt = store.saveAttachment({
      id: `att-file-${Date.now()}`,
      prototypeId: protoA,
      name: "标注图.png",
      type: "file",
      fileName: "标注图.png",
      mimeType: "image/png",
      size: 1024,
      createdAt: new Date(Date.now() + 1).toISOString()
    });
    const otherAtt = store.saveAttachment({
      id: `att-other-${Date.now()}`,
      prototypeId: protoB,
      name: "参考链接",
      type: "url",
      url: "https://example.com/ref",
      createdAt: new Date().toISOString()
    });

    assert.strictEqual(store.getAttachmentById(urlAtt.id)?.name, "需求文档");
    // 列表按创建时间倒序，新增的排在前面
    assert.deepStrictEqual(
      store.getAttachmentsByPrototype(protoA).map((a) => a.id),
      [fileAtt.id, urlAtt.id]
    );

    // 彻底删除 protoA 只应清理它自己的附件
    store.permanentDeletePrototype(protoA);
    assert.deepStrictEqual(store.getAttachmentsByPrototype(protoA), []);
    assert.strictEqual(store.getAttachmentById(otherAtt.id)?.id, otherAtt.id);

    assert.strictEqual(store.deleteAttachment(otherAtt.id), true);
    assert.strictEqual(store.deleteAttachment(otherAtt.id), false);
    assert.strictEqual(store.getAttachmentById(otherAtt.id), undefined);
  });

  it("8. 附件工具函数：类型归一化、危险协议拦截与中文文件名响应头", () => {
    // 客户端声明的 MIME 不可信，一律由扩展名推导
    assert.strictEqual(normalizeMime("a.PNG"), "image/png");
    assert.strictEqual(normalizeMime("a.pdf"), "application/pdf");
    assert.strictEqual(normalizeMime("a.svg"), "application/octet-stream");
    assert.strictEqual(normalizeMime("a.html"), "application/octet-stream");
    assert.strictEqual(normalizeMime("noext"), "application/octet-stream");
    assert.strictEqual(sanitizeExt("a.tar.gz"), ".gz");
    assert.strictEqual(sanitizeExt("a.verylongextension"), ".bin");

    // SVG 与 HTML 可在同源下执行脚本，必须走下载而非内联预览
    assert.strictEqual(isPreviewable("image/png"), true);
    assert.strictEqual(isPreviewable("application/pdf"), true);
    assert.strictEqual(isPreviewable("image/svg+xml"), false);
    assert.strictEqual(isPreviewable("text/html"), false);

    assert.strictEqual(normalizeHttpUrl("https://example.com"), "https://example.com/");
    assert.strictEqual(normalizeHttpUrl("javascript:alert(1)"), null);
    assert.strictEqual(normalizeHttpUrl("data:text/html,<script>"), null);
    assert.strictEqual(normalizeHttpUrl("file:///etc/passwd"), null);
    assert.strictEqual(normalizeHttpUrl("不是链接"), null);

    // 名称留空时回退到 url 或原始文件名
    assert.strictEqual(resolveAttachmentName("  ", "https://example.com/"), "https://example.com/");
    assert.strictEqual(resolveAttachmentName(" 标注图 ", "a.png"), "标注图");
    assert.strictEqual(resolveAttachmentName("", "a.png"), "a.png");
    assert.strictEqual(resolveAttachmentName("x".repeat(300), "a.png").length, 200);

    // multer 按 latin1 解码 originalname，中文名需要能还原
    const mojibake = Buffer.from("标注图.png", "utf-8").toString("latin1");
    assert.strictEqual(decodeOriginalName(mojibake), "标注图.png");
    assert.strictEqual(decodeOriginalName("report.pdf"), "report.pdf");

    const header = contentDisposition("attachment", "需求文档.pdf");
    assert.ok(header.startsWith("attachment; filename="));
    assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent("需求文档.pdf")}`));
    // 头部注入防护
    assert.ok(!contentDisposition("attachment", "a\r\nX-Evil: 1").includes("\r"));
  });

  it("9. Zip 里的系统垃圾条目必须被过滤", () => {
    const extractTarget = path.join(tempDir, "extracted_junk");
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<h1>ok</h1>", "utf-8"));
    zip.addFile("__MACOSX/._index.html", Buffer.from("junk", "utf-8"));
    zip.addFile(".DS_Store", Buffer.from("junk", "utf-8"));

    const result = extractZipSafely(zip.toBuffer(), extractTarget);
    assert.strictEqual(result.entryFile, "index.html");
    assert.ok(fs.existsSync(path.join(extractTarget, "index.html")));
    assert.ok(!fs.existsSync(path.join(extractTarget, "__MACOSX")));
    assert.ok(!fs.existsSync(path.join(extractTarget, ".DS_Store")));
  });

  it("10. Zip 穿越条目必须被拒绝（含 v1evil 前缀歧义）", () => {
    // 攻击样本必须手工拼字节：adm-zip 在 addFile/writeZip 阶段就会自行归一化条目名
    // （'../v1evil/x' 会被写成 'v1evil/x'），用它构造的 zip 根本不含穿越条目，
    // 但 adm-zip 在**读取**外部 zip 时原样保留 entryName —— 那才是真实的攻击路径。
    const escapeRoot = path.join(tempDir, "escape_case");
    const escapeTarget = path.join(escapeRoot, "v1");
    fs.mkdirSync(escapeTarget, { recursive: true });

    // 目标目录以 v1 结尾时，../v1evil/x 会被「纯字符串前缀」判断误放行
    assert.throws(() =>
      extractZipSafely(rawZip([["../v1evil/evil.html", "<h1>evil</h1>"]]), escapeTarget)
    );
    assert.ok(!fs.existsSync(path.join(escapeRoot, "v1evil")));

    assert.throws(() => extractZipSafely(rawZip([["/tmp/abs.html", "<h1>abs</h1>"]]), escapeTarget));
    assert.ok(!fs.existsSync("/tmp/abs.html"));
  });
});
