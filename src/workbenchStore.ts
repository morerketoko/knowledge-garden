/**
 * Phase 15：Workbench Store（任务 + 项目持久化层，§二百六十六~二百七十一）。
 * - 任务缓存：cache/ai-tasks.json，只存元数据 + 步骤摘要（§二百六十七：绝不存 Prompt / API Key / 完整网页 / reasoning）。
 * - 项目缓存：cache/projects.json 只是索引；Knowledge Garden/Projects/<name>/ 的 Markdown 是唯一 truth（§二百六十八）。
 * - 损坏隔离：isolateCorruptFile → *.corrupt-*（保留原件），重建空结构（与 discovery.ts 一致）。
 * - 恢复（§二百七十）：Research Task 恢复为 paused 可继续；Project 从 Markdown 目录重建索引（0 AI，§二百七十一）。
 */
import * as fs from "fs";
import * as path from "path";
import { atomicWriteJson, FORMAT_VERSION, isolateCorruptFile } from "./migrations";
import { sha256 } from "./ai/cache";
import type { KnowledgeProject, ResearchTask } from "./types";

/* ================= Task Store ================= */

export interface WorkbenchTaskStoreShape {
  formatVersion: number;
  tasks: ResearchTask[];
}

export function emptyTaskStore(): WorkbenchTaskStoreShape {
  return { formatVersion: FORMAT_VERSION, tasks: [] };
}

export function taskStableId(title: string, mode: string, createdAt: number): string {
  return "task-" + sha256(title + "|" + mode + "|" + createdAt).slice(0, 10);
}

/** Phase 15 任务持久化：cache/ai-tasks.json（检查点落盘 §一百二十五 / 恢复 §二百七十） */
export class WorkbenchTaskStore {
  tasks: ResearchTask[] = [];
  private file: string;

  constructor(pluginDir: string) {
    this.file = path.join(pluginDir, "cache", "ai-tasks.json");
  }

  /** 启动恢复；损坏 → 隔离 *.corrupt-* 并重建空结构，返回是否隔离 */
  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { tasks?: ResearchTask[] };
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.tasks)) throw new Error("invalid task store");
      this.tasks = raw.tasks;
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.tasks = [];
      return isolated;
    }
  }

  get(taskId: string): ResearchTask | undefined {
    return this.tasks.find((t) => t.taskId === taskId);
  }

  /** 每步 checkpoint / 状态变化后落盘（§一百二十五） */
  put(task: ResearchTask): void {
    const i = this.tasks.findIndex((t) => t.taskId === task.taskId);
    if (i >= 0) this.tasks[i] = task; else this.tasks.push(task);
    this.flush();
  }

  list(): ResearchTask[] {
    return [...this.tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  recent(limit = 20): ResearchTask[] {
    return this.list().slice(0, limit);
  }

  remove(taskId: string): void {
    this.tasks = this.tasks.filter((t) => t.taskId !== taskId);
    this.flush();
  }

  flush(): void {
    try {
      atomicWriteJson(this.file, { formatVersion: FORMAT_VERSION, tasks: this.tasks });
    } catch { /* 写盘失败不阻塞主流程 */ }
  }
}

/* ================= Project Store ================= */

export interface WorkbenchProjectStoreShape {
  formatVersion: number;
  projects: KnowledgeProject[];
}

export function emptyProjectStore(): WorkbenchProjectStoreShape {
  return { formatVersion: FORMAT_VERSION, projects: [] };
}

export function projectStableId(name: string): string {
  return "proj-" + sha256(name || "").slice(0, 10);
}

/** 项目根目录（§三十五：Knowledge Garden/Projects/<name>/） */
export const PROJECTS_ROOT = "Knowledge Garden/Projects";

/** Project README（§三十七 Outline）——纯函数，可 Node 夹具测试 */
export function projectReadmeMarkdown(project: KnowledgeProject): string {
  return [
    "# " + (project.name || "未命名项目"),
    "",
    "## 目标",
    ...(project.goals?.length ? project.goals.map((g) => "- " + g) : ["- （待补充）"]),
    "",
    "## 核心问题",
    ...(project.questions?.length ? project.questions.map((q) => "- " + q) : ["- （待补充）"]),
    "",
    "## 研究范围",
    "- （待补充）",
    "",
    "## 计划",
    ...(project.milestones?.length ? project.milestones.map((m) => "- [ ] " + m.title) : ["- （待补充）"]),
    "",
    "## 来源",
    "- （待补充）",
    "",
    "## 当前结论",
    "- （待补充）",
    "",
    "## 待解决问题",
    "- （待补充）",
  ].join("\n");
}

/** 项目骨架目录（§三十一/三十五/三十六：创建前必须 Preview 文件树，用户确认后调用） */
export function projectFolderTree(project: KnowledgeProject): string[] {
  return ["", "Sources", "Notes", "Drafts"].map((p) =>
    (PROJECTS_ROOT + "/" + project.name + (p ? "/" + p : "")).replace(/\//g, "/"));
}

/** Phase 15 项目持久化：cache/projects.json 索引 + Markdown truth */
export class WorkbenchProjectStore {
  projects: KnowledgeProject[] = [];
  private file: string;
  private pluginDir: string;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
    this.file = path.join(pluginDir, "cache", "projects.json");
  }

  load(): boolean {
    try {
      if (!fs.existsSync(this.file)) return false;
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as { projects?: KnowledgeProject[] };
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.projects)) throw new Error("invalid project store");
      this.projects = raw.projects;
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.projects = [];
      return isolated;
    }
  }

  get(projectId: string): KnowledgeProject | undefined {
    return this.projects.find((p) => p.id === projectId);
  }

  upsert(project: KnowledgeProject): void {
    const i = this.projects.findIndex((p) => p.id === project.id);
    if (i >= 0) this.projects[i] = project; else this.projects.push(project);
    this.flush();
  }

  /** 从 Knowledge Garden/Projects/* 目录重建索引（§二百七十一：0 AI；Markdown 是恢复源） */
  rescanFromMarkdown(): number {
    const root = path.join(this.pluginDir, PROJECTS_ROOT);
    let recovered = 0;
    try {
      if (!fs.existsSync(root)) return 0;
      const names = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      const seen = new Set<string>();
      const next: KnowledgeProject[] = [];
      for (const name of names) {
        if (!name || name.startsWith(".")) continue;
        const folder = path.join(root, name);
        const readme = path.join(folder, "README.md");
        let description = "";
        if (fs.existsSync(readme)) {
          const md = fs.readFileSync(readme, "utf8");
          const firstLine = md.split(/\r?\n/).find((l) => l.trim());
          if (firstLine) description = firstLine.replace(/^#\s*/, "").replace(/^#*\s*/, "").trim();
        }
        const id = projectStableId(name);
        const existing = this.get(id);
        next.push({
          id,
          name,
          description: description || existing?.description,
          rootFolder: PROJECTS_ROOT + "/" + name,
          workspaceId: existing?.workspaceId,
          goals: existing?.goals ?? [],
          questions: existing?.questions ?? [],
          milestones: existing?.milestones ?? [],
          status: existing?.status ?? "active",
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
        seen.add(id);
        recovered++;
      }
      this.projects = next;
      this.flush();
      return recovered;
    } catch {
      return recovered;
    }
  }

  /** 用户确认后创建项目骨架（§三十六：[创建]/[修改]/[取消]；README + Sources/Notes/Drafts） */
  createProjectFolder(project: KnowledgeProject): { created: string[]; failed: string[] } {
    const created: string[] = [];
    const failed: string[] = [];
    const root = path.join(this.pluginDir, PROJECTS_ROOT, project.name);
    for (const rel of ["", "Sources", "Notes", "Drafts"]) {
      const p = root + (rel ? "/" + rel : "");
      try {
        fs.mkdirSync(p, { recursive: true });
        created.push(PROJECTS_ROOT + "/" + project.name + (rel ? "/" + rel : ""));
      } catch {
        failed.push(PROJECTS_ROOT + "/" + project.name + (rel ? "/" + rel : ""));
      }
    }
    const readmePath = path.join(root, "README.md");
    if (!fs.existsSync(readmePath)) {
      try {
        fs.writeFileSync(readmePath, projectReadmeMarkdown(project), "utf8");
        created.push(PROJECTS_ROOT + "/" + project.name + "/README.md");
      } catch {
        failed.push(PROJECTS_ROOT + "/" + project.name + "/README.md");
      }
    }
    this.upsert(project);
    return { created, failed };
  }

  flush(): void {
    try {
      atomicWriteJson(this.file, { formatVersion: FORMAT_VERSION, projects: this.projects });
    } catch { /* 写盘失败不阻塞 */ }
  }
}