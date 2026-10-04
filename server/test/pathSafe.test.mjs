import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const { assertInsideBase, isJunkPath, normalizeRelativePath, commonRootSegment } = await import(
  "../dist/utils/pathSafe.js"
);

const base = path.resolve(".tmp/pathsafe_runtime/prototypes/p1/v1");
fs.mkdirSync(base, { recursive: true });

describe("PathSafe 路径守卫与垃圾过滤", { timeout: 10000 }, () => {
  it("1. 拒绝 .. 遍历（含 v1evil 前缀歧义）", () => {
    // 目标目录以 v1 结尾时，../v1evil/x 会被「纯字符串前缀」判断误放行
    assert.throws(() => assertInsideBase(base, "../v1evil/x.html"));
    assert.throws(() => assertInsideBase(base, "../../evil.html"));
    assert.throws(() => assertInsideBase(base, "a/../../evil.html"));
  });

  it("2. 拒绝绝对路径与 Windows 盘符", () => {
    assert.throws(() => assertInsideBase(base, "/etc/passwd"));
    // darwin 上 path.isAbsolute("C:\\x") 返回 false，盘符必须靠显式正则拦截
    assert.throws(() => assertInsideBase(base, "C:\\Windows\\evil.dll"));
  });

  it("3. 拒绝空路径与空段", () => {
    assert.throws(() => assertInsideBase(base, ""));
    assert.throws(() => assertInsideBase(base, "a//b.css"));
  });

  it("4. 合法相对路径解析为 base 内的绝对路径", () => {
    assert.strictEqual(assertInsideBase(base, "assets/a.css"), path.join(base, "assets/a.css"));
    // zip 的目录条目带尾斜杠，属合法条目不能拒
    assert.strictEqual(assertInsideBase(base, "assets/"), path.join(base, "assets"));
    // . 段由 resolve 折叠，逃不出去
    assert.strictEqual(assertInsideBase(base, "./a/./b.html"), path.join(base, "a/b.html"));
    // 反斜杠条目按 / 归一
    assert.strictEqual(assertInsideBase(base, "css\\app.css"), path.join(base, "css/app.css"));
    assert.strictEqual(normalizeRelativePath("css/app.css"), "css/app.css");
  });

  it("5. 系统垃圾条目识别", () => {
    assert.strictEqual(isJunkPath("__MACOSX/._index.html"), true);
    // __MACOSX 按任意一段命中即丢，要连带其下全部内容
    assert.strictEqual(isJunkPath("myproto/assets/__MACOSX/x.png"), true);
    assert.strictEqual(isJunkPath("myproto/.DS_Store"), true);
    assert.strictEqual(isJunkPath("myproto/Thumbs.db"), true);
    assert.strictEqual(isJunkPath("myproto/desktop.ini"), true);

    assert.strictEqual(isJunkPath("myproto/index.html"), false);
    // 只是名字里含 DS_Store，不是系统文件
    assert.strictEqual(isJunkPath("myproto/DS_Store.png"), false);
  });

  it("6. 公共根目录判定", () => {
    assert.strictEqual(commonRootSegment(["myproto/a.html", "myproto/css/b.css"]), "myproto");
    // 首段不一致时不剥离
    assert.strictEqual(commonRootSegment(["a/x.html", "b/y.html"]), null);
    // 单段路径剥完就没内容了，不能当根目录
    assert.strictEqual(commonRootSegment(["only.html"]), null);
    assert.strictEqual(commonRootSegment([]), null);
  });
});
