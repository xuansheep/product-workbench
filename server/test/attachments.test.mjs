import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { fetch, FormData, File } from "undici";

// 严格沙箱隔离：独立存储目录 + 独立数据文件，杜绝污染生产数据
const tempDir = path.resolve(".tmp/attachments_test_runtime");
const testStorageDir = path.join(tempDir, "storage");
const testDataPath = path.join(testStorageDir, "data.json");

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(testStorageDir, { recursive: true });

process.env.WORKBENCH_STORAGE_DIR = testStorageDir;
process.env.WORKBENCH_DATA_PATH = testDataPath;
// 把上限压到 1KB，用几十字节的样本就能覆盖超限分支，不必真的分配 20MB
process.env.WORKBENCH_ATTACHMENT_MAX_SIZE = "1024";

const { createApp } = await import("../dist/app.js");

// 1x1 透明 PNG，70 字节左右
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("Attachment API End-to-End Suite", { timeout: 15000 }, () => {
  let server;
  let baseUrl;
  let projectId;
  let protoId;

  const attachmentDirOf = (id) => path.join(testStorageDir, "attachments", id);

  const postAttachment = (fields, file) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.append(key, value);
    }
    if (file) {
      formData.append("file", new File([file.content], file.name, { type: file.type }));
    }
    return fetch(`${baseUrl}/api/attachments/prototype/${protoId}`, { method: "POST", body: formData });
  };

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    // 前置：建项目 + 上传一个原型，附件必须挂在真实原型上
    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "附件测试项目", description: "附件端到端测试" })
    });
    projectId = (await projRes.json()).data.id;

    const zipPath = path.join(tempDir, "proto.zip");
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<h1>附件测试原型</h1>", "utf-8"));
    zip.writeZip(zipPath);

    const formData = new FormData();
    formData.append("file", new File([fs.readFileSync(zipPath)], "proto.zip", { type: "application/zip" }));
    formData.append("projectId", projectId);
    formData.append("name", "附件测试原型");

    const uploadRes = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: formData });
    protoId = (await uploadRes.json()).data.id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("1. 链接附件：名称留空时回退为链接地址", async () => {
    const res = await postAttachment({ type: "url", name: "", url: "https://example.com/spec" });
    assert.strictEqual(res.status, 201);
    const att = (await res.json()).data;

    assert.strictEqual(att.type, "url");
    assert.strictEqual(att.name, "https://example.com/spec");
    assert.strictEqual(att.url, "https://example.com/spec");
    assert.strictEqual(att.previewable, false);
    assert.strictEqual(att.rawUrl, undefined);

    // 自定义名称应被保留
    const named = await postAttachment({ type: "url", name: "  竞品参考  ", url: "https://example.com/ref" });
    assert.strictEqual((await named.json()).data.name, "竞品参考");
  });

  it("2. 危险协议与非 http 地址必须被拒绝", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<h1>x</h1>", "file:///etc/passwd", "不是链接"]) {
      const res = await postAttachment({ type: "url", name: "x", url });
      assert.strictEqual(res.status, 400, `${url} 应被拒绝`);
    }
  });

  it("3. 文件附件：可预览类型走 inline 且响应头带 nosniff", async () => {
    const res = await postAttachment({ type: "file", name: "", url: "" }, {
      content: PNG_BYTES,
      name: "标注图.png",
      type: "image/png"
    });
    assert.strictEqual(res.status, 201);
    const att = (await res.json()).data;

    assert.strictEqual(att.type, "file");
    assert.strictEqual(att.fileName, "标注图.png");
    assert.strictEqual(att.mimeType, "image/png");
    assert.strictEqual(att.size, PNG_BYTES.length);
    assert.strictEqual(att.previewable, true);
    assert.strictEqual(att.rawUrl, `/api/attachments/${att.id}/raw`);

    const rawRes = await fetch(`${baseUrl}${att.rawUrl}`);
    assert.strictEqual(rawRes.status, 200);
    assert.strictEqual(rawRes.headers.get("content-type"), "image/png");
    assert.ok(rawRes.headers.get("content-disposition").startsWith("inline"));
    assert.strictEqual(rawRes.headers.get("x-content-type-options"), "nosniff");
    assert.ok(rawRes.headers.get("content-security-policy").includes("default-src 'none'"));
    assert.strictEqual((await rawRes.arrayBuffer()).byteLength, PNG_BYTES.length);
  });

  it("4. 不可预览类型走下载，且伪装成图片的 HTML 不会被当网页返回", async () => {
    const txtRes = await postAttachment({ type: "file", name: "说明文本", url: "" }, {
      content: Buffer.from("纯文本内容", "utf-8"),
      name: "说明.txt",
      type: "text/plain"
    });
    const txtAtt = (await txtRes.json()).data;
    assert.strictEqual(txtAtt.previewable, true);
    const txtRaw = await fetch(`${baseUrl}${txtAtt.rawUrl}`);
    assert.strictEqual(txtRaw.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.ok(txtRaw.headers.get("content-disposition").startsWith("inline"));

    // .zip 走下载
    const zipRes = await postAttachment({ type: "file", name: "打包材料", url: "" }, {
      content: Buffer.from("PK\u0003\u0004 fake zip", "binary"),
      name: "materials.zip",
      type: "application/zip"
    });
    const zipAtt = (await zipRes.json()).data;
    assert.strictEqual(zipAtt.previewable, false);
    const zipRaw = await fetch(`${baseUrl}${zipAtt.rawUrl}`);
    assert.strictEqual(zipRaw.headers.get("content-type"), "application/octet-stream");
    assert.ok(zipRaw.headers.get("content-disposition").startsWith("attachment"));
    // 中文名称必须走 RFC 5987
    assert.ok(zipRaw.headers.get("content-disposition").includes("filename*=UTF-8''"));

    // 客户端谎称是 png，实际是 HTML：仍按扩展名推导，绝不以 text/html 返回
    const evilRes = await postAttachment({ type: "file", name: "伪装文件", url: "" }, {
      content: Buffer.from("<script>alert(1)</script>", "utf-8"),
      name: "evil.html",
      type: "image/png"
    });
    const evilAtt = (await evilRes.json()).data;
    assert.strictEqual(evilAtt.mimeType, "application/octet-stream");
    const evilRaw = await fetch(`${baseUrl}${evilAtt.rawUrl}`);
    assert.strictEqual(evilRaw.headers.get("content-type"), "application/octet-stream");
    assert.ok(evilRaw.headers.get("content-disposition").startsWith("attachment"));
  });

  it("5. 超过上限的文件返回 413 且响应体是 JSON", async () => {
    const res = await postAttachment({ type: "file", name: "超大文件", url: "" }, {
      content: Buffer.alloc(2048, 1),
      name: "big.bin",
      type: "application/octet-stream"
    });
    assert.strictEqual(res.status, 413);
    // 前端 request() 直接 res.json()，这里必须是 JSON 而不是 express 默认的 HTML 错误页
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.ok(body.message.includes("不能超过"));
    // 临时文件不应残留
    const tempUploads = path.join(testStorageDir, ".temp_uploads");
    const leftovers = fs.existsSync(tempUploads) ? fs.readdirSync(tempUploads) : [];
    assert.deepStrictEqual(leftovers, []);
  });

  it("6. 参数非法时必须被拒绝", async () => {
    // 文件类型却没带文件
    assert.strictEqual((await postAttachment({ type: "file", name: "x", url: "" })).status, 400);
    // 链接类型却带了文件
    const withFile = await postAttachment({ type: "url", name: "x", url: "https://example.com" }, {
      content: PNG_BYTES,
      name: "a.png",
      type: "image/png"
    });
    assert.strictEqual(withFile.status, 400);
    // 空文件
    const empty = await postAttachment({ type: "file", name: "x", url: "" }, {
      content: Buffer.alloc(0),
      name: "empty.txt",
      type: "text/plain"
    });
    assert.strictEqual(empty.status, 400);
    // 类型非法
    assert.strictEqual((await postAttachment({ type: "other", name: "x", url: "" })).status, 400);
    // 不存在的原型
    const ghost = await fetch(`${baseUrl}/api/attachments/prototype/proto-not-exist`, {
      method: "POST",
      body: new FormData()
    });
    assert.strictEqual(ghost.status, 404);
  });

  it("7. 项目级与原型级列表接口", async () => {
    const byProto = await fetch(`${baseUrl}/api/attachments/prototype/${protoId}`);
    const byProtoList = (await byProto.json()).data;
    assert.ok(byProtoList.length >= 4);
    assert.ok(byProtoList.every((a) => a.prototypeId === protoId));

    const byProject = await fetch(`${baseUrl}/api/attachments/project/${projectId}`);
    const byProjectList = (await byProject.json()).data;
    assert.strictEqual(byProjectList.length, byProtoList.length);

    // 不存在的项目返回空列表而不是报错
    const emptyRes = await fetch(`${baseUrl}/api/attachments/project/proj-not-exist`);
    assert.strictEqual(emptyRes.status, 200);
    assert.deepStrictEqual((await emptyRes.json()).data, []);
  });

  it("8. 删除附件会同时清掉记录与磁盘目录", async () => {
    const created = (await (
      await postAttachment({ type: "file", name: "待删除", url: "" }, {
        content: PNG_BYTES,
        name: "del.png",
        type: "image/png"
      })
    ).json()).data;

    assert.ok(fs.existsSync(attachmentDirOf(created.id)));

    const delRes = await fetch(`${baseUrl}/api/attachments/${created.id}`, { method: "DELETE" });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(fs.existsSync(attachmentDirOf(created.id)), false);
    assert.strictEqual((await fetch(`${baseUrl}${created.rawUrl}`)).status, 404);

    // 重复删除与非法 id 都返回 404
    assert.strictEqual((await fetch(`${baseUrl}/api/attachments/${created.id}`, { method: "DELETE" })).status, 404);
    assert.strictEqual((await fetch(`${baseUrl}/api/attachments/..%2F..%2Fdata.json`, { method: "DELETE" })).status, 404);
  });

  it("9. 彻底删除原型会级联清理附件记录与磁盘文件", async () => {
    const created = (await (
      await postAttachment({ type: "file", name: "级联清理", url: "" }, {
        content: PNG_BYTES,
        name: "cascade.png",
        type: "image/png"
      })
    ).json()).data;
    assert.ok(fs.existsSync(attachmentDirOf(created.id)));

    await fetch(`${baseUrl}/api/prototypes/${protoId}`, { method: "DELETE" });
    assert.ok((await (await fetch(`${baseUrl}/api/trash`)).json()).data.some((p) => p.id === protoId));
    // 软删除阶段附件应保留，还原后仍可用
    assert.ok((await (await fetch(`${baseUrl}/api/attachments/prototype/${protoId}`)).json()).data.length > 0);

    const permanentRes = await fetch(`${baseUrl}/api/trash/${protoId}/permanent`, { method: "DELETE" });
    assert.strictEqual(permanentRes.status, 200);

    assert.strictEqual(fs.existsSync(attachmentDirOf(created.id)), false);
    assert.deepStrictEqual((await (await fetch(`${baseUrl}/api/attachments/project/${projectId}`)).json()).data, []);
  });
});
