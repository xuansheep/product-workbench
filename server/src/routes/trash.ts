import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { store, STORAGE_DIR } from "../db/store.js";

const router = Router();

// 获取回收站中的所有原型
router.get("/", (req, res) => {
  const list = store.getPrototypes(undefined, true);
  // 附带项目名称
  const projects = store.getProjects();
  const enhanced = list.map((item) => {
    const proj = projects.find((p) => p.id === item.projectId);
    return {
      ...item,
      projectName: proj ? proj.name : "已删除的项目"
    };
  });
  res.json({ success: true, data: enhanced });
});

// 从回收站恢复原型
router.post("/:id/restore", (req, res) => {
  const proto = store.getPrototypeById(req.params.id);
  if (!proto || !proto.isDeleted) {
    return res.status(404).json({ success: false, message: "回收站中未找到该原型" });
  }
  proto.isDeleted = false;
  proto.deletedAt = null;
  proto.updatedAt = new Date().toISOString();
  store.savePrototype(proto);
  res.json({ success: true, message: "原型已成功恢复", data: proto });
});

// 彻底物理删除原型及其所有静态磁盘资源
router.delete("/:id/permanent", (req, res) => {
  const proto = store.getPrototypeById(req.params.id);
  if (!proto) {
    return res.status(404).json({ success: false, message: "原型不存在" });
  }

  // 物理清理硬盘存储目录
  const protoDiskDir = path.join(STORAGE_DIR, "prototypes", proto.id);
  if (fs.existsSync(protoDiskDir)) {
    try {
      fs.rmSync(protoDiskDir, { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to delete static directory:", protoDiskDir, err);
    }
  }

  store.permanentDeletePrototype(proto.id);
  res.json({ success: true, message: "原型及其静态资源已彻底销毁" });
});

export default router;
