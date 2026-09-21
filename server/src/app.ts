import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_DIR } from "./db/store.js";
import projectsRouter from "./routes/projects.js";
import prototypesRouter from "./routes/prototypes.js";
import commentsRouter from "./routes/comments.js";
import trashRouter from "./routes/trash.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 静态原型文件虚拟托管路由
  // 允许原型内的相对资源引用正常加载
  app.use(
    "/static/prototypes",
    express.static(path.join(STORAGE_DIR, "prototypes"), {
      index: ["index.html", "index.htm"],
      setHeaders: (res) => {
        // 设置沙箱友好的安全响应头
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
      }
    })
  );

  // 业务 API 路由
  app.use("/api/projects", projectsRouter);
  app.use("/api/prototypes", prototypesRouter);
  app.use("/api/comments", commentsRouter);
  app.use("/api/trash", trashRouter);

  // 健康检查
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // 如果生产环境构建了前端，则托管 client/dist
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/static")) {
      return next();
    }
    const indexHtml = path.join(clientDist, "index.html");
    res.sendFile(indexHtml, (err) => {
      if (err) next();
    });
  });

  return app;
}
