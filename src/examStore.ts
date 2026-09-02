/** Exam / Review Card 本地存储（Phase 14 §一百四十五/一百四十六/一百四十七）。
 * - Markdown 是用户可读资产 + 恢复源（Exams/*.md、Review Cards/*.md）；JSON 是快速索引（cache/exams.json、cache/cards.json）。
 * - 保存/打开/收藏/删除全部 0 AI（§一百一十一~一百一十三）；清空 AI Cache 不影响 Exam / Card（§七十八）。
 * - 纯函数（examMarkdown / cardMarkdown / 解析）无 Obsidian DOM 依赖，便于 Node 测试。
 */
import type { CardReviewRecord, ExamAnswer, ExamAnswerMode, ExamDifficulty, ExamMode, ExamQuestion, ExamSessionState, ExamSource, MasteryRating, NoteExam, SavedReviewCard } from "./types";
import { fingerprintKey } from "./ai/cache";
import { atomicWriteJson, isolateCorruptFile } from "./migrations";
import * as fs from "fs";

function escYaml(s: string): string {
  return '"' + (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function unescYaml(s: string): string {
  const m = /^"(.*)"$/.exec(s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s;
}

/** Exam 指纹（§四十一 cache key 的主要成分）：sourcePath + sourceVersion + mode + topic + count + difficulty + answerMode */
export function examFingerprint(e: { sourcePath: string; sourceVersion: string; mode: string; topic?: string; questionCount: number; difficulty?: string; answerMode: string }): string {
  return fingerprintKey([
    "exam",
    e.sourcePath,
    e.sourceVersion,
    e.mode,
    e.topic ?? "",
    String(e.questionCount),
    e.difficulty ?? "medium",
    e.answerMode,
  ]);
}

function examId(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return "exam-" + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + "-" + now.getTime().toString(36);
}
function cardId(now = new Date()): string {
  return "card-" + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ---------- Exam Markdown（§一百一十八） ---------- */
function yamlQuestionsBlock(questions: ExamQuestion[]): string[] {
  const out: string[] = [];
  for (const q of questions) {
    out.push("  - id: " + escYaml(q.id));
    out.push("    type: " + q.type);
    out.push("    question: " + escYaml(q.question));
    if (q.options && q.options.length) out.push("    options: [" + q.options.map(escYaml).join(", ") + "]");
    if (q.correctAnswer) out.push("    correctAnswer: " + escYaml(q.correctAnswer));
    out.push("    referenceAnswer: " + escYaml(q.referenceAnswer));
    if (q.explanation) out.push("    explanation: " + escYaml(q.explanation));
    if (q.sourceEvidence && q.sourceEvidence.length) out.push("    sourceEvidence: [" + q.sourceEvidence.map(escYaml).join(", ") + "]");
    if (q.concept) out.push("    concept: " + escYaml(q.concept));
    if (q.difficulty) out.push("    difficulty: " + q.difficulty);
  }
  return out;
}

export function examMarkdown(e: NoteExam): string {
  const dateStr = new Date(e.createdAt).toISOString().slice(0, 10);
  const body: string[] = [];
  for (let i = 0; i < e.questions.length; i++) {
    const q = e.questions[i];
    body.push("", "## " + (i + 1) + ". " + q.question, "",
      ...(q.options && q.options.length ? ["**选项：**", ...q.options.map((o) => "- " + o), ""] : []),
      "### 参考答案", "", q.referenceAnswer, "",
      ...(q.explanation ? ["### 解释", "", q.explanation, ""] : []),
      ...(q.sourceEvidence && q.sourceEvidence.length ? ["### 原文依据", "", ...q.sourceEvidence.map((s) => "- " + s), ""] : []),
    );
  }
  return [
    "---",
    "type: knowledge-exam",
    'examId: "' + e.id + '"',
    'sourcePath: "' + e.sourcePath + '"',
    'sourceVersion: "' + e.sourceVersion + '"',
    'mode: "' + e.mode + '"',
    ...(e.topic ? ['topic: "' + e.topic + '"'] : []),
    "questionCount: " + e.questionCount,
    ...(e.difficulty ? ['difficulty: "' + e.difficulty + '"'] : []),
    'answerMode: "' + e.answerMode + '"',
    "examVersion: " + (e.examVersion ?? 1),
    ...(e.coverageTopics && e.coverageTopics.length ? ["coverageTopics: [" + e.coverageTopics.map(escYaml).join(", ") + "]"] : []),
    "questions:",
    ...yamlQuestionsBlock(e.questions),
    "createdAt: " + e.createdAt,
    "---",
    "",
    "# " + e.title,
    "",
    "> 来源：" + (e.sourcePath || "") + "（考试生成时快照版本 " + e.sourceVersion + "，重新生成会递增版本）",
    "",
    "考试：整体考察" + (e.topic ? " · 主题：" + e.topic : "") + " · " + e.questionCount + " 题 · 答案来源：" + e.answerMode,
    "",
    ...body,
    "",
    "<!-- " + dateStr + " -->",
  ].join("\n");
}

interface ParsedExam {
  exam: NoteExam | null;
  questions: ExamQuestion[];
}

export function parseExamMarkdown(md: string): ParsedExam {
  const fm = parseExamFrontmatter(md);
  if (!fm) return { exam: null, questions: [] };
  try {
    const exam: NoteExam = {
      id: fm.examId,
      sourcePath: fm.sourcePath,
      sourceVersion: fm.sourceVersion,
      title: fm.title,
      mode: fm.mode === "custom" ? "custom" : "holistic",
      topic: fm.topic,
      questionCount: fm.questionCount,
      difficulty: fm.difficulty === "easy" || fm.difficulty === "hard" ? fm.difficulty : fm.difficulty === "medium" ? "medium" : undefined,
      answerMode: fm.answerMode === "source_only" || fm.answerMode === "web_allowed" ? fm.answerMode : "source_preferred",
      questions: fm.questions,
      examVersion: fm.examVersion ?? 1,
      coverageTopics: fm.coverageTopics,
      createdAt: fm.createdAt ?? Date.now(),
      updatedAt: fm.createdAt ?? Date.now(),
    };
    return { exam, questions: fm.questions };
  } catch {
    return { exam: null, questions: [] };
  }
}

/* ---------- 简化 frontmatter 行解析（键: 值, 支持多行子健列表与内联数组） ---------- */
interface ExamFrontmatter {
  examId: string;
  sourcePath: string;
  sourceVersion: string;
  title: string;
  mode: string;
  topic?: string;
  questionCount: number;
  difficulty?: string;
  answerMode: string;
  examVersion?: number;
  coverageTopics?: string[];
  createdAt?: number;
  questions: ExamQuestion[];
}

/** 解析生成端 yamlQuestionsBlock 的多行格式（§一百一十八）：
 *  questions:
 *    - id: "..."
 *      type: recall
 *      question: "..."
 *      options: ["...", "..."]
 *      ...
 */
function parseExamFrontmatter(md: string): ExamFrontmatter | null {
  if (!md.startsWith("---")) return null;
  const end = md.indexOf("\n---", 3);
  if (end < 0) return null;
  const block = md.slice(3, end);
  const lines = block.split("\n");
  const kv = new Map<string, string>();
  const questionItems: Record<string, string>[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const top = /^([A-Za-z]+): ?(.*)$/.exec(line);
    if (!top) { i++; continue; }
    const k = top[1];
    const v = top[2].trim();
    if (k === "questions" && v === "") {
      let cur: Record<string, string> | null = null;
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (/^[A-Za-z]+:/.test(l)) break;
        const dash = /^  - (.+)$/.exec(l);
        if (dash) {
          cur = {};
          questionItems.push(cur);
          const first = /^([A-Za-z]+): ?(.*)$/.exec(dash[1]);
          if (first) cur[first[1]] = unescYaml(first[2].trim());
          j++;
          continue;
        }
        const sub = /^    ([A-Za-z]+): ?(.*)$/.exec(l);
        if (sub && cur) { cur[sub[1]] = unescYaml(sub[2].trim()); j++; continue; }
        if (!l.trim()) { j++; continue; }
        break;
      }
      i = j;
      continue;
    }
    kv.set(k, v);
    i++;
  }
  const examId = unescYaml(kv.get("examId") ?? "");
  if (!examId) return null;
  const inlineArr = (v?: string): string[] | undefined => {
    if (!v) return undefined;
    if (v.startsWith("[") && v.endsWith("]")) {
      return v.slice(1, -1).split(",").map((s) => unescYaml(s.trim())).filter(Boolean);
    }
    return undefined;
  };
  const questions: ExamQuestion[] = [];
  const TYPES = ["recall", "explanation", "comparison", "application", "true_false", "multiple_choice", "counterexample"];
  for (const item of questionItems) {
    const qid = item["id"] ?? "";
    const qq = item["question"] ?? "";
    if (!qid || !qq) continue;
    const qtype = item["type"] ?? "recall";
    questions.push({
      sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
      id: qid,
      type: TYPES.includes(qtype) ? qtype as ExamQuestion["type"] : "recall",
      question: qq,
      options: inlineArr(item["options"]),
      correctAnswer: item["correctAnswer"] || undefined,
      referenceAnswer: item["referenceAnswer"] ?? "",
      explanation: item["explanation"] || undefined,
      sourceEvidence: inlineArr(item["sourceEvidence"]),
      concept: item["concept"] || undefined,
      difficulty: item["difficulty"] === "easy" || item["difficulty"] === "hard" ? item["difficulty"] : item["difficulty"] === "medium" ? "medium" : undefined,
    });
  }
  return {
    examId,
    sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
    sourceVersion: unescYaml(kv.get("sourceVersion") ?? ""),
    title: unescYaml(kv.get("title") ?? "") || examId,
    mode: kv.get("mode") ?? "holistic",
    topic: unescYaml(kv.get("topic") ?? ""),
    questionCount: parseInt(kv.get("questionCount") ?? "0", 10) || 0,
    difficulty: kv.get("difficulty"),
    answerMode: kv.get("answerMode") ?? "source_preferred",
    examVersion: parseInt(kv.get("examVersion") ?? "1", 10) || 1,
    coverageTopics: inlineArr(kv.get("coverageTopics")),
    createdAt: parseInt(kv.get("createdAt") ?? "", 10) || undefined,
    questions,
  };
}

/* ---------- Review Card Markdown（§一百四十七） ---------- */
export function cardMarkdown(c: SavedReviewCard): string {
  const dateStr = new Date(c.createdAt).toISOString().slice(0, 10);
  const wiki = (p: string): string => "[[" + (p.split("/").pop() ?? p).replace(/\.md$/i, "") + "]]";
  return [
    "---",
    "type: review-card",
    'cardId: "' + c.id + '"',
    'sourcePath: "' + c.sourcePath + '"',
    'sourceVersion: "' + c.sourceVersion + '"',
    ...(c.examId ? ['examId: "' + c.examId + '"'] : []),
    'questionType: "' + c.questionType + '"',
    ...(c.concept ? ['concept: "' + c.concept + '"'] : []),
    ...(c.tags && c.tags.length ? ["tags: [" + c.tags.map(escYaml).join(", ") + "]"] : []),
    "createdAt: " + c.createdAt,
    "---",
    "",
    "# " + c.question,
    "",
    "## 答案",
    "",
    c.answer,
    "",
    ...(c.explanation ? ["## 解释", "", c.explanation, ""] : []),
    ...(c.sourceEvidence && c.sourceEvidence.length ? ["## 原文依据", "", ...c.sourceEvidence.map((s) => "- " + s), ""] : []),
    "",
    "## 来源",
    "",
    wiki(c.sourcePath),
    "",
    "<!-- " + dateStr + " -->",
  ].join("\n");
}

interface ParsedCard {
  card: SavedReviewCard | null;
}

export function parseCardMarkdown(md: string): ParsedCard {
  if (!md.startsWith("---")) return { card: null };
  const end = md.indexOf("\n---", 3);
  if (end < 0) return { card: null };
  const block = md.slice(3, end);
  const kv = new Map<string, string>();
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (v === "") continue;
    kv.set(k, v);
  }
  const inlineArr = (v?: string): string[] | undefined => {
    if (!v) return undefined;
    if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map((s) => unescYaml(s.trim())).filter(Boolean);
    return undefined;
  };
  const id = unescYaml(kv.get("cardId") ?? "");
  if (!id) return { card: null };
  const hashIdx = md.indexOf("# ", end);
  const q = hashIdx >= 0 ? md.slice(hashIdx + 2, md.indexOf("\n", hashIdx)).trim() || id : id;
  const ansM = /^## 答案[\s\S]*?\n\n([\s\S]*?)\n\n## /m.exec(md.slice(end));
  const expM = /^## 解释[\s\S]*?\n\n([\s\S]*?)\n\n## /m.exec(md.slice(end));
  const card: SavedReviewCard = {
    id,
    sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
    sourceVersion: unescYaml(kv.get("sourceVersion") ?? ""),
    examId: unescYaml(kv.get("examId") ?? ""),
    question: q,
    answer: ansM ? ansM[1].trim() : "",
    explanation: expM ? expM[1].trim() : undefined,
    questionType: (["recall", "explanation", "comparison", "application", "true_false", "multiple_choice", "counterexample"] as string[]).includes(kv.get("questionType") ?? "") ? kv.get("questionType") as SavedReviewCard["questionType"] : "recall",
    concept: unescYaml(kv.get("concept") ?? ""),
    tags: inlineArr(kv.get("tags")),
    createdAt: parseInt(kv.get("createdAt") ?? "", 10) || Date.now(),
    updatedAt: Date.now(),
  };
  return { card };
}

/* ---------- Store：cache/exams.json ---------- */
export class ExamStore {
  private entries: NoteExam[] = [];
  private dirty = false;
  constructor(private baseDir: string) {}
  private file(): string { return this.baseDir + "/cache/exams.json"; }
  load(): boolean {
    try {
      const raw = fs.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw) as { entries?: NoteExam[] };
      this.entries = Array.isArray(obj.entries) ? obj.entries : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.entries = [];
      this.dirty = true;
      return true;
    }
  }
  all(): NoteExam[] { return [...this.entries].sort((a, b) => b.createdAt - a.createdAt); }
  count(): number { return this.entries.length; }
  get(id: string): NoteExam | undefined { return this.entries.find((e) => e.id === id); }
  findByFingerprint(fp: string): NoteExam | undefined { return this.entries.find((e) => examFingerprint(e) === fp); }
  findBySource(sourcePath: string): NoteExam[] { return this.entries.filter((e) => e.sourcePath === sourcePath); }
  add(e: NoteExam): void { this.entries.push(e); this.dirty = true; this.flush(); }
  update(id: string, patch: Partial<NoteExam>): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.dirty = true; this.flush();
  }
  remove(id: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) { this.dirty = true; this.flush(); }
  }
  migratePaths(oldPath: string, newPath: string): void {
    let changed = false;
    for (const e of this.entries) if (e.sourcePath === oldPath) { e.sourcePath = newPath; changed = true; }
    if (changed) { this.dirty = true; this.flush(); }
  }
  replaceAll(entries: NoteExam[]): void { this.entries = entries; this.dirty = true; this.flush(); }
  flush(): void {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries } as never);
    this.dirty = false;
  }
}

/* ---------- Store：cache/cards.json（收藏复习卡，独立于 AI Cache §七十八） ---------- */
export class ReviewCardStore {
  private entries: SavedReviewCard[] = [];
  private dirty = false;
  constructor(private baseDir: string) {}
  private file(): string { return this.baseDir + "/cache/cards.json"; }
  load(): boolean {
    try {
      const raw = fs.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw) as { entries?: SavedReviewCard[] };
      this.entries = Array.isArray(obj.entries) ? obj.entries : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.entries = [];
      this.dirty = true;
      return true;
    }
  }
  all(): SavedReviewCard[] { return [...this.entries].sort((a, b) => b.createdAt - a.createdAt); }
  count(): number { return this.entries.length; }
  get(id: string): SavedReviewCard | undefined { return this.entries.find((e) => e.id === id); }
  findByExam(examId: string): SavedReviewCard[] { return this.entries.filter((e) => e.examId === examId); }
  remove(id: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) { this.dirty = true; this.flush(); }
  }
  update(id: string, patch: Partial<SavedReviewCard>): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.dirty = true; this.flush();
  }
  migratePaths(oldPath: string, newPath: string): void {
    let changed = false;
    for (const e of this.entries) if (e.sourcePath === oldPath) { e.sourcePath = newPath; changed = true; }
    if (changed) { this.dirty = true; this.flush(); }
  }
  replaceAll(entries: SavedReviewCard[]): void { this.entries = entries; this.dirty = true; this.flush(); }
  add(card: SavedReviewCard): void { this.entries.push(card); this.dirty = true; this.flush(); }
  flush(): void {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries } as never);
    this.dirty = false;
  }
}

/* ---------- Store：cache/exam-sessions.json（§一百八十七/一百八十八 持久化，可在重启后继续） ---------- */
export class ExamSessionStore {
  private sessions: ExamSessionState[] = [];
  private dirty = false;
  constructor(private baseDir: string) {}
  private file(): string { return this.baseDir + "/cache/exam-sessions.json"; }
  load(): boolean {
    try {
      const raw = fs.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw) as { sessions?: ExamSessionState[] };
      this.sessions = Array.isArray(obj.sessions) ? obj.sessions : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.sessions = [];
      this.dirty = true;
      return true;
    }
  }
  get(examId: string): ExamSessionState | undefined { return this.sessions.find((s) => s.examId === examId && s.status !== "abandoned"); }
  all(): ExamSessionState[] { return [...this.sessions]; }
  upsert(s: ExamSessionState): void {
    const i = this.sessions.findIndex((x) => x.examId === s.examId);
    if (i >= 0) this.sessions[i] = s; else this.sessions.push(s);
    this.dirty = true; this.flush();
  }
  remove(examId: string): void {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.examId !== examId);
    if (this.sessions.length !== before) { this.dirty = true; this.flush(); }
  }
  replaceAll(s: ExamSessionState[]): void { this.sessions = s; this.dirty = true; this.flush(); }
  flush(): void {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, sessions: this.sessions } as never);
    this.dirty = false;
  }
}

/* ---------- Store：cache/card-reviews.json（§九十一 CardReviewRecord） ---------- */
export class CardReviewStore {
  private records: CardReviewRecord[] = [];
  private dirty = false;
  constructor(private baseDir: string) {}
  private file(): string { return this.baseDir + "/cache/card-reviews.json"; }
  load(): boolean {
    try {
      const raw = fs.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw) as { records?: CardReviewRecord[] };
      this.records = Array.isArray(obj.records) ? obj.records : [];
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.file());
      this.records = [];
      this.dirty = true;
      return true;
    }
  }
  all(): CardReviewRecord[] { return [...this.records].sort((a, b) => b.reviewedAt - a.reviewedAt); }
  count(): number { return this.records.length; }
  byCard(cardId: string): CardReviewRecord[] { return this.records.filter((r) => r.cardId === cardId); }
  add(r: CardReviewRecord): void { this.records.push(r); this.dirty = true; this.flush(); }
  replaceAll(r: CardReviewRecord[]): void { this.records = r; this.dirty = true; this.flush(); }
  flush(): void {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, records: this.records } as never);
    this.dirty = false;
  }
}

/** ID 与标签工具（供 main/视图使用；0 AI） */
export function newExamId(): string { return examId(); }
export function newCardId(): string { return cardId(); }
export function examDirPath(): string { return "Knowledge Garden/Exams"; }
export function cardsDirPath(): string { return "Knowledge Garden/Review Cards"; }
export function examMarkdownPath(e: NoteExam): string {
  const d = new Date(e.createdAt);
  const ymd = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return examDirPath() + "/" + ymd + " " + safeExamTitle(e.title) + ".md";
}
export function cardMarkdownPath(c: SavedReviewCard): string {
  return cardsDirPath() + "/" + safeExamTitle(c.question).slice(0, 60) + ".md";
}
function safeExamTitle(text: string): string {
  return (text || "知识考试").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "知识考试";
}