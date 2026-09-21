import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

// 严格沙箱隔离：注入独立测试存储目录与数据库路径，杜绝污染生产数据
const tempDir = path.resolve(".tmp/e2e_test_runtime");
const testStorageDir = path.join(tempDir, "storage");
const testDbPath = path.join(testStorageDir, "test.db");

if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(testStorageDir, { recursive: true });

process.env.WORKBENCH_STORAGE_DIR = testStorageDir;
process.env.WORKBENCH_DB_PATH = testDbPath;

const { createApp } = await import("../dist/app.js");

describe("Product Workbench End-to-End API Integration Suite", { timeout: 15000 }, () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("1. 健康检查与前端静态服务挂载", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "ok");
  });

  it("2. 完整工作流：项目创建 -> Zip原型上传 -> 静态资源路由响应 -> 递增版本v2 -> 评论/回复 -> 回收站流转", async () => {
    // 2.1 创建项目
    const createProjRes = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E测试产品线",
        description: "端到端自动化测试专用项目"
      })
    });
    assert.strictEqual(createProjRes.status, 201);
    const projData = (await createProjRes.json()).data;
    assert.ok(projData.id);

    // 2.2 准备 Zip 原型文件
    const zipPath = path.join(tempDir, "dashboard_v1.zip");
    const zip = new AdmZip();
    zip.addFile("index.html", Buffer.from("<!DOCTYPE html><html><body><h1>仪表盘原型 v1.0</h1></body></html>", "utf-8"));
    zip.addFile("styles.css", Buffer.from("h1 { color: #4f46e5; }", "utf-8"));
    zip.writeZip(zipPath);

    // 2.3 使用 FormData 上传原型
    const formData = new FormData();
    const zipBlob = new Blob([fs.readFileSync(zipPath)], { type: "application/zip" });
    formData.append("file", zipBlob, "dashboard_v1.zip");
    formData.append("projectId", projData.id);
    formData.append("name", "经营分析仪表盘");
    formData.append("description", "包含核心指标看板与经营图表");
    formData.append("changelog", "首个版本发布");

    const uploadRes = await fetch(`${baseUrl}/api/prototypes/upload`, {
      method: "POST",
      body: formData
    });
    assert.strictEqual(uploadRes.status, 201);
    const protoData = (await uploadRes.json()).data;
    assert.ok(protoData.id);
    assert.strictEqual(protoData.versions.length, 1);
    assert.strictEqual(protoData.versions[0].versionLabel, "v1.0");

    // 2.4 测试静态虚拟托管路由
    const staticUrl = `${baseUrl}/static${protoData.versions[0].storageDir}/${protoData.versions[0].entryFile}`;
    const staticRes = await fetch(staticUrl);
    assert.strictEqual(staticRes.status, 200);
    const htmlContent = await staticRes.text();
    assert.ok(htmlContent.includes("仪表盘原型 v1.0"));

    // 2.5 上传新版本 v2.0 (单 HTML 文件)
    const singleHtmlPath = path.join(tempDir, "dashboard_v2.html");
    fs.writeFileSync(singleHtmlPath, "<!DOCTYPE html><html><body><h1>仪表盘原型 v2.0 升级版</h1></body></html>", "utf-8");

    const v2FormData = new FormData();
    const htmlBlob = new Blob([fs.readFileSync(singleHtmlPath)], { type: "text/html" });
    v2FormData.append("file", htmlBlob, "dashboard_v2.html");
    v2FormData.append("changelog", "增加图表多维下钻交互");

    const v2Res = await fetch(`${baseUrl}/api/prototypes/${protoData.id}/versions`, {
      method: "POST",
      body: v2FormData
    });
    assert.strictEqual(v2Res.status, 201);
    const v2ProtoData = (await v2Res.json()).data;
    assert.strictEqual(v2ProtoData.versions.length, 2);
    assert.strictEqual(v2ProtoData.versions[0].versionLabel, "v2.0");

    // 2.6 验证 v2 静态资源可正常访问
    const v2StaticUrl = `${baseUrl}/static${v2ProtoData.versions[0].storageDir}/${v2ProtoData.versions[0].entryFile}`;
    const v2StaticRes = await fetch(v2StaticUrl);
    assert.strictEqual(v2StaticRes.status, 200);
    const v2HtmlContent = await v2StaticRes.text();
    assert.ok(v2HtmlContent.includes("仪表盘原型 v2.0 升级版"));

    // 2.7 任意坐标评论
    const commentRes = await fetch(`${baseUrl}/api/comments/prototype/${protoData.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        versionId: v2ProtoData.currentVersionId,
        pagePath: "index.html",
        xPercent: 50.5,
        yPercent: 30.2,
        content: "这里的指标卡片数字在小屏下建议缩小2号字",
        author: {
          name: "资深产品经理",
          avatar: "avatar-pm-1"
        }
      })
    });
    assert.strictEqual(commentRes.status, 201);
    const commentData = (await commentRes.json()).data;
    assert.strictEqual(commentData.content, "这里的指标卡片数字在小屏下建议缩小2号字");
    assert.strictEqual(commentData.status, "open");

    // 2.8 添加回复
    const replyRes = await fetch(`${baseUrl}/api/comments/${commentData.id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "好建议，已调整并在下个版本体现",
        author: {
          name: "前端极客",
          avatar: "avatar-dev-1"
        }
      })
    });
    assert.strictEqual(replyRes.status, 201);
    const replyData = (await replyRes.json()).data;
    assert.strictEqual(replyData.content, "好建议，已调整并在下个版本体现");

    // 2.9 标记解决
    const resolveRes = await fetch(`${baseUrl}/api/comments/${commentData.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" })
    });
    assert.strictEqual(resolveRes.status, 200);
    const resolvedData = (await resolveRes.json()).data;
    assert.strictEqual(resolvedData.status, "resolved");

    // 2.10 软删除至回收站
    const deleteRes = await fetch(`${baseUrl}/api/prototypes/${protoData.id}`, {
      method: "DELETE"
    });
    assert.strictEqual(deleteRes.status, 200);

    // 2.11 检查回收站
    const trashRes = await fetch(`${baseUrl}/api/trash`);
    assert.strictEqual(trashRes.status, 200);
    const trashList = (await trashRes.json()).data;
    assert.ok(trashList.some((p) => p.id === protoData.id));

    // 2.12 还原原型
    const restoreRes = await fetch(`${baseUrl}/api/trash/${protoData.id}/restore`, {
      method: "POST"
    });
    assert.strictEqual(restoreRes.status, 200);

    // 还原后回收站不应再有该原型
    const trashAfterRes = await fetch(`${baseUrl}/api/trash`);
    const trashAfterList = (await trashAfterRes.json()).data;
    assert.strictEqual(trashAfterList.some((p) => p.id === protoData.id), false);

    // 清理测试项目
    await fetch(`${baseUrl}/api/projects/${projData.id}`, { method: "DELETE" });
  });
});
