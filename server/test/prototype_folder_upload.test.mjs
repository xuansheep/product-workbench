import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
// 显式依赖 undici：Node 16 没有全局 fetch/FormData/File，固定同一份实现可跨版本行为一致
import { fetch, FormData, File } from "undici";

// 严格沙箱隔离：注入独立测试存储目录与数据文件路径，杜绝污染生产数据
const tempDir = path.resolve(".tmp/prototype_folder_runtime");
const testStorageDir = path.join(tempDir, "storage");
const testDataPath = path.join(testStorageDir, "data.json");

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(testStorageDir, { recursive: true });

process.env.WORKBENCH_STORAGE_DIR = testStorageDir;
process.env.WORKBENCH_DATA_PATH = testDataPath;

const { createApp } = await import("../dist/app.js");

const prototypesDir = path.join(testStorageDir, "prototypes");
const tempUploadsDir = path.join(testStorageDir, ".temp_uploads");

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe("原型文件夹 / 多文件上传", { timeout: 20000 }, () => {
  let server;
  let baseUrl;
  let projectId;

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });

    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "文件夹上传测试项目", description: "端到端测试专用" })
    });
    projectId = (await res.json()).data.id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  /** files 形如 { "myproto/index.html": "<h1>x</h1>" }，键即客户端要传的相对路径 */
  function folderForm(files, fields = {}) {
    const form = new FormData();
    for (const [relativePath, content] of Object.entries(files)) {
      form.append("files", new File([Buffer.from(content, "utf-8")], relativePath), relativePath);
    }
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    return form;
  }

  async function uploadFolder(files, fields = {}) {
    const res = await fetch(`${baseUrl}/api/prototypes/upload`, {
      method: "POST",
      body: folderForm(files, { projectId, ...fields })
    });
    return { status: res.status, body: await res.json() };
  }

  async function uploadSingle(fileName, content, fields = {}) {
    const form = new FormData();
    form.append("file", new File([Buffer.from(content, "utf-8")], fileName), fileName);
    form.append("projectId", projectId);
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    const res = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: form });
    return { status: res.status, body: await res.json() };
  }

  it("1. 单根文件夹上传会剥掉最外层目录，且静态资源可访问", async () => {
    const { status, body } = await uploadFolder(
      {
        "myproto/index.html": "<!DOCTYPE html><html><body><h1>首页</h1></body></html>",
        "myproto/css/a.css": "h1 { color: red; }",
        "myproto/js/app.js": "console.log(1);"
      },
      { name: "剥根测试" }
    );

    assert.strictEqual(status, 201);
    const proto = body.data;
    const versionDir = path.join(prototypesDir, proto.id, "v1");

    assert.strictEqual(proto.versions[0].entryFile, "index.html");
    assert.ok(!fs.existsSync(path.join(versionDir, "myproto")), "最外层目录应被剥离");
    assert.ok(fs.existsSync(path.join(versionDir, "index.html")));
    assert.ok(fs.existsSync(path.join(versionDir, "css/a.css")));
    assert.ok(fs.existsSync(path.join(versionDir, "js/app.js")));

    // 静态托管能取到入口与相对资源
    const htmlRes = await fetch(`${baseUrl}/static/prototypes/${proto.id}/v1/index.html`);
    assert.strictEqual(htmlRes.status, 200);
    const cssRes = await fetch(`${baseUrl}/static/prototypes/${proto.id}/v1/css/a.css`);
    assert.strictEqual(cssRes.status, 200);
  });

  it("2. 多根目录不被剥离", async () => {
    const { status, body } = await uploadFolder({
      "a/index.html": "<h1>a</h1>",
      "b/x.html": "<h1>b</h1>"
    });

    assert.strictEqual(status, 201);
    const versionDir = path.join(prototypesDir, body.data.id, "v1");
    assert.ok(fs.existsSync(path.join(versionDir, "a/index.html")));
    assert.ok(fs.existsSync(path.join(versionDir, "b/x.html")));
  });

  it("3. 中文目录名不乱码，且默认原型名取文件夹名", async () => {
    const { status, body } = await uploadFolder({
      "我的原型/index.html": "<h1>中文</h1>",
      "我的原型/页面/详情.html": "<h1>详情</h1>"
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.data.name, "我的原型");
    const versionDir = path.join(prototypesDir, body.data.id, "v1");
    assert.ok(fs.existsSync(path.join(versionDir, "index.html")));
    assert.ok(fs.existsSync(path.join(versionDir, "页面/详情.html")));
  });

  it("4. 系统垃圾文件被过滤，且先过滤再剥根（__MACOSX 不能污染首段判定）", async () => {
    const { status, body } = await uploadFolder({
      "myproto/index.html": "<h1>ok</h1>",
      "myproto/.DS_Store": "junk",
      "myproto/Thumbs.db": "junk",
      "myproto/desktop.ini": "junk",
      "myproto/assets/__MACOSX/x.png": "junk",
      // 顶层 __MACOSX：若不过滤就先求公共首段，myproto 会被判成与它不同根而拒绝剥离
      "__MACOSX/._index.html": "junk"
    });

    assert.strictEqual(status, 201);
    const versionDir = path.join(prototypesDir, body.data.id, "v1");

    assert.ok(!fs.existsSync(path.join(versionDir, "__MACOSX")));
    assert.strictEqual(body.data.versions[0].entryFile, "index.html");
    assert.ok(fs.existsSync(path.join(versionDir, "index.html")), "过滤后仍应正确剥根");
    assert.ok(!fs.existsSync(path.join(versionDir, "myproto")));
    assert.ok(!fs.existsSync(path.join(versionDir, ".DS_Store")));
    assert.ok(!fs.existsSync(path.join(versionDir, "Thumbs.db")));
    assert.ok(!fs.existsSync(path.join(versionDir, "desktop.ini")));
    // myproto/assets 下只剩 __MACOSX，整个目录都不该被建出来
    assert.ok(!fs.existsSync(path.join(versionDir, "assets")));
  });

  it("5. 路径穿越条目被拒绝，且失败后不留孤儿目录与临时文件", async () => {
    const beforeProtos = listDir(prototypesDir).length;

    const { status } = await uploadFolder({ "../evil.html": "<h1>evil</h1>" });

    assert.ok(status >= 400, `期望被拒绝，实际 ${status}`);
    assert.ok(!fs.existsSync(path.join(testStorageDir, "evil.html")));
    assert.strictEqual(listDir(prototypesDir).length, beforeProtos, "失败后不应留下孤儿目录");
    assert.deepStrictEqual(listDir(tempUploadsDir), [], "multer 临时文件应被清理");
  });

  it("6. 只含垃圾文件的文件夹被拒绝", async () => {
    const beforeProtos = listDir(prototypesDir).length;

    const { status, body } = await uploadFolder({ "myproto/.DS_Store": "junk" });

    assert.strictEqual(status, 400);
    assert.match(body.message, /没有可用的文件/);
    assert.strictEqual(listDir(prototypesDir).length, beforeProtos, "失败后不应留下孤儿目录");
  });

  it("7. 单文件分支只放行 .zip / .html / .htm", async () => {
    const rejected = await uploadSingle("evil.js", "alert(1)");
    assert.strictEqual(rejected.status, 400);
    assert.match(rejected.body.message, /仅支持/);
    assert.ok(!fs.existsSync(path.join(testStorageDir, "evil.js")));

    const accepted = await uploadSingle("single.html", "<h1>单页</h1>", { name: "单页原型" });
    assert.strictEqual(accepted.status, 201);
    assert.strictEqual(accepted.body.data.versions[0].entryFile, "index.html");
  });

  it("8. 单文件的原始名不参与路径拼接，无法逃逸", async () => {
    const { status, body } = await uploadSingle("../../evil.html", "<h1>ok</h1>", { name: "逃逸测试" });

    assert.strictEqual(status, 201);
    assert.ok(fs.existsSync(path.join(prototypesDir, body.data.id, "v1/index.html")));
    assert.ok(!fs.existsSync(path.join(testStorageDir, "evil.html")));
  });

  it("9. file 与 files 同存或都不带都会被拒绝", async () => {
    const both = folderForm({ "p/b.html": "<h1>b</h1>" }, { projectId });
    both.append("file", new File([Buffer.from("<h1>a</h1>", "utf-8")], "a.html"), "a.html");
    const bothRes = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: both });
    assert.strictEqual(bothRes.status, 400);
    assert.match((await bothRes.json()).message, /不能同时提交/);

    const none = new FormData();
    none.append("projectId", projectId);
    const noneRes = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: none });
    assert.strictEqual(noneRes.status, 400);
  });

  it("10. 追加版本同样支持文件夹上传", async () => {
    const created = await uploadFolder({ "v1proto/index.html": "<h1>v1</h1>" }, { name: "版本测试" });
    assert.strictEqual(created.status, 201);
    const protoId = created.body.data.id;

    const res = await fetch(`${baseUrl}/api/prototypes/${protoId}/versions`, {
      method: "POST",
      body: folderForm(
        { "v2proto/index.html": "<h1>v2</h1>", "v2proto/app.js": "var a = 1;" },
        { changelog: "第二版" }
      )
    });

    assert.strictEqual(res.status, 201);
    const proto = (await res.json()).data;
    assert.strictEqual(proto.versions.length, 2);
    assert.strictEqual(proto.versions[0].entryFile, "index.html");

    const v2Dir = path.join(prototypesDir, protoId, "v2");
    assert.ok(fs.existsSync(path.join(v2Dir, "index.html")));
    assert.ok(!fs.existsSync(path.join(v2Dir, "v2proto")));

    const staticRes = await fetch(`${baseUrl}/static/prototypes/${protoId}/v2/index.html`);
    assert.strictEqual(staticRes.status, 200);
  });

  it("11. 上传中断或失败后不留 staging 目录", async () => {
    await uploadFolder({ "x/index.html": "<h1>x</h1>" });

    for (const protoId of listDir(prototypesDir)) {
      const leftovers = listDir(path.join(prototypesDir, protoId)).filter((name) => name.startsWith(".staging-"));
      assert.deepStrictEqual(leftovers, [], `${protoId} 残留 staging 目录`);
    }
  });
});
