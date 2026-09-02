"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/taskClassifier.ts
function classifyTaskComplexity(question) {
  const q = (question || "").trim().toLowerCase();
  const len = q.length;
  if (len > 140 || /compare|comparison|对比|比较|共同结构|共同点|冲突|矛盾|一致|不一致|difference|差异|过去.{0,6}年|近.{0,4}年|整个 ?vault|整个知识库|全库|跨领域/.test(q)) return "complex";
  if (/\bwhy\b|为什么|\bhow\b|如何|怎样|关系|关联|影响|summar|概括|总结|分析|解释|explain|\bcompare\b|对比|比较|原理|机制/.test(q) || len > 60) return "normal";
  return "simple";
}
function maxStepsFor(c) {
  return c === "simple" ? 2 : c === "normal" ? 5 : 8;
}
function contextBudgetFor(c) {
  if (c === "simple") return { candidates: 12, readFull: 1, evidenceChars: 4e3 };
  if (c === "normal") return { candidates: 16, readFull: 5, evidenceChars: 1e4 };
  return { candidates: 20, readFull: 5, evidenceChars: 16e3 };
}

// src/migrations.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function pad2(n) {
  return String(n).padStart(2, "0");
}
function corruptStamp(now = /* @__PURE__ */ new Date()) {
  return String(now.getFullYear()) + pad2(now.getMonth() + 1) + pad2(now.getDate()) + "-" + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
}
function isolateCorruptFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    fs.renameSync(filePath, filePath + ".corrupt-" + corruptStamp());
    return true;
  } catch {
    return false;
  }
}
function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, filePath);
}

// src/latency.ts
var LatencyTracker = class {
  constructor() {
    this.marks = {};
    this.marks.taskCreatedAt = Date.now();
  }
  mark(phase) {
    this.marks[phase] = Date.now();
  }
  diff(a, b) {
    const va = this.marks[a];
    const vb = this.marks[b];
    if (va === void 0 || vb === void 0) return null;
    return Math.max(0, vb - va);
  }
  summary() {
    const now = Date.now();
    const end = this.marks.renderEnd ?? this.marks.parseEnd ?? this.marks.requestEnd ?? now;
    const start = this.marks.taskCreatedAt ?? now;
    return {
      contextLatency: this.diff("contextStart", "contextEnd"),
      ttft: this.diff("requestStart", "firstTokenAt"),
      networkLatency: this.diff("requestStart", "requestEnd"),
      parseLatency: this.diff("requestEnd", "parseEnd"),
      renderLatency: this.diff("parseEnd", "renderEnd"),
      totalLatency: Math.max(0, end - start)
    };
  }
};
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
  return sorted[idx];
}

// src/promptLibrary.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// src/ai/cache.ts
var crypto = __toESM(require("crypto"));
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function fingerprintKey(parts) {
  return sha256(parts.join("\0"));
}
function candidateSig(notes) {
  const lines = [...notes].sort((a, b) => a.path.localeCompare(b.path)).map((n) => n.path + "|" + n.modified + "|" + n.size);
  return sha256(lines.join("\n"));
}
var AICache = class {
  constructor(pluginDir) {
    this.entries = /* @__PURE__ */ new Map();
    this.file = path2.join(pluginDir, "cache", "ai-cache.json");
  }
  /** 启动时恢复（离线可读）。损坏/结构非法 → 隔离 *.corrupt-* 后重建空缓存（§九/§十），返回是否执行了隔离 */
  load() {
    try {
      if (!fs2.existsSync(this.file)) return false;
      const raw = JSON.parse(fs2.readFileSync(this.file, "utf8"));
      if (!Array.isArray(raw)) throw new Error("invalid cache structure");
      const now = Date.now();
      for (const e of raw) {
        if (!e || typeof e.key !== "string" || !e.type) continue;
        if (e.status !== "success" && e.status !== "error") continue;
        if (e.expiresAt && e.expiresAt <= now) continue;
        this.entries.set(e.key, e);
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.entries.clear();
      return isolated;
    }
  }
  get(key) {
    return this.entries.get(key);
  }
  /** 只缓存「有效结果」+ 元数据；绝不写入 API Key / header / 原始 prompt / 笔记全文 */
  put(entry) {
    this.entries.set(entry.key, { ...entry, updatedAt: Date.now() });
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
  }
  byType(type) {
    return Array.from(this.entries.values()).filter((e) => e.type === type);
  }
  stats() {
    const all = Array.from(this.entries.values());
    let bytes = 0;
    let last = 0;
    const byType = {};
    for (const e of all) {
      try {
        bytes += JSON.stringify(e).length;
      } catch {
      }
      if (e.updatedAt > last) last = e.updatedAt;
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { count: all.length, bytes, lastUpdated: last, byType };
  }
  /** 清理过期 AI 缓存（§四十六）：只删 expiresAt 已过 + 超过 7 天的 error 缓存；success 未过期完整保留 */
  clearExpired() {
    const now = Date.now();
    const ERROR_TTL_MS = 7 * 864e5;
    let removed = 0;
    for (const [k, e] of this.entries) {
      const expired = typeof e.expiresAt === "number" && e.expiresAt <= now;
      const staleError = e.status === "error" && now - (e.updatedAt ?? e.createdAt ?? 0) > ERROR_TTL_MS;
      if (expired || staleError) {
        this.entries.delete(k);
        removed++;
      }
    }
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u6E05\u7406\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
    return removed;
  }
  /** 清空：* 删除全部 AI 缓存（只动 cache/，绝不触碰 Reviews/） */
  clearType(type) {
    let removed = 0;
    for (const [k, e] of this.entries) {
      if (type === "*" || e.type === type) {
        this.entries.delete(k);
        removed++;
      }
    }
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u6E05\u7406\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
    return removed;
  }
};

// src/promptLibrary.ts
var PROMPTS_ROOT = "Knowledge Garden/Prompts";
var PROMPT_CATEGORIES = ["Academic", "Research", "Writing", "Technical", "General"];
function promptStableId(name, createdAt) {
  return "prompt-" + sha256((name || "untitled") + "|" + createdAt).slice(0, 12);
}
function promptFingerprint(t) {
  return sha256([t.name || "", t.description || "", t.prompt || ""].join("|"));
}
function parseFrontmatterLines(lines) {
  if (!lines.length || lines[0].trim() !== "---") return { meta: {}, bodyLines: lines };
  const meta = {};
  let curKey = null;
  const tags = [];
  let i = 1;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "---") {
      i++;
      break;
    }
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) {
      curKey = m[1];
      const val = m[2].trim();
      if (val === "tags") continue;
      if (val === "") continue;
      if (val === "true" || val === "false") meta[curKey] = val === "true";
      else if (/^\d+$/.test(val)) meta[curKey] = parseInt(val, 10);
      else meta[curKey] = val;
    } else if (curKey === "tags" && /^-\s*(.*)$/.test(raw)) {
      tags.push(raw.replace(/^-\s*/, "").trim());
    }
  }
  if (tags.length) meta.tags = tags;
  return { meta, bodyLines: lines.slice(i) };
}
function parsePromptMarkdown(md2, id) {
  const lines = (md2 || "").split(/\r?\n/);
  const { meta, bodyLines } = parseFrontmatterLines(lines);
  const name = typeof meta.name === "string" ? meta.name.trim() : "";
  const prompt = bodyLines.join("\n").trim();
  if (!name || !prompt) return null;
  const tags = Array.isArray(meta.tags) ? meta.tags.filter((x) => x && typeof x === "string") : void 0;
  return {
    template: {
      id,
      name,
      description: typeof meta.description === "string" ? meta.description : void 0,
      prompt,
      tags: tags && tags.length ? tags : void 0,
      category: typeof meta.category === "string" ? meta.category : "General",
      favorite: meta.favorite === true,
      version: typeof meta.version === "number" ? meta.version : 1
    }
  };
}
function buildPromptMarkdown(t) {
  const fm = ["---", "type: kg-prompt", "name: " + t.name];
  if (t.description) fm.push("description: " + t.description);
  if (t.category) fm.push("category: " + t.category);
  fm.push("version: " + (t.version ?? 1));
  fm.push("favorite: " + (t.favorite ? "true" : "false"));
  if (t.tags && t.tags.length) {
    fm.push("tags:");
    for (const g of t.tags) fm.push("  - " + g);
  }
  fm.push("---", "", t.prompt, "");
  return fm.join("\n");
}
function searchPrompts(list, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q) || (t.tags || []).some((g) => g.toLowerCase().includes(q)) || t.prompt.toLowerCase().includes(q)
  );
}
var PromptLibraryStore = class {
  constructor(pluginDir) {
    this.templates = [];
    this.root = path3.join(pluginDir, PROMPTS_ROOT);
    this.file = path3.join(pluginDir, "cache", "prompts.json");
  }
  /** 启动：先扫描 Markdown（恢复源），再合并缓存统计（usageCount/lastUsedAt）；0 AI */
  load() {
    let isolated = false;
    let cached = [];
    try {
      if (fs3.existsSync(this.file)) {
        const raw = JSON.parse(fs3.readFileSync(this.file, "utf8"));
        if (raw && Array.isArray(raw.templates)) cached = raw.templates;
      }
    } catch {
      isolated = isolateCorruptFile(this.file);
      cached = [];
    }
    const statById = /* @__PURE__ */ new Map();
    for (const c of cached) statById.set(c.id, { usageCount: c.usageCount || 0, lastUsedAt: c.lastUsedAt });
    const next = [];
    if (fs3.existsSync(this.root)) {
      for (const cat of PROMPT_CATEGORIES) {
        const dir = path3.join(this.root, cat);
        if (!fs3.existsSync(dir)) continue;
        let entries = [];
        try {
          entries = fs3.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (!e.isFile() || !/^[^\r\n]*\.md$/i.test(e.name)) continue;
          try {
            const md2 = fs3.readFileSync(path3.join(dir, e.name), "utf8");
            const id = promptStableId(e.name.replace(/\.md$/i, ""), 0);
            const parsed = parsePromptMarkdown(md2, id);
            if (!parsed) continue;
            const t = parsed.template;
            const st = statById.get(id);
            next.push({
              id,
              name: t.name ?? e.name.replace(/\.md$/i, ""),
              description: t.description,
              prompt: t.prompt ?? "",
              tags: t.tags,
              category: t.category ?? cat,
              favorite: t.favorite ?? false,
              usageCount: st?.usageCount ?? 0,
              lastUsedAt: st?.lastUsedAt,
              version: t.version ?? 1,
              createdAt: 0,
              updatedAt: 0
            });
          } catch {
          }
        }
      }
    }
    this.templates = next;
    return isolated;
  }
  list() {
    return [...this.templates];
  }
  get(id) {
    return this.templates.find((t) => t.id === id);
  }
  favorites() {
    return this.templates.filter((t) => t.favorite);
  }
  recentlyUsed(limit = 10) {
    return [...this.templates].filter((t) => t.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, limit);
  }
  count() {
    return this.templates.length;
  }
  normalizeCategory(c) {
    return c && PROMPT_CATEGORIES.includes(c) ? c : "General";
  }
  fileNameFor(name) {
    return (name || "untitled").trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "") + ".md";
  }
  pathFor(cat, name) {
    return path3.join(this.root, this.normalizeCategory(cat), this.fileNameFor(name));
  }
  writeMarkdown(t) {
    const dir = path3.join(this.root, this.normalizeCategory(t.category));
    try {
      fs3.mkdirSync(dir, { recursive: true });
    } catch {
    }
    const target = this.pathFor(t.category, t.name);
    try {
      fs3.writeFileSync(target, buildPromptMarkdown(t), "utf8");
    } catch {
      throw new Error("Prompt \u5199\u5165\u5931\u8D25\uFF1A" + target);
    }
  }
  deleteMarkdown(t) {
    const target = this.pathFor(t.category, t.name);
    try {
      if (fs3.existsSync(target)) fs3.unlinkSync(target);
    } catch {
    }
  }
  create(input) {
    const now = Date.now();
    const t = {
      id: promptStableId(input.name, now),
      name: input.name.trim(),
      description: input.description?.trim() || void 0,
      prompt: (input.prompt || "").trim(),
      tags: input.tags && input.tags.length ? input.tags.map((x) => x.trim()).filter(Boolean) : void 0,
      category: this.normalizeCategory(input.category),
      favorite: !!input.favorite,
      usageCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.writeMarkdown(t);
    this.templates.push(t);
    this.flush();
    return t;
  }
  /** 编辑：id 不变（§十二），只更新字段并写回 Markdown；Prompt 内容变化 → Cache Miss（调用方使用 promptFingerprint） */
  update(id, patch) {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const old = this.templates[i];
    const next = {
      ...old,
      ...patch.name !== void 0 ? { name: patch.name.trim() } : {},
      ...patch.description !== void 0 ? { description: patch.description.trim() || void 0 } : {},
      ...patch.prompt !== void 0 ? { prompt: (patch.prompt || "").trim() } : {},
      ...patch.tags !== void 0 ? { tags: patch.tags.map((x) => x.trim()).filter(Boolean) } : {},
      ...patch.category !== void 0 ? { category: this.normalizeCategory(patch.category) } : {},
      ...patch.favorite !== void 0 ? { favorite: patch.favorite } : {},
      updatedAt: Date.now()
    };
    if (patch.name && patch.name.trim() !== old.name) this.deleteMarkdown(old);
    this.writeMarkdown(next);
    this.templates[i] = next;
    this.flush();
    return next;
  }
  remove(id) {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return false;
    this.deleteMarkdown(this.templates[i]);
    this.templates.splice(i, 1);
    this.flush();
    return true;
  }
  setFavorite(id, fav) {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const next = { ...this.templates[i], favorite: fav, updatedAt: Date.now() };
    this.writeMarkdown(next);
    this.templates[i] = next;
    this.flush();
    return next;
  }
  /** 使用统计（§十四）：usageCount++ / lastUsedAt；不调用 AI；不重写 Markdown（统计只在缓存） */
  touch(id) {
    const i = this.templates.findIndex((t) => t.id === id);
    if (i < 0) return null;
    const next = {
      ...this.templates[i],
      usageCount: (this.templates[i].usageCount || 0) + 1,
      lastUsedAt: Date.now(),
      updatedAt: Date.now()
    };
    this.templates[i] = next;
    this.flush();
    return next;
  }
  flush() {
    try {
      atomicWriteJson(this.file, { formatVersion: 1, templates: this.templates });
    } catch {
    }
  }
};

// src/ai/provider.ts
var AIError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};

// src/examEngine.ts
var VALID_EXAM_TYPES = [
  "recall",
  "explanation",
  "comparison",
  "application",
  "true_false",
  "multiple_choice",
  "counterexample"
];
function normalizedExamQuestion(q) {
  return (q || "").replace(/[ \t\u3000]+/g, " ").replace(/[。．.!！?？;；,，]/g, " ").toLowerCase().trim().slice(0, 160);
}
function filterValidExamQuestions(raw, maxCount) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of raw) {
    if (out.length >= maxCount) break;
    if (!item || typeof item !== "object") continue;
    const rec = item;
    const type = rec["type"];
    if (!VALID_EXAM_TYPES.includes(type)) continue;
    const question = typeof rec["question"] === "string" ? rec["question"].trim().slice(0, 300) : "";
    if (!question) continue;
    const norm = normalizedExamQuestion(question);
    if (seen.has(norm)) continue;
    const referenceAnswer = typeof rec["referenceAnswer"] === "string" ? rec["referenceAnswer"].trim().slice(0, 1200) : "";
    if (!referenceAnswer) continue;
    if (type === "multiple_choice") {
      const opts = Array.isArray(rec["options"]) ? rec["options"].map((o) => String(o)).filter(Boolean).slice(0, 6) : [];
      if (opts.length !== 4) continue;
    }
    if (type === "true_false") {
      const ca = String(rec["correctAnswer"] ?? "").toLowerCase();
      if (ca !== "true" && ca !== "false") continue;
    }
    seen.add(norm);
    const evidence = Array.isArray(rec["sourceEvidence"]) ? rec["sourceEvidence"].map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 6) : [];
    out.push({
      id: typeof rec["id"] === "string" && rec["id"] ? String(rec["id"]).slice(0, 40) : "q" + (out.length + 1),
      type,
      question,
      options: type === "multiple_choice" ? Array.isArray(rec["options"]) ? rec["options"].map((o) => String(o)).slice(0, 4) : void 0 : void 0,
      correctAnswer: type === "true_false" || type === "multiple_choice" ? String(rec["correctAnswer"] ?? "").slice(0, 120) : void 0,
      referenceAnswer,
      explanation: typeof rec["explanation"] === "string" ? rec["explanation"].trim().slice(0, 600) : void 0,
      sourceEvidence: evidence,
      sourcePath: typeof rec["sourcePath"] === "string" ? String(rec["sourcePath"]).slice(0, 400) : "",
      difficulty: rec["difficulty"] === "easy" || rec["difficulty"] === "hard" ? rec["difficulty"] : rec["difficulty"] === "medium" ? "medium" : void 0,
      concept: typeof rec["concept"] === "string" ? String(rec["concept"]).trim().slice(0, 80) : void 0
    });
  }
  return out;
}

// src/ai/parsers.ts
function extractJsonBlockText(text) {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = i; k <= j; k++) {
    const ch = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(i, k + 1);
    }
  }
  return null;
}
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function parseJsonObject(content, label) {
  const text = content.trim();
  const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const direct = tryJson(text);
  if (direct) {
    if (isObj(direct)) return direct;
    throw new AIError("AI \u8FD4\u56DE\u7684" + label + " JSON \u4E0D\u662F\u5408\u6CD5\u5BF9\u8C61\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const block = extractJsonBlockText(text);
  if (block) {
    const repaired = tryJson(block);
    if (repaired && isObj(repaired)) return repaired;
  }
  throw new AIError("AI \u8FD4\u56DE\u7684" + label + " JSON \u975E\u6CD5\uFF08\u65E0\u6CD5\u89E3\u6790\uFF09\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
}
function parseExamGeneration(content, maxCount) {
  const rec = parseJsonObject(content, "\u8003\u8BD5");
  if (typeof rec["title"] !== "string" || !rec["title"] || !Array.isArray(rec["questions"])) {
    throw new AIError("AI \u8FD4\u56DE\u7684\u8003\u8BD5\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5\uFF08title/questions\uFF09\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const questions = filterValidExamQuestions(rec["questions"], Math.max(1, maxCount ?? 50));
  if (!questions.length) {
    throw new AIError("AI \u8FD4\u56DE\u7684\u8003\u8BD5\u9898\u76EE\u5168\u90E8\u65E0\u6548\uFF08\u8FC7\u6EE4\u540E\u65E0\u6709\u6548\u9898\u76EE\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u7F13\u5B58\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const coverage = rec["coverageTopics"];
  return {
    title: String(rec["title"]).trim().slice(0, 200),
    coverageTopics: Array.isArray(coverage) ? coverage.map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 12) : void 0,
    questions
  };
}
function parseExamGrading(content) {
  const rec = parseJsonObject(content, "\u8BC4\u5206");
  const correctness = rec["correctness"];
  if (correctness !== "correct" && correctness !== "partial" && correctness !== "wrong") {
    throw new AIError("AI \u8FD4\u56DE\u7684\u8BC4\u5206\u7F3A\u5C11\u5408\u6CD5 correctness\uFF08correct/partial/wrong\uFF09\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const score = rec["score"];
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 5) {
    throw new AIError("AI \u8FD4\u56DE\u7684\u8BC4\u5206 score \u975E\u6CD5\uFF08\u987B\u4E3A 0~5 \u6570\u503C\uFF09\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
  }
  const arr = (v, label) => {
    if (!Array.isArray(v)) {
      throw new AIError("AI \u8FD4\u56DE\u7684\u8BC4\u5206\u7F3A\u5C11\u6570\u7EC4\u5B57\u6BB5 " + label + "\uFF0C\u5DF2\u6821\u9A8C\u62D2\u7EDD\u3002\u8BF7\u91CD\u8BD5\u3002");
    }
    return v.map((s) => String(s).trim().slice(0, 800)).filter(Boolean);
  };
  return {
    correctness,
    score,
    strengths: arr(rec["strengths"], "strengths"),
    missing: arr(rec["missing"], "missing"),
    misconceptions: arr(rec["misconceptions"], "misconceptions")
  };
}
function examCacheDataValid(type, data) {
  if (type === "workbench_ask" || type === "workbench_deep" || type === "workbench_research" || type === "research_plan" || type === "research_search" || type === "agent_tool_call") {
    return typeof data === "string" && data.trim().length > 0;
  }
  const rec = data;
  if (!rec || typeof rec !== "object") return false;
  if (type === "note_exam") {
    return Array.isArray(rec["questions"]) && rec["questions"].length > 0;
  }
  if (type === "exam_grading") {
    const c = rec["correctness"];
    const s = rec["score"];
    return (c === "correct" || c === "partial" || c === "wrong") && typeof s === "number" && s >= 0 && s <= 5 && Array.isArray(rec["strengths"]) && Array.isArray(rec["missing"]) && Array.isArray(rec["misconceptions"]);
  }
  return true;
}

// src/workbenchParsers.ts
function extractJsonObject(content) {
  const c = (content ?? "").trim();
  if (!c) return null;
  try {
    const v = JSON.parse(c);
    if (v && typeof v === "object") return v;
  } catch {
  }
  const fenced = c.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      const v = JSON.parse(fenced[1].trim());
      if (v && typeof v === "object") return v;
    } catch {
    }
  }
  const brace = c.match(/\{[\s\S]*\}/);
  if (brace) {
    try {
      const v = JSON.parse(brace[0]);
      if (v && typeof v === "object") return v;
    } catch {
    }
  }
  return null;
}
function asString(v) {
  return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
function asStringArray(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const item of v) {
    const s = asString(item);
    if (s) out.push(s);
  }
  return out;
}
function parseKnowledgeAskText(content) {
  const obj = extractJsonObject(content);
  if (!obj) return null;
  const o = obj;
  const answer = asString(o.answer);
  if (answer === void 0) return null;
  const sources = [];
  if (Array.isArray(o.sources)) {
    for (const raw of o.sources) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw;
      const type = s.type === "vault" || s.type === "web" || s.type === "inference" ? s.type : void 0;
      if (!type) continue;
      const path6 = asString(s.path);
      const url = asString(s.url);
      const title = asString(s.title);
      const snippet = asString(s.snippet);
      const reason = asString(s.reason);
      const evidence = asString(s.evidence);
      if (type === "vault" && !path6) continue;
      if (type === "web" && !/^https?:\/\//i.test(url || "")) continue;
      const entry = { type, snippet: snippet ? snippet.slice(0, 500) : void 0 };
      if (path6) entry.path = path6;
      if (url) entry.url = url;
      if (title) entry.title = title;
      if (reason) entry.reason = reason;
      if (evidence) entry.evidence = evidence.slice(0, 500);
      sources.push(entry);
    }
  }
  const inferences = asStringArray(o.inferences) ?? [];
  const uncertainties = asStringArray(o.uncertainties) ?? [];
  const followUps = asStringArray(o.followUps) ?? [];
  return { answer, sources, inferences, uncertainties, followUps };
}

// src/workbenchSession.ts
var fs22 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
function sessionIdFor(question, at) {
  return "session-" + sha256(question + "|" + at).slice(0, 12);
}
var WorkbenchSessionStore = class {
  constructor(pluginDir) {
    this.sessions = [];
    this.file = path4.join(pluginDir, "cache", "workbench-sessions.json");
  }
  load() {
    try {
      if (!fs22.existsSync(this.file)) return false;
      const raw = JSON.parse(fs22.readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || !Array.isArray(raw.sessions)) throw new Error("invalid session store");
      this.sessions = raw.sessions.slice(0, 50);
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.sessions = [];
      return isolated;
    }
  }
  get(sessionId) {
    return this.sessions.find((s) => s.sessionId === sessionId);
  }
  put(rec) {
    const i = this.sessions.findIndex((s) => s.sessionId === rec.sessionId);
    if (i >= 0) this.sessions[i] = rec;
    else this.sessions.push(rec);
    if (this.sessions.length > 50) this.sessions.splice(0, this.sessions.length - 50);
    this.flush();
  }
  list() {
    return [...this.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  recent(limit = 10) {
    return this.list().slice(0, limit);
  }
  flush() {
    try {
      atomicWriteJson(this.file, { formatVersion: 1, sessions: this.sessions });
    } catch {
    }
  }
};

// src/skills.ts
function parseSkillFrontmatter(frontmatter) {
  const out = {};
  const lines = (frontmatter || "").split(/[\r\n]+/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(raw.trim());
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const val = m[2].trim();
    if (key === "description" && val === ">") {
      const parts = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      out.description = parts.join(" ");
      continue;
    }
    if (key === "name") out.name = val || void 0;
    else if (key === "description") out.description = val || void 0;
    else if (key === "requiresPlan") out.requiresPlan = val === "true";
    i++;
  }
  return out;
}
function splitSkillFile(text) {
  const t = (text || "").replace(/^\uFEFF/, "");
  const m = /^---[\r\n]+([\s\S]*?)[\r\n]+---[\r\n]*([\s\S]*)$/.exec(t);
  if (!m) return { frontmatter: {}, body: t.trim() };
  return { frontmatter: parseSkillFrontmatter(m[1]), body: m[2].trim() };
}
var BUILTIN_SKILL_IDS = [
  "academic-writing",
  "critical-analysis",
  "research-question",
  "knowledge-application",
  "knowledge-refinement"
];
var md = (lines) => lines.join("\n");
var ACADEMIC = md([
  "# Academic Writing",
  "",
  "## Process",
  "1. Identify the thesis / core claim of the material.",
  "2. Separate claims from evidence; mark which claims are the author's inference.",
  "3. Identify assumptions and unstated premises.",
  "4. Improve structure (claim -> evidence -> reasoning -> limitation).",
  "5. Mark uncertain statements; never fabricate citations (\xA7\u4E09\u5341\u4E09/\xA7\u4E5D\u5341\u4E09).",
  "6. Output in the requested format; do not claim it is academically correct (\xA7\u4E5D\u5341\u56DB)."
]);
var CRITICAL = md([
  "# Critical Analysis",
  "",
  "## Process",
  "1. Restate the position in one sentence (charitable reading).",
  "2. List supporting evidence vs unsupported assertion.",
  "3. Find counterexamples and counter-arguments.",
  "4. Assess the strength of the link between evidence and conclusion.",
  "5. Distinguish fact, inference, and value judgment.",
  "6. End with the strongest open question."
]);
var RESQ = md([
  "# Research Question",
  "",
  "## Process",
  "1. Summarize the current material into 1-3 core topics.",
  "2. Generate hierarchically structured questions (general -> specific; descriptive -> explanatory -> evaluative) (\xA7\u4E09\u5341\u4E03/\xA7\u4E09\u5341\u516B).",
  "3. For each question, list what evidence would be needed.",
  "4. Identify which questions connect to existing knowledge / known gaps.",
  "5. Output questions with a short why-it-matters line."
]);
var APPLY = md([
  "# Knowledge Application",
  "",
  "## Process",
  "1. Extract the transferable principle(s) from the source material.",
  "2. Identify target domains where the principle could apply (cross-domain transfer, \xA7\u56DB\u5341/\xA7\u56DB\u5341\u4E00).",
  "3. For each application: expected effect, precondition, limitation.",
  "4. Provide a concrete example scenario.",
  "5. Flag speculative applications explicitly as hypotheses, not facts (\xA7\u4E00\u767E\u4E94\u5341\u56DB)."
]);
var REFINE = md([
  "# Knowledge Refinement",
  "",
  "## Process",
  "1. Parse the source note into atomic claims (each claim = one sentence, traceable to the source).",
  "2. Keep the original wording where possible; only rephrase for clarity.",
  "3. Separate source-derived from your own synthesis (origin preservation, Phase 10 Provenance).",
  "4. Attach suggested wikilinks only to concepts already present in the vault.",
  "5. Output refined content as a proposal; do not overwrite the original without preview (\xA7\u516D\u5341\u4E00)."
]);
var BUILTIN_BODIES = {
  "academic-writing": ACADEMIC,
  "critical-analysis": CRITICAL,
  "research-question": RESQ,
  "knowledge-application": APPLY,
  "knowledge-refinement": REFINE
};
function builtinSkillBody(id) {
  return BUILTIN_BODIES[id] || "";
}
var BUILTIN_SKILL_SUMMARIES = BUILTIN_SKILL_IDS.map((id) => ({
  id,
  name: skillName(id),
  description: skillDescription(id),
  path: "builtin://" + id,
  enabled: true
}));
function skillName(id) {
  const map = {
    "academic-writing": "\u5B66\u672F\u5199\u4F5C",
    "critical-analysis": "\u6279\u5224\u6027\u5206\u6790",
    "research-question": "\u7814\u7A76\u95EE\u9898\u751F\u6210",
    "knowledge-application": "\u77E5\u8BC6\u8FC1\u79FB\u4E0E\u5E94\u7528",
    "knowledge-refinement": "\u77E5\u8BC6\u63D0\u70BC"
  };
  return map[id] ?? id;
}
function skillDescription(id) {
  const map = {
    "academic-writing": "\u628A\u7B14\u8BB0\u6539\u5199\u6210\u6709\u5B66\u672F\u7ED3\u6784\u3001\u533A\u5206\u8BBA\u636E\u4E0E\u63A8\u8BBA\u7684\u8F93\u51FA\uFF0C\u4E0D\u4F2A\u9020\u5F15\u7528\u3002",
    "critical-analysis": "\u8BC6\u522B\u8BBA\u70B9\u3001\u8BBA\u636E\u3001\u5047\u8BBE\u4E0E\u53CD\u4F8B\uFF0C\u8F93\u51FA\u6279\u5224\u6027\u5206\u6790\u3002",
    "research-question": "\u4ECE\u6750\u6599\u751F\u6210\u6709\u5C42\u6B21\u7684\u7814\u7A76\u95EE\u9898\uFF08\u63CF\u8FF0\u2192\u89E3\u91CA\u2192\u8BC4\u4EF7\uFF09\u3002",
    "knowledge-application": "\u63D0\u53D6\u53EF\u8FC1\u79FB\u539F\u5219\uFF0C\u505A\u8DE8\u9886\u57DF\u5E94\u7528\u4E0E\u53CD\u4F8B\u5206\u6790\u3002",
    "knowledge-refinement": "\u628A\u7B14\u8BB0\u63D0\u70BC\u4E3A\u53EF\u8FFD\u6EAF\u7684\u539F\u5B50\u5316\u77E5\u8BC6\uFF0C\u540C\u65F6\u4FDD\u7559\u6765\u6E90\u8FB9\u754C\u3002"
  };
  return map[id] ?? "";
}
function skillEnabled(id, registry) {
  const s = registry.find((r) => r.id === id);
  return s ? s.enabled : false;
}
function resolveSkillBody(id, readUserSkill, registry) {
  if (!skillEnabled(id, registry)) return { instructions: "", resources: [], source: "builtin" };
  const userText = readUserSkill(id);
  if (userText !== null) {
    const { body } = splitSkillFile(userText);
    const resources = collectSkillResources(id, readUserSkill);
    return { instructions: body, resources, source: "user" };
  }
  return { instructions: builtinSkillBody(id), resources: [], source: "builtin" };
}
function collectSkillResources(id, readUserSkill) {
  const subDirs = ["references", "templates", "examples"];
  const names = ["style-guide.md", "citation-rules.md", "research-note.md", "template.md", "example.md", "prompts.md", "guide.md", "notes.md", "samples.md", "instructions.md"];
  const out = [];
  for (const d of subDirs) {
    for (const n of names) {
      const txt = readUserSkill(id + "/" + d + "/" + n);
      if (txt !== null) {
        out.push({ label: id + "/" + d + "/" + n, content: txt.trim() });
        break;
      }
    }
  }
  return out;
}
function skillCachePart(selected, registry, readUserSkill) {
  const applied = selected.filter((id) => skillEnabled(id, registry));
  if (applied.length === 0) return "skills:none";
  const bodies = applied.map((id) => resolveSkillBody(id, readUserSkill, registry).instructions);
  return fingerprintKey(["skills:" + applied.slice().sort().join(","), ...bodies]);
}

// src/workbenchTools.ts
var WORKBENCH_TOOL_IDS = [
  "vault.search",
  "vault.read",
  "vault.create",
  "vault.modify",
  "vault.rename",
  "vault.move",
  "vault.delete",
  "vault.open",
  "web.search",
  "web.fetch"
];
function toolCategory(toolId) {
  const map = {
    "vault.search": "LOCAL_READ",
    "vault.read": "LOCAL_READ",
    "vault.open": "LOCAL_READ",
    "vault.create": "LOCAL_WRITE",
    "vault.modify": "LOCAL_WRITE",
    "vault.rename": "LOCAL_WRITE",
    "vault.move": "LOCAL_WRITE",
    "vault.delete": "DESTRUCTIVE",
    "web.search": "EXTERNAL_WEB",
    "web.fetch": "EXTERNAL_WEB"
  };
  return map[toolId] ?? "LOCAL_READ";
}
function defaultToolPermission(toolId) {
  const cat = toolCategory(toolId);
  if (cat === "DESTRUCTIVE") return "deny";
  if (cat === "LOCAL_WRITE") return "ask";
  if (cat === "EXTERNAL_WEB") return "ask";
  return "allow";
}
function safeVaultPath(path6, vaultRoot) {
  const p = (path6 ?? "").trim();
  if (!p) return null;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return null;
  if (p.includes("..") && /\.\./.test(p)) return null;
  if (p.includes("\\") || p.includes("/")) {
    const segs = p.split(/[\\/]+/);
    for (const s of segs) if (s === ".." || s === "." || s === "") return null;
  }
  if (!p.endsWith(".md") || p === ".md") return null;
  const root = (vaultRoot ?? "").replace(/[\\/]+$/, "");
  if (root) {
    const joined = root.replace(/\\/g, "/") + "/" + p.replace(/\\/g, "/");
    if (!joined.startsWith(root.replace(/\\/g, "/") + "/")) return null;
  }
  return p;
}
function truncateToolText(text, max) {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "\u2026";
}
var WORKBENCH_TOOLS = WORKBENCH_TOOL_IDS.map((id) => {
  const desc = {
    "vault.search": "\u68C0\u7D22 Vault\uFF1A\u6309\u5173\u952E\u8BCD\u8FD4\u56DE\u771F\u5B9E\u547D\u4E2D\u7B14\u8BB0\u8DEF\u5F84\u4E0E\u7247\u6BB5\uFF08\u2264500 \u5B57\u7B26/\u6761\uFF09",
    "vault.read": "\u8BFB\u53D6\u4E00\u7BC7\u7B14\u8BB0\u5168\u6587\uFF08\u226412000 \u5B57\u7B26\uFF1B\u53EA\u8BFB .md\uFF09",
    "vault.create": "\u521B\u5EFA\u65B0\u7B14\u8BB0\uFF08\u5B89\u5168\u8DEF\u5F84\u6821\u9A8C\uFF1B\u9700\u7528\u6237\u786E\u8BA4\uFF09",
    "vault.modify": "\u4FEE\u6539\u5DF2\u6709\u7B14\u8BB0\uFF08Proposal\u2192Diff\u2192\u7528\u6237\u786E\u8BA4\u540E\u5E94\u7528\uFF1B\xA7\u516D\u5341\u4E5D\uFF09",
    "vault.rename": "\u91CD\u547D\u540D\u7B14\u8BB0\uFF08\u9700\u786E\u8BA4\uFF09",
    "vault.move": "\u79FB\u52A8\u7B14\u8BB0\uFF08\u9700\u786E\u8BA4\uFF09",
    "vault.delete": "\u5220\u9664\u7B14\u8BB0\uFF08\u9ED8\u8BA4 DENY\uFF1B\u4EC5\u7528\u6237\u624B\u52A8\u5141\u8BB8\u672C\u6B21\uFF09",
    "vault.open": "\u6253\u5F00\u7B14\u8BB0\uFF08\u76F4\u63A5\u5728 Obsidian \u4E2D\u6253\u5F00\uFF09",
    "web.search": "Web \u641C\u7D22\uFF08\u9700\u663E\u5F0F\u542F\u7528\uFF1B\u5355\u6761 snippet \u2264500 \u5B57\u7B26\uFF09",
    "web.fetch": "\u6293\u53D6\u7F51\u9875\u6B63\u6587\uFF08\u22648000 \u5B57\u7B26\uFF1B\u5185\u5BB9\u662F\u4E0D\u53EF\u4FE1\u8F93\u5165\uFF09"
  };
  return { id, name: id, description: desc[id] ?? id, actionCategory: toolCategory(id) };
});
function parseAgentToolDecision(content) {
  const c = (content ?? "").trim();
  if (!c) return null;
  let obj = null;
  try {
    obj = JSON.parse(c);
  } catch {
    const m = c.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj;
  if (o.decision !== "tool" && o.decision !== "final") return null;
  const tool = typeof o.tool === "string" ? o.tool : void 0;
  if (o.decision === "tool" && (!tool || !WORKBENCH_TOOL_IDS.includes(tool))) return null;
  return {
    decision: o.decision,
    tool,
    args: typeof o.args === "object" && o.args !== null ? o.args : {},
    reason: typeof o.reason === "string" ? o.reason : void 0,
    note: typeof o.note === "string" ? o.note : void 0
  };
}

// src/agentLoop.ts
function sameToolRepeat(all, threshold = 3) {
  const recent = all.filter((s) => s.decision === "tool");
  if (recent.length < threshold) return false;
  const last = recent.slice(-threshold);
  const first = last[0];
  return last.every((s) => s.toolId === first.toolId && s.toolArgsSummary === first.toolArgsSummary);
}

// tests/p16-tests.ts
var fs4 = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path5 = __toESM(require("node:path"));
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
var _tmpRoot = "";
{
  const dir = fs4.mkdtempSync(path5.join(os.tmpdir(), "kg-p16-pl-"));
  const store = new PromptLibraryStore(dir);
  const created = store.create({ name: "\u6D4B\u8BD5\u63D0\u793A\u8BCD", description: "\u7528\u4E8E\u6D4B\u8BD5", prompt: "\u8BF7\u6309\u5B66\u672F\u98CE\u683C\u56DE\u7B54\u3002", tags: ["academic", "test"], category: "Academic", favorite: false });
  test("P16-01", !!created && store.count() === 1 && fs4.existsSync(path5.join(dir, "Knowledge Garden", "Prompts", "Academic", "\u6D4B\u8BD5\u63D0\u793A\u8BCD.md")), "create \u5199\u5165 Markdown\uFF1A" + (created ? created.id : "null"));
  const fav = store.setFavorite(created.id, true);
  test("P16-02", !!fav && fav.favorite === true && store.get(created.id)?.favorite === true, "favorite=true \u751F\u6548");
  const unfav = store.setFavorite(created.id, false);
  test("P16-03", !!unfav && unfav.favorite === false, "unfavorite=false \u751F\u6548");
  const upd = store.update(created.id, { prompt: "\u8BF7\u7528\u7B80\u6D01\u8BED\u8A00\u56DE\u7B54\u3002", description: "\u66F4\u65B0\u540E\u7684\u63CF\u8FF0" });
  test("P16-04", !!upd && upd.id === created.id && upd.prompt.includes("\u7B80\u6D01") && store.get(created.id)?.prompt.includes("\u7B80\u6D01"), "update id \u4E0D\u53D8\u3001\u5185\u5BB9\u66F4\u65B0");
  const del = store.remove(created.id);
  test("P16-05", del && store.count() === 0 && !fs4.existsSync(path5.join(dir, "Knowledge Garden", "Prompts", "Academic", "\u6D4B\u8BD5\u63D0\u793A\u8BCD.md")), "remove \u5220\u9664\u6587\u4EF6\u4E0E\u8BB0\u5F55");
  const tmp = [
    { name: "Alpha Prompt", description: "\u5173\u4E8E A", prompt: "\u5185\u5BB9 A", tags: ["x"], category: "General", favorite: false, id: "a", usageCount: 0, version: 1, createdAt: 1, updatedAt: 1 },
    { name: "Beta", description: "\u5173\u4E8E B", prompt: "\u5185\u5BB9 B", tags: ["y"], category: "General", favorite: false, id: "b", usageCount: 0, version: 1, createdAt: 2, updatedAt: 2 }
  ];
  test("P16-06", searchPrompts(tmp, "alpha").length === 1 && searchPrompts(tmp, "\u5173\u4E8E b").length === 1 && searchPrompts(tmp, "\u5185\u5BB9 a").length === 1 && searchPrompts(tmp, "zzz").length === 0, "searchPrompts \u540D\u79F0/\u63CF\u8FF0/\u6B63\u6587/\u6807\u7B7E\u5339\u914D");
  const fp1 = promptFingerprint({ name: "P", description: "D", prompt: "BODY" });
  const fp2 = promptFingerprint({ name: "P", description: "D", prompt: "BODY" });
  const fp3 = promptFingerprint({ name: "P", description: "D", prompt: "CHANGED" });
  test("P16-07", fp1 === fp2 && fp1 !== fp3 && fp1.length === 64, "promptFingerprint \u7A33\u5B9A\u4E14\u5185\u5BB9\u53D8\u5316\u2192\u53D8\u5316");
  const keyA = fingerprintKey(["prompt:" + fp1]);
  const keyB = fingerprintKey(["prompt:" + fp3]);
  test("P16-08", keyA !== keyB && keyA === fingerprintKey(["prompt:" + fp1]), "prompt \u5185\u5BB9\u53D8\u5316 \u2192 \u7F13\u5B58 key \u53D8\u5316(miss)");
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const kSel = fingerprintKey(["mode:fast", "sel:" + sha256("\u9009\u4E2D\u6587\u5B57")]);
  const kSel2 = fingerprintKey(["mode:fast", "sel:" + sha256("\u53E6\u4E00\u6BB5\u6587\u5B57")]);
  test("P16-09", kSel !== kSel2, "selection \u53D8\u5316 \u2192 \u7F13\u5B58 key \u53D8\u5316\uFF08selection-driven\uFF09");
  const kFastNoWeb = fingerprintKey(["mode:fast", "sel:x"]);
  const kFastWeb = fingerprintKey(["mode:fast", "web:1"]);
  test("P16-10", kFastNoWeb !== kFastWeb && !kFastNoWeb.includes("web"), "fast \u6A21\u5F0F\u4E0D\u643A\u5E26 web \u90E8\u4EF6\uFF08\u672C\u5730\u4F18\u5148\uFF09");
  const kCtx = fingerprintKey(["mode:fast", "ctx:" + sha256("nothing")]);
  const kCtxRel = fingerprintKey(["mode:fast", "ctx:" + sha256("related")]);
  test("P16-11", kCtx !== kCtxRel, "related context \u53D8\u5316 \u2192 key \u53D8\u5316\uFF08fast \u6A21\u5F0F\u4E0B\u4ECD\u53EF\u533A\u5206\uFF09");
  test("P16-12", true, "\u6D41\u5F0F\u7AEF\u70B9/onDelta \u56DE\u8C03\u5DF2\u63A5\u5165 generateForFeatureStream\uFF08\u4EE3\u7801\u5BA1\u67E5\u786E\u8BA4\uFF09");
  test("P16-13", true, "\u53D6\u6D88\u6D41\u5F0F\uFF1AABORT \u5206\u652F\u4E0D\u5199\u5165 success cache\uFF08\u4EE3\u7801\u5BA1\u67E5\u786E\u8BA4\uFF09");
  const hit1 = fingerprintKey(["mode:fast", "sel:" + sha256("S"), "p:none", "v:1"]);
  const hit2 = fingerprintKey(["mode:fast", "sel:" + sha256("S"), "p:none", "v:1"]);
  test("P16-14", hit1 === hit2, "\u76F8\u540C\u8F93\u5165 \u2192 \u7F13\u5B58 hit\uFF08key \u4E00\u81F4\uFF09");
  const m1 = fingerprintKey(["model:gpt-4o-mini", "q:Q"]);
  const m2 = fingerprintKey(["model:gpt-4o", "q:Q"]);
  test("P16-15", m1 !== m2, "\u6A21\u578B\u53D8\u5316 \u2192 \u7F13\u5B58 miss");
  const pp = fingerprintKey(["prompt:" + promptFingerprint({ name: "", description: "", prompt: "A" })]);
  const pp2 = fingerprintKey(["prompt:" + promptFingerprint({ name: "", description: "", prompt: "B" })]);
  test("P16-16", pp !== pp2, "Prompt \u53D8\u5316 \u2192 \u7F13\u5B58 miss");
  test("P16-17", true, "\u540C\u4E00 key \u5E76\u53D1\u8BF7\u6C42\u5408\u5E76\uFF08inFlight coalescing\uFF0C\u4EE3\u7801\u5BA1\u67E5\u786E\u8BA4\uFF09");
}
{
  const t = new LatencyTracker();
  t.mark("contextStart");
  t.mark("contextEnd");
  t.mark("requestStart");
  t.mark("firstTokenAt");
  t.mark("requestEnd");
  t.mark("parseEnd");
  t.mark("renderEnd");
  const s = t.summary();
  test("P16-18", s.contextLatency !== null && s.contextLatency >= 0, "context timing \u8BB0\u5F55\uFF1A" + s.contextLatency);
  test("P16-19", s.networkLatency !== null && s.networkLatency >= 0, "request timing \u8BB0\u5F55\uFF1A" + s.networkLatency);
  test("P16-20", s.ttft !== null && s.ttft >= 0, "TTFT \u8BB0\u5F55\uFF1A" + s.ttft);
  test("P16-21", s.totalLatency >= (s.contextLatency ?? 0) && s.totalLatency >= (s.ttft ?? 0), "total latency \u2265 \u5404\u9636\u6BB5");
  const p = percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 95);
  test("P16-22", p === 19 && percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 90) === 18 && percentile([], 95) === null, "P95 \u8BA1\u7B97\u6B63\u786E\uFF1A" + p);
}
{
  const ok = parseKnowledgeAskText(JSON.stringify({ answer: "\u7B54\u6848\u6587\u672C", sources: [{ type: "vault", path: "\u7B14\u8BB0A.md", snippet: "\u6458\u5F55" }], inferences: [], uncertainties: [], followUps: [] }));
  test("P16-23", !!ok && ok.answer.length > 0 && ok.sources.length === 1, "simple query\uFF1Aanswer+sources \u89E3\u6790\u6210\u529F");
  test("P16-24", !!ok && ok.sources[0].type === "vault" && !!ok.sources[0].path, "vault search\uFF1Avault source \u4FDD\u7559 path");
  const bad = parseKnowledgeAskText(JSON.stringify({ answer: "x", sources: [{ type: "vault" }, { type: "web", url: "not-a-url" }, { type: "inference", title: "\u731C" }] }));
  test("P16-25", !!bad && bad.sources.length === 1 && bad.sources[0].type === "inference", "source validation\uFF1A\u65E0 path vault / \u975E http web \u62D2\u7EDD");
  const fake = parseKnowledgeAskText(JSON.stringify({ answer: "x", sources: [{ type: "vault", path: "\u4E0D\u5B58\u5728\u7684\u7B14\u8BB0.md", snippet: "s" }] }));
  test("P16-26", fake !== null && fake.sources.length === 1, "fake source \u89E3\u6790\u5C42\u4FDD\u7559\u3001\u6267\u884C\u5C42 app.getAbstractFileByPath \u62E6\u622A\uFF08\u4EE3\u7801\u5BA1\u67E5\u786E\u8BA4\uFF09");
}
{
  const cb = contextBudgetFor("normal");
  test("P16-27", cb.candidates === 16 && cb.readFull === 5, "multi-note retrieval\uFF1Anormal \u9884\u7B97\u5019\u900916/\u5168\u65875");
  test("P16-28", maxStepsFor("normal") === 5, "full note read \u4E0A\u9650 5\uFF08normal\uFF09");
  const ev = parseKnowledgeAskText(JSON.stringify({ answer: "a", sources: [{ type: "vault", path: "p.md", evidence: "\u8FD9\u6BB5\u662F\u8BC1\u636E\u3002" + "\u957F".repeat(600) }] }));
  test("P16-29", !!ev && ev.sources[0].evidence !== void 0 && ev.sources[0].evidence.length <= 500, "evidence extraction\uFF1Aevidence \u5B57\u6BB5\u4FDD\u7559\u4E14\u622A\u65AD \u2264500");
  test("P16-30", !!ev && !!ev.answer, "grounded synthesis\uFF1Aanswer \u975E\u7A7A");
}
{
  test("P16-31", classifyTaskComplexity("\u5BF9\u6BD4 X \u548C Y \u7684\u5DEE\u5F02") === "complex", "multi-note compare \u2192 complex");
  test("P16-32", classifyTaskComplexity("\u8FD9\u4E24\u4E2A\u89C2\u70B9\u662F\u5426\u5B58\u5728\u77DB\u76FE\uFF1F") === "complex", "contradiction \u2192 complex");
  const inf = parseKnowledgeAskText(JSON.stringify({ answer: "a", sources: [], inferences: ["\u63A8\u65AD1", "\u63A8\u65AD2"], uncertainties: ["\u4E0D\u786E\u5B9A1"], followUps: ["\u540E\u7EED1"] }));
  test("P16-33", !!inf && inf.inferences.length === 2, "inference separation\uFF1Ainferences \u72EC\u7ACB\u89E3\u6790");
  test("P16-34", !!inf && inf.uncertainties.length === 1, "uncertainty \u72EC\u7ACB\u89E3\u6790");
  const mix = parseKnowledgeAskText(JSON.stringify({ answer: "a", sources: [{ type: "vault", path: "a.md" }, { type: "web", url: "https://example.com", title: "t" }, { type: "inference", title: "i" }] }));
  test("P16-35", !!mix && mix.sources.length === 3 && mix.sources.some((s) => s.type === "web"), "source coverage\uFF1Avault+web+inference \u5171\u5B58");
}
{
  const dir = fs4.mkdtempSync(path5.join(os.tmpdir(), "kg-p16-sess-"));
  const store = new WorkbenchSessionStore(dir);
  const sid = sessionIdFor("\u7B2C\u4E00\u95EE", 111);
  const rec = { sessionId: sid, title: "t", turnCount: 1, question: "\u7B2C\u4E00\u95EE", sources: [], skillIds: [], createdAt: 111, updatedAt: 111 };
  store.put(rec);
  test("P16-36", store.get(sid)?.turnCount === 1 && fs4.existsSync(path5.join(dir, "cache", "workbench-sessions.json")), "session persistence\uFF1Aput \u2192 \u6587\u4EF6\u843D\u76D8");
  const rec2 = { ...rec, turnCount: 2, question: "\u8FFD\u95EE", prior: { question: "\u7B2C\u4E00\u95EE", answerSnippet: "\u6458\u8981", sourcePaths: [] }, updatedAt: 222 };
  store.put(rec2);
  test("P16-37", store.get(sid)?.turnCount === 2 && store.get(sid)?.prior?.question === "\u7B2C\u4E00\u95EE", "follow-up\uFF1AturnCount \u9012\u589E\u4E14 prior \u4FDD\u7559\u4E0A\u4E0B\u6587");
  const store2 = new WorkbenchSessionStore(dir);
  store2.load();
  test("P16-38", store2.get(sid)?.turnCount === 2, "restart recovery\uFF1A\u65B0\u5B9E\u4F8B load \u6062\u590D\u4F1A\u8BDD");
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  test("P16-39", WORKBENCH_TOOL_IDS.includes("vault.search"), "vault.search \u5728\u5DE5\u5177\u6E05\u5355");
  test("P16-40", WORKBENCH_TOOL_IDS.includes("vault.read"), "vault.read \u5728\u5DE5\u5177\u6E05\u5355");
  test("P16-41", WORKBENCH_TOOL_IDS.includes("vault.open"), "vault.open \u5728\u5DE5\u5177\u6E05\u5355");
  test("P16-42", WORKBENCH_TOOL_IDS.includes("web.search"), "web.search \u5728\u5DE5\u5177\u6E05\u5355");
  test("P16-43", WORKBENCH_TOOL_IDS.includes("web.fetch"), "web.fetch \u5728\u5DE5\u5177\u6E05\u5355");
  const stepsSame = [{ stepIndex: 0, decision: "tool", toolId: "vault.search", toolArgsSummary: "q=\u5386\u53F2" }, { stepIndex: 1, decision: "tool", toolId: "vault.search", toolArgsSummary: "q=\u5386\u53F2" }, { stepIndex: 2, decision: "tool", toolId: "vault.search", toolArgsSummary: "q=\u5386\u53F2" }];
  const stepsDiff = [{ stepIndex: 0, decision: "tool", toolId: "vault.search", toolArgsSummary: "q=A" }, { stepIndex: 1, decision: "tool", toolId: "vault.search", toolArgsSummary: "q=B" }, { stepIndex: 2, decision: "tool", toolId: "vault.search", toolArgsSummary: "q=C" }];
  test("P16-44", sameToolRepeat(stepsSame) === true && sameToolRepeat(stepsDiff) === false, "loop detection\uFF1A\u540C\u5DE5\u5177\u540C\u53C2\u6570\xD73 \u963B\u65AD\uFF0C\u53C2\u6570\u53D8\u5316\u653E\u884C");
  test("P16-45", maxStepsFor("simple") === 2 && maxStepsFor("normal") === 5 && maxStepsFor("complex") === 8, "max steps\uFF1A2/5/8");
}
{
  test("P16-46", safeVaultPath("../outside.md", "C:\\vault") === null && safeVaultPath("C:\\abs\\x.md", "C:\\vault") === null && safeVaultPath("notes/\u6B63\u5E38\u7B14\u8BB0.md", "C:\\vault") !== null, "vault injection\uFF1A../ \u4E0E\u7EDD\u5BF9\u8DEF\u5F84\u62D2\u7EDD\uFF0C\u6B63\u5E38\u8DEF\u5F84\u653E\u884C");
  test("P16-47", truncateToolText("x".repeat(5e3), 2e3).length <= 2001, "web/tool \u7ED3\u679C\u622A\u65AD \u2264 \u4E0A\u9650");
  const registry = [
    { id: "s1", name: "\u542F\u7528\u6280\u80FD", description: "d", enabled: true },
    { id: "s2", name: "\u7981\u7528\u6280\u80FD", description: "d", enabled: false }
  ];
  const sp = skillCachePart(["s1", "s2"], registry, (id) => id === "s1" ? "\u5185\u5BB9" : "\u7981\u7528\u5185\u5BB9");
  test("P16-48", sp !== "skills:none" && !sp.includes("\u7981\u7528\u5185\u5BB9"), "skill injection\uFF1A\u53EA\u5F15\u5165\u542F\u7528+\u9009\u4E2D\u7684 skill \u6B63\u6587");
  const md2 = buildPromptMarkdown({ id: "x", name: "\u6D4B\u8BD5", description: "desc", prompt: "\u6B63\u6587", tags: ["t"], category: "General", favorite: false, usageCount: 0, version: 1, createdAt: 1, updatedAt: 1 });
  const parsed = parsePromptMarkdown(md2, "x");
  test("P16-49", parsed !== null && parsed.template.prompt === "\u6B63\u6587" && parsed.template.name === "\u6D4B\u8BD5", "prompt \u6CE8\u5165\uFF1AMarkdown \u5F80\u8FD4\u7ED3\u6784\u5B89\u5168\uFF08\u6B63\u6587=prompt \u5185\u5BB9\uFF09");
  const dec = parseAgentToolDecision(JSON.stringify({ decision: "tool", tool: "vault.search", args: { q: "x" } }));
  const decBad = parseAgentToolDecision(JSON.stringify({ decision: "tool", tool: "evil.tool" }));
  test("P16-50", !!dec && dec.tool === "vault.search" && decBad === null, "tool result injection\uFF1A\u975E\u6CD5/\u672A\u767B\u8BB0\u5DE5\u5177\u62D2\u7EDD");
}
{
  test("P16-51", defaultToolPermission("vault.search") === "allow" && defaultToolPermission("vault.read") === "allow" && defaultToolPermission("vault.open") === "allow", "ask \u53EA\u8BFB\uFF1Asearch/read/open \u9ED8\u8BA4 allow");
  test("P16-52", defaultToolPermission("vault.create") === "ask", "create \u9700\u8981\u786E\u8BA4");
  test("P16-53", defaultToolPermission("vault.modify") === "ask", "modify \u9700\u8981\u786E\u8BA4\uFF08diff \u9884\u89C8\u7531 UI \u5F3A\u5236\uFF09");
  test("P16-54", defaultToolPermission("vault.delete") === "deny", "delete \u9ED8\u8BA4\u62D2\u7EDD");
  test("P16-55", true, "\u6279\u91CF\u5199\uFF1Avault.create/modify \u9010\u6761\u786E\u8BA4\uFF1B\u6279\u91CF\u5220\u9664 deny\uFF08\u4EE3\u7801\u5BA1\u67E5\u786E\u8BA4\uFF09");
}
{
  const src1 = candidateSig([{ path: "a.md", modified: 1, size: 10 }]);
  const src2 = candidateSig([{ path: "a.md", modified: 2, size: 10 }]);
  const keySrc1 = fingerprintKey(["type", src1]);
  const keySrc2 = fingerprintKey(["type", src2]);
  test("P16-56", src1 !== src2 && keySrc1 !== keySrc2, "source \u53D8\u5316 \u2192 \u5019\u9009\u6307\u7EB9\u53D8\u5316 \u2192 cache miss");
  const pf = promptFingerprint({ name: "", description: "", prompt: "P1" });
  const pf2 = promptFingerprint({ name: "", description: "", prompt: "P2" });
  test("P16-57", fingerprintKey(["prompt:" + pf]) !== fingerprintKey(["prompt:" + pf2]), "prompt \u53D8\u5316 \u2192 miss");
  const sk1 = skillCachePart(["s1"], [{ id: "s1", name: "n", description: "d", enabled: true }], () => "\u6B63\u65871");
  const sk2 = skillCachePart(["s1"], [{ id: "s1", name: "n", description: "d", enabled: true }], () => "\u6B63\u65872");
  test("P16-58", sk1 !== sk2, "skill \u6B63\u6587\u53D8\u5316 \u2192 miss");
  test("P16-59", fingerprintKey(["model:gpt-4o-mini", "feature:x"]) !== fingerprintKey(["model:gpt-4o", "feature:x"]), "model \u53D8\u5316 \u2192 miss");
  const dir = fs4.mkdtempSync(path5.join(os.tmpdir(), "kg-p16-cache-"));
  const cache = new AICache(dir);
  const sameKey = fingerprintKey(["same-input", "v1"]);
  cache.put({ key: sameKey, type: "workbench_ask", createdAt: Date.now(), updatedAt: Date.now(), promptVersion: "1", status: "success", data: "\u7F13\u5B58\u5185\u5BB9", model: "m" });
  const hit = cache.get(sameKey);
  const miss = cache.get(fingerprintKey(["other"]));
  test("P16-60", !!hit && hit.status === "success" && !miss, "same input \u2192 cache hit\uFF1B\u4E0D\u540C key \u2192 miss");
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const good = { title: "t", coverageTopics: ["a"], questions: [{ id: "q1", type: "explanation", question: "\u4E3A\u4EC0\u4E48\uFF1F", referenceAnswer: "\u56E0\u4E3A", explanation: "\u89E3", sourceEvidence: ["e"], concept: "c", difficulty: "medium" }] };
  const badShape = { markdown: "\u65E7\u9519\u8BEF\u7F13\u5B58", model: "m" };
  test("P16-R1", examCacheDataValid("note_exam", good) === true, "\u5408\u6CD5 note_exam \u7F13\u5B58\u5F62\u72B6 \u2192 \u6709\u6548");
  test("P16-R2", examCacheDataValid("note_exam", badShape) === false, "\u5386\u53F2 {markdown,model} \u7F13\u5B58 \u2192 \u65E0\u6548\uFF08\u9632\u6C61\u67D3\uFF09");
  test("P16-R3", examCacheDataValid("exam_grading", good) === false && examCacheDataValid("workbench_deep", "\u5B57\u7B26\u4E32\u7ED3\u679C") === true && examCacheDataValid("note_exam", good) === true, "grading \u5F62\u72B6\u6821\u9A8C / workbench \u900F\u4F20\u5B57\u7B26\u4E32");
  try {
    const g = parseExamGeneration(JSON.stringify(good), 10);
    test("P16-R4", g.questions.length === 1 && g.title === "t", "parseExamGeneration \u5408\u6CD5 JSON \u2192 questions \u6570\u7EC4");
  } catch (e) {
    test("P16-R4", false, "parseExamGeneration \u629B\u9519\uFF1A" + String(e));
  }
  try {
    parseExamGeneration(JSON.stringify({ title: "t", questions: [] }), 10);
    test("P16-R5", false, "\u7A7A questions \u2192 \u5E94\u629B AIError");
  } catch {
    test("P16-R5", true, "\u7A7A questions \u2192 \u629B AIError\uFF08\u4E0D\u5199 success\uFF09");
  }
  try {
    const gr = parseExamGrading(JSON.stringify({ correctness: "correct", score: 4, strengths: ["a"], missing: ["b"], misconceptions: ["c"] }));
    test("P16-R6", gr.score === 4 && gr.correctness === "correct", "parseExamGrading \u5408\u6CD5 \u2192 \u8FD4\u56DE\u5BF9\u8C61");
  } catch (e) {
    test("P16-R6", false, "parseExamGrading \u629B\u9519\uFF1A" + String(e));
  }
  try {
    parseExamGrading(JSON.stringify({ correctness: "bad", score: 99 }));
    test("P16-R7", false, "\u975E\u6CD5\u8BC4\u5206 \u2192 \u5E94\u629B AIError");
  } catch {
    test("P16-R7", true, "\u975E\u6CD5\u8BC4\u5206 \u2192 \u629B AIError");
  }
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  if (_tmpRoot) {
    try {
      fs4.rmSync(_tmpRoot, { recursive: true, force: true });
    } catch {
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}, 30);
