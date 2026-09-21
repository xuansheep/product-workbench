import type { Project, Prototype, Comment, CommentReply, CommentTargetInfo } from "../types/index.js";

const BASE_URL = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, options);
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || "请求失败，请稍后重试");
  }
  return json.data;
}

export const api = {
  // Projects
  getProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: { name: string; description?: string }) =>
    request<Project>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }),
  updateProject: (id: string, data: { name?: string; description?: string }) =>
    request<Project>(`/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }),
  deleteProject: (id: string) =>
    request<{ message: string }>(`/projects/${id}`, { method: "DELETE" }),

  // Prototypes
  getPrototypes: (projectId: string) => request<Prototype[]>(`/prototypes/project/${projectId}`),
  getPrototype: (id: string) => request<Prototype>(`/prototypes/${id}`),
  uploadPrototype: (formData: FormData) =>
    request<Prototype>("/prototypes/upload", {
      method: "POST",
      body: formData
    }),
  uploadNewVersion: (id: string, formData: FormData) =>
    request<Prototype>(`/prototypes/${id}/versions`, {
      method: "POST",
      body: formData
    }),
  updatePrototype: (id: string, data: { name?: string; description?: string }) =>
    request<Prototype>(`/prototypes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }),
  deletePrototype: (id: string) =>
    request<{ message: string }>(`/prototypes/${id}`, { method: "DELETE" }),

  // Comments
  getComments: (protoId: string, versionId?: string) => {
    const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
    return request<Comment[]>(`/comments/prototype/${protoId}${query}`);
  },
  addComment: (
    protoId: string,
    data: {
      versionId: string;
      pagePath: string;
      xPercent: number;
      yPercent: number;
      docX?: number;
      docY?: number;
      target?: CommentTargetInfo;
      content: string;
      author: { name: string; avatar: string };
    }
  ) =>
    request<Comment>(`/comments/prototype/${protoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }),
  addReply: (
    commentId: string,
    data: {
      content: string;
      author: { name: string; avatar: string };
    }
  ) =>
    request<CommentReply>(`/comments/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }),
  toggleCommentStatus: (commentId: string, status: "open" | "resolved") =>
    request<Comment>(`/comments/${commentId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }),
  deleteComment: (commentId: string) =>
    request<{ message: string }>(`/comments/${commentId}`, { method: "DELETE" }),

  // Trash
  getTrash: () => request<Prototype[]>("/trash"),
  restoreTrash: (id: string) => request<Prototype>(`/trash/${id}/restore`, { method: "POST" }),
  permanentDeleteTrash: (id: string) =>
    request<{ message: string }>(`/trash/${id}/permanent`, { method: "DELETE" })
};
