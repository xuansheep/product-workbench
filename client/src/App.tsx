import React, { useState, useEffect, useCallback } from "react";
import { type Project, type Prototype } from "./types/index.js";
import { api } from "./services/api.js";
import { useAccount } from "./hooks/useAccount.js";
import { Navbar } from "./components/Navbar.js";
import { ProjectList } from "./components/ProjectList.js";
import { PrototypeList } from "./components/PrototypeList.js";
import { PrototypeViewer } from "./components/PrototypeViewer.js";
import { AccountModal } from "./components/AccountModal.js";
import { TrashModal } from "./components/TrashModal.js";

export function App() {
  const { account, updateAccount } = useAccount();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [prototypes, setPrototypes] = useState<Prototype[]>([]);
  const [selectedPrototype, setSelectedPrototype] = useState<Prototype | null>(null);

  const [trashList, setTrashList] = useState<Prototype[]>([]);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // 加载数据
  const loadProjects = async () => {
    try {
      const list = await api.getProjects();
      setProjects(list);
      return list;
    } catch (err) {
      console.error("Failed to load projects:", err);
      return [];
    }
  };

  const loadPrototypes = async (projectId: string) => {
    try {
      const list = await api.getPrototypes(projectId);
      setPrototypes(list);
      return list;
    } catch (err) {
      console.error("Failed to load prototypes:", err);
      return [];
    }
  };

  const loadTrash = async () => {
    try {
      const list = await api.getTrash();
      setTrashList(list);
      return list;
    } catch (err) {
      console.error("Failed to load trash:", err);
      return [];
    }
  };

  // 路由同步引擎：根据当前 URL Hash 定位页面与状态
  const syncRouteWithState = useCallback(async (allProjects?: Project[]) => {
    const hash = window.location.hash || "#/";
    const projs = allProjects || projects;

    // 1. 原型工作台路由: #/prototypes/:protoId
    const protoMatch = hash.match(/^#\/prototypes\/([^/?#]+)/);
    if (protoMatch) {
      const protoId = protoMatch[1];
      try {
        const proto = await api.getPrototype(protoId);
        setSelectedPrototype(proto);

        // 同步定位所属项目
        const ownerProj = projs.find((p) => p.id === proto.projectId);
        if (ownerProj) {
          setSelectedProject(ownerProj);
        } else {
          try {
            const p = await api.getProject(proto.projectId);
            setSelectedProject(p);
          } catch {
            // ignore
          }
        }
        return;
      } catch (err) {
        console.warn("Prototype not found by route, back to home:", err);
        window.location.hash = "#/";
      }
    }

    // 2. 项目原型列表路由: #/projects/:projectId
    const projMatch = hash.match(/^#\/projects\/([^/?#]+)/);
    if (projMatch) {
      const projectId = projMatch[1];
      setSelectedPrototype(null);
      const found = projs.find((p) => p.id === projectId);
      if (found) {
        setSelectedProject(found);
      } else {
        try {
          const p = await api.getProject(projectId);
          setSelectedProject(p);
        } catch {
          window.location.hash = "#/";
        }
      }
      return;
    }

    // 3. 回到首页
    setSelectedPrototype(null);
    setSelectedProject(null);
  }, [projects]);

  // 初始化加载与事件监听
  useEffect(() => {
    Promise.all([loadProjects(), loadTrash()]).then(([projs]) => {
      syncRouteWithState(projs);
      setLoading(false);
    });

    const handleHashChange = () => {
      syncRouteWithState();
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // 当选定项目变动时重新加载该项目下的原型
  useEffect(() => {
    if (selectedProject) {
      loadPrototypes(selectedProject.id);
    }
  }, [selectedProject]);

  // 路由跳转方法
  const navigateToHome = () => {
    window.location.hash = "#/";
  };

  const navigateToProject = (proj: Project) => {
    setSelectedProject(proj);
    setSelectedPrototype(null);
    window.location.hash = `#/projects/${proj.id}`;
  };

  const navigateToPrototype = (proto: Prototype) => {
    setSelectedPrototype(proto);
    window.location.hash = `#/prototypes/${proto.id}`;
  };

  // 项目操作
  const handleCreateProject = async (name: string, description: string) => {
    const newProj = await api.createProject({ name, description });
    setProjects((prev) => [newProj, ...prev]);
  };

  const handleUpdateProject = async (id: string, name: string, description: string) => {
    const updated = await api.updateProject(id, { name, description });
    setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
    if (selectedProject?.id === id) {
      setSelectedProject(updated);
    }
  };

  const handleDeleteProject = async (id: string) => {
    await api.deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (selectedProject?.id === id) {
      navigateToHome();
    }
    loadTrash();
  };

  // 原型操作
  const handleUploadPrototype = async (formData: FormData) => {
    const newProto = await api.uploadPrototype(formData);
    setPrototypes((prev) => [newProto, ...prev]);
    loadProjects();
  };

  const handleUploadNewVersion = async (protoId: string, formData: FormData) => {
    const updatedProto = await api.uploadNewVersion(protoId, formData);
    setPrototypes((prev) => prev.map((p) => (p.id === protoId ? updatedProto : p)));
    if (selectedPrototype?.id === protoId) {
      setSelectedPrototype(updatedProto);
    }
  };

  const handleDeletePrototype = async (protoId: string) => {
    await api.deletePrototype(protoId);
    setPrototypes((prev) => prev.filter((p) => p.id !== protoId));
    loadProjects();
    loadTrash();
  };

  // 回收站操作
  const handleRestoreTrash = async (id: string) => {
    const restored = await api.restoreTrash(id);
    setTrashList((prev) => prev.filter((item) => item.id !== id));
    if (selectedProject && restored.projectId === selectedProject.id) {
      setPrototypes((prev) => [restored, ...prev]);
    }
    loadProjects();
  };

  const handlePermanentDeleteTrash = async (id: string) => {
    await api.permanentDeleteTrash(id);
    setTrashList((prev) => prev.filter((item) => item.id !== id));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3.5">
          <div className="w-9 h-9 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <span className="text-xs font-medium text-slate-500">正在载入产品工作台...</span>
        </div>
      </div>
    );
  }

  // 原型评审大屏视图
  if (selectedPrototype) {
    return (
      <PrototypeViewer
        proto={selectedPrototype}
        onBack={() => {
          if (selectedProject) {
            navigateToProject(selectedProject);
          } else {
            navigateToHome();
          }
        }}
        account={account}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar
        currentProject={selectedProject}
        onBackToProjects={navigateToHome}
        onOpenTrash={() => setIsTrashOpen(true)}
        trashCount={trashList.length}
        account={account}
        onOpenAccountModal={() => setIsAccountOpen(true)}
      />

      <main className="flex-1">
        {selectedProject ? (
          <PrototypeList
            project={selectedProject}
            prototypes={prototypes}
            onBackToProjects={navigateToHome}
            onOpenViewer={navigateToPrototype}
            onUploadPrototype={handleUploadPrototype}
            onUploadNewVersion={handleUploadNewVersion}
            onDeletePrototype={handleDeletePrototype}
          />
        ) : (
          <ProjectList
            projects={projects}
            onSelectProject={navigateToProject}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
          />
        )}
      </main>

      {/* 账户偏好弹窗 */}
      <AccountModal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        account={account}
        onUpdateAccount={updateAccount}
      />

      {/* 回收站弹窗 */}
      <TrashModal
        isOpen={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
        trashList={trashList}
        onRestore={handleRestoreTrash}
        onPermanentDelete={handlePermanentDeleteTrash}
      />
    </div>
  );
}