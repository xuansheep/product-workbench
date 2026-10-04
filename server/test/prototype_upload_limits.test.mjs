import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fetch, FormData, File } from "undici";

// 超限分支的小限额必须靠环境变量注入。上限常量是「模块加载时读取」的，
// 所以这个文件不能和正常限额的测试共进程——node --test 默认一文件一进程，天然满足。
process.env.WORKBENCH_PROTOTYPE_FILE_MAX_SIZE = String(1024);
process.env.WORKBENCH_PROTOTYPE_ZIP_MAX_SIZE = String(4096);
process.env.WORKBENCH_PROTOTYPE_MAX_FILES = "3";
process.env.WORKBENCH_PROTOTYPE_TOTAL_MAX_SIZE = String(2048);

const tempDir = path.resolve(".tmp/prototype_limits_runtime");
const testStorageDir = path.join(tempDir, "storage");

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(testStorageDir, { recursive: true });

process.env.WORKBENCH_STORAGE_DIR = testStorageDir;
process.env.WORKBENCH_DATA_PATH = path.join(testStorageDir, "data.json");

const { createApp } = await import("../dist/app.js");

const prototypesDir = path.join(testStorageDir, "prototypes");
const tempUploadsDir = path.join(testStorageDir, ".temp_uploads");

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe("原型上传超限分支", { timeout: 20000 }, () => {
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
      body: JSON.stringify({ name: "超限测试项目" })
    });
    projectId = (await res.json()).data.id;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  /** 响应必须是 JSON —— 前端 request() 无条件 res.json()，拿到 HTML 会抛 SyntaxError */
  async function expectJsonError(res, status, pattern) {
    assert.strictEqual(res.status, status);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.match(body.message, pattern);
    return body;
  }

  it("1. 单个文件超过 zip 上限 → 413 JSON（multer 传输层拦截）", async () => {
    const form = new FormData();
    form.append("projectId", projectId);
    form.append(
      "file",
      new File([Buffer.alloc(5000, "a")], "big.zip"),
      "big.zip"
    );

    const res = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: form });
    await expectJsonError(res, 413, /不能超过/);
    assert.deepStrictEqual(listDir(tempUploadsDir), [], "被拒后不应残留临时文件");
  });

  it("2. 文件夹内单文件超限 → 413 JSON（handler 逐项校验）", async () => {
    const beforeProtos = listDir(prototypesDir).length;

    const form = new FormData();
    form.append("projectId", projectId);
    // 1500B：低于传输层的 4096B，必须由 collectPrototypeUpload 的单文件校验拦下
    form.append("files", new File([Buffer.alloc(1500, "a")], "p/big.js"), "p/big.js");
    form.append("files", new File([Buffer.alloc(10, "a")], "p/index.html"), "p/index.html");

    const res = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: form });
    await expectJsonError(res, 413, /单个文件不能超过/);
    assert.strictEqual(listDir(prototypesDir).length, beforeProtos, "失败后不应留下孤儿目录");
  });

  it("3. 文件夹总量超限 → 413 JSON", async () => {
    const beforeProtos = listDir(prototypesDir).length;

    const form = new FormData();
    form.append("projectId", projectId);
    // 3 × 1000B = 3000B > 2048B，且每个文件与文件数都在各自上限之内
    for (const name of ["p/a.js", "p/b.js", "p/index.html"]) {
      form.append("files", new File([Buffer.alloc(1000, "a")], name), name);
    }

    const res = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: form });
    await expectJsonError(res, 413, /总大小不能超过/);
    assert.strictEqual(listDir(prototypesDir).length, beforeProtos, "失败后不应留下孤儿目录");
  });

  it("4. 文件数超限 → 413 JSON（multer LIMIT_FILE_COUNT）", async () => {
    const beforeProtos = listDir(prototypesDir).length;

    const form = new FormData();
    form.append("projectId", projectId);
    for (let i = 0; i < 4; i += 1) {
      form.append("files", new File([Buffer.alloc(10, "a")], `p/f${i}.js`), `p/f${i}.js`);
    }

    const res = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: form });
    await expectJsonError(res, 413, /文件数量不能超过/);
    assert.strictEqual(listDir(prototypesDir).length, beforeProtos, "失败后不应留下孤儿目录");
  });

  it("5. 未知字段 → 400 JSON（multer LIMIT_UNEXPECTED_FILE）", async () => {
    const form = new FormData();
    form.append("projectId", projectId);
    form.append("attachment", new File([Buffer.alloc(10, "a")], "x.html"), "x.html");

    const res = await fetch(`${baseUrl}/api/prototypes/upload`, { method: "POST", body: form });
    await expectJsonError(res, 400, /上传字段不合法/);
  });
});
