import { Router } from "express";
import crypto from "node:crypto";
import { store } from "../db/store.js";
import type { Project } from "../types.js";

const router = Router();

// 获取所有项目
router.get("/", (req, res) => {
  const projects = store.getProjects();
  // 附加每个项目的原型总数
  const prototypes = store.getPrototypes();
  const list = projects.map((p) => {
    const count = prototypes.filter((item) => item.projectId === p.id).length;
    return { ...p, prototypeCount: count };
  });
  res.json({ success: true, data: list });
});

// 获取单个项目
router.get("/:id", (req, res) => {
  const project = store.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: "项目不存在" });
  }
  res.json({ success: true, data: project });
});

// 创建项目
router.post("/", (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ success: false, message: "项目名称不能为空" });
  }
  const newProject: Project = {
    id: `proj-${crypto.randomUUID().slice(0, 8)}`,
    name: name.trim(),
    description: (description || "").trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.saveProject(newProject);
  res.status(201).json({ success: true, data: newProject });
});

// 编辑项目
router.put("/:id", (req, res) => {
  const project = store.getProjectById(req.params.id);
  if (!project) {
    return res.status(404).json({ success: false, message: "项目不存在" });
  }
  const { name, description } = req.body;
  if (name !== undefined) {
    if (!name.trim()) {
      return res.status(400).json({ success: false, message: "项目名称不能为空" });
    }
    project.name = name.trim();
  }
  if (description !== undefined) {
    project.description = description.trim();
  }
  project.updatedAt = new Date().toISOString();
  store.saveProject(project);
  res.json({ success: true, data: project });
});

// 删除项目（项目下的原型将移入回收站）
router.delete("/:id", (req, res) => {
  const deleted = store.deleteProject(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, message: "项目不存在或已被删除" });
  }
  res.json({ success: true, message: "项目已删除，关联原型已移入回收站" });
});

export default router;
