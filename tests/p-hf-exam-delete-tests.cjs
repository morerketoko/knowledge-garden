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

// tests/p-hf-exam-delete-tests.ts
var fs5 = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path4 = __toESM(require("node:path"));

// src/ai/cache.ts
var crypto = __toESM(require("crypto"));
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

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
  const dir2 = path.dirname(filePath);
  fs.mkdirSync(dir2, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, filePath);
}

// src/ai/cache.ts
function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function fingerprintKey(parts) {
  return sha256(parts.join("\0"));
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
  /** Hotfix：删除单个缓存条目（精确失效指定考试/任务对应 key；绝不用 clearType 波及他人，§26/27） */
  remove(key) {
    if (!this.entries.has(key)) return false;
    this.entries.delete(key);
    try {
      atomicWriteJson(this.file, Array.from(this.entries.values()));
    } catch (e) {
      console.error("[KnowledgeGarden][AI] \u7F13\u5B58\u5220\u9664\u5199\u5165\u5931\u8D25\uFF1A", e.message);
    }
    return true;
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

// src/examStore.ts
var fs3 = __toESM(require("fs"));
function examFingerprint(e) {
  return fingerprintKey([
    "exam",
    e.sourcePath,
    e.sourceVersion,
    e.mode,
    e.topic ?? "",
    String(e.questionCount),
    e.difficulty ?? "medium",
    e.answerMode
  ]);
}
var ExamStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.entries = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/exams.json";
  }
  load() {
    try {
      const raw = fs3.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
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
  all() {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
  }
  count() {
    return this.entries.length;
  }
  get(id) {
    return this.entries.find((e) => e.id === id);
  }
  findByFingerprint(fp) {
    return this.entries.find((e) => examFingerprint(e) === fp);
  }
  /** §43/44：某来源笔记的全部考试，createdAt DESC（最新在前） */
  findBySource(sourcePath) {
    return this.entries.filter((e) => e.sourcePath === sourcePath).sort((a, b) => b.createdAt - a.createdAt);
  }
  add(e) {
    this.entries.push(e);
    this.dirty = true;
    this.flush();
  }
  update(id, patch) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.dirty = true;
    this.flush();
  }
  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.dirty = true;
      this.flush();
    }
  }
  migratePaths(oldPath, newPath) {
    let changed = false;
    for (const e of this.entries) if (e.sourcePath === oldPath) {
      e.sourcePath = newPath;
      changed = true;
    }
    if (changed) {
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(entries) {
    this.entries = entries;
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries });
    this.dirty = false;
  }
};
var ReviewCardStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.entries = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/cards.json";
  }
  load() {
    try {
      const raw = fs3.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
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
  all() {
    return [...this.entries].sort((a, b) => b.createdAt - a.createdAt);
  }
  count() {
    return this.entries.length;
  }
  get(id) {
    return this.entries.find((e) => e.id === id);
  }
  findByExam(examId) {
    return this.entries.filter((e) => e.examId === examId);
  }
  /** Phase 21 §54：按 考试+题目 查已收藏卡（去重主键；缺 examQuestionId 时返回 undefined，兼容旧卡） */
  findByExamQuestion(examId, questionId) {
    if (!examId || !questionId) return void 0;
    return this.entries.find((e) => e.examId === examId && e.examQuestionId === questionId);
  }
  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.dirty = true;
      this.flush();
    }
  }
  update(id, patch) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch, { updatedAt: Date.now() });
    this.dirty = true;
    this.flush();
  }
  migratePaths(oldPath, newPath) {
    let changed = false;
    for (const e of this.entries) if (e.sourcePath === oldPath) {
      e.sourcePath = newPath;
      changed = true;
    }
    if (changed) {
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(entries) {
    this.entries = entries;
    this.dirty = true;
    this.flush();
  }
  add(card) {
    this.entries.push(card);
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, entries: this.entries });
    this.dirty = false;
  }
};
var ExamSessionStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.sessions = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/exam-sessions.json";
  }
  load() {
    try {
      const raw = fs3.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
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
  get(examId) {
    return this.sessions.find((s) => s.examId === examId && s.status !== "abandoned");
  }
  all() {
    return [...this.sessions];
  }
  upsert(s) {
    const i = this.sessions.findIndex((x) => x.examId === s.examId);
    if (i >= 0) this.sessions[i] = s;
    else this.sessions.push(s);
    this.dirty = true;
    this.flush();
  }
  remove(examId) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.examId !== examId);
    if (this.sessions.length !== before) {
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(s) {
    this.sessions = s;
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, sessions: this.sessions });
    this.dirty = false;
  }
};
var CardReviewStore = class {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.records = [];
    this.dirty = false;
  }
  file() {
    return this.baseDir + "/cache/card-reviews.json";
  }
  load() {
    try {
      const raw = fs3.readFileSync(this.file(), "utf8");
      const obj = JSON.parse(raw);
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
  all() {
    return [...this.records].sort((a, b) => b.reviewedAt - a.reviewedAt);
  }
  count() {
    return this.records.length;
  }
  byCard(cardId) {
    return this.records.filter((r) => r.cardId === cardId);
  }
  add(r) {
    this.records.push(r);
    this.dirty = true;
    this.flush();
  }
  /** Phase 21 §39：删除卡时一并删除其 CardReviewRecord（不动 Exam/Source/AI Cache） */
  removeByCard(cardId) {
    const kept = this.records.filter((r) => r.cardId !== cardId);
    if (kept.length !== this.records.length) {
      this.records = kept;
      this.dirty = true;
      this.flush();
    }
  }
  replaceAll(r) {
    this.records = r;
    this.dirty = true;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    atomicWriteJson(this.file(), { formatVersion: 1, records: this.records });
    this.dirty = false;
  }
};

// src/spacedReview.ts
var fs4 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// node_modules/ts-fsrs/dist/index.mjs
var FSRSError = class _FSRSError extends Error {
  constructor(message = "FSRS Error") {
    super(message);
    this.name = "FSRSError";
    Error.captureStackTrace?.(this, _FSRSError);
  }
};
var FSRSValidationError = class _FSRSValidationError extends FSRSError {
  constructor(message) {
    super(message);
    this.name = "FSRSValidationError";
    Error.captureStackTrace?.(this, _FSRSValidationError);
  }
};
var State = /* @__PURE__ */ ((State2) => {
  State2[State2["New"] = 0] = "New";
  State2[State2["Learning"] = 1] = "Learning";
  State2[State2["Review"] = 2] = "Review";
  State2[State2["Relearning"] = 3] = "Relearning";
  return State2;
})(State || {});
var Rating = /* @__PURE__ */ ((Rating2) => {
  Rating2[Rating2["Manual"] = 0] = "Manual";
  Rating2[Rating2["Again"] = 1] = "Again";
  Rating2[Rating2["Hard"] = 2] = "Hard";
  Rating2[Rating2["Good"] = 3] = "Good";
  Rating2[Rating2["Easy"] = 4] = "Easy";
  return Rating2;
})(Rating || {});
var TypeConvert = class _TypeConvert {
  static card(card) {
    return {
      ...card,
      state: _TypeConvert.state(card.state),
      due: _TypeConvert.time(card.due),
      last_review: card.last_review ? _TypeConvert.time(card.last_review) : void 0
    };
  }
  static rating(value) {
    if (typeof value === "string") {
      const firstLetter = value.charAt(0).toUpperCase();
      const restOfString = value.slice(1).toLowerCase();
      const ret = Rating[`${firstLetter}${restOfString}`];
      if (ret === void 0) {
        throw new FSRSValidationError(`Invalid rating:[${value}]`);
      }
      return ret;
    } else if (typeof value === "number") {
      return value;
    }
    throw new FSRSValidationError(`Invalid rating:[${value}]`);
  }
  static state(value) {
    if (typeof value === "string") {
      const firstLetter = value.charAt(0).toUpperCase();
      const restOfString = value.slice(1).toLowerCase();
      const ret = State[`${firstLetter}${restOfString}`];
      if (ret === void 0) {
        throw new FSRSValidationError(`Invalid state:[${value}]`);
      }
      return ret;
    } else if (typeof value === "number") {
      return value;
    }
    throw new FSRSValidationError(`Invalid state:[${value}]`);
  }
  static time(value) {
    if (value instanceof Date) {
      return value;
    }
    const date = new Date(value);
    if (typeof value === "object" && value !== null && !Number.isNaN(Date.parse(value) || +date)) {
      return date;
    } else if (typeof value === "string") {
      const timestamp = Date.parse(value);
      if (!Number.isNaN(timestamp)) {
        return new Date(timestamp);
      } else {
        throw new FSRSValidationError(`Invalid date:[${value}]`);
      }
    } else if (typeof value === "number") {
      return new Date(value);
    }
    throw new FSRSValidationError(`Invalid date:[${value}]`);
  }
  static review_log(log) {
    return {
      ...log,
      due: _TypeConvert.time(log.due),
      rating: _TypeConvert.rating(log.rating),
      state: _TypeConvert.state(log.state),
      review: _TypeConvert.time(log.review)
    };
  }
};
Date.prototype.scheduler = function(t, isDay) {
  return date_scheduler(this, t, isDay);
};
Date.prototype.diff = function(pre, unit) {
  return date_diff(this, pre, unit);
};
Date.prototype.format = function() {
  return formatDate(this);
};
Date.prototype.dueFormat = function(last_review, unit, timeUnit) {
  return show_diff_message(this, last_review, unit, timeUnit);
};
function date_scheduler(now, t, isDay) {
  return new Date(
    isDay ? TypeConvert.time(now).getTime() + t * 24 * 60 * 60 * 1e3 : TypeConvert.time(now).getTime() + t * 60 * 1e3
  );
}
function date_diff(now, pre, unit) {
  if (!now || !pre) {
    throw new FSRSValidationError("Invalid date");
  }
  const diff = TypeConvert.time(now).getTime() - TypeConvert.time(pre).getTime();
  let r = 0;
  switch (unit) {
    case "days":
      r = Math.floor(diff / (24 * 60 * 60 * 1e3));
      break;
    case "minutes":
      r = Math.floor(diff / (60 * 1e3));
      break;
  }
  return r;
}
function formatDate(dateInput) {
  const date = TypeConvert.time(dateInput);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return `${year}-${padZero(month)}-${padZero(day)} ${padZero(hours)}:${padZero(
    minutes
  )}:${padZero(seconds)}`;
}
function padZero(num) {
  return num < 10 ? `0${num}` : `${num}`;
}
var TIMEUNIT = [60, 60, 24, 31, 12];
var TIMEUNITFORMAT = ["second", "min", "hour", "day", "month", "year"];
function show_diff_message(due, last_review, unit, timeUnit = TIMEUNITFORMAT) {
  due = TypeConvert.time(due);
  last_review = TypeConvert.time(last_review);
  if (timeUnit.length !== TIMEUNITFORMAT.length) {
    timeUnit = TIMEUNITFORMAT;
  }
  let diff = due.getTime() - last_review.getTime();
  let i = 0;
  diff /= 1e3;
  for (i = 0; i < TIMEUNIT.length; i++) {
    if (diff < TIMEUNIT[i]) {
      break;
    } else {
      diff /= TIMEUNIT[i];
    }
  }
  return `${Math.floor(diff)}${unit ? timeUnit[i] : ""}`;
}
var Grades = Object.freeze([
  Rating.Again,
  Rating.Hard,
  Rating.Good,
  Rating.Easy
]);
var version = "5.4.2";
var default_learning_steps = Object.freeze([
  "1m",
  "10m"
]);
var default_relearning_steps = Object.freeze([
  "10m"
]);
var FSRSVersion = `v${version} using FSRS-6.0`;
var FSRS6_DEFAULT_DECAY = 0.1542;
var default_w = Object.freeze([
  0.212,
  1.2931,
  2.3065,
  8.2956,
  6.4133,
  0.8334,
  3.0194,
  1e-3,
  1.8722,
  0.1666,
  0.796,
  1.4835,
  0.0614,
  0.2629,
  1.6483,
  0.6014,
  1.8729,
  0.5425,
  0.0912,
  0.0658,
  FSRS6_DEFAULT_DECAY
]);

// src/spacedReview.ts
var REVIEW_LOG_MAX = 4e3;
var FSRS_RATINGS = ["again", "hard", "good", "easy"];
var SpacedReviewStore = class _SpacedReviewStore {
  constructor(pluginDir) {
    this.cards = /* @__PURE__ */ new Map();
    this.logs = [];
    this.savedCards = /* @__PURE__ */ new Map();
    this.savedLogs = [];
    this.file = path3.join(pluginDir, "cache", "spaced-review.json");
  }
  static {
    this.FORMAT_VERSION = 2;
  }
  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后置空（§36，不阻塞启动） */
  load() {
    try {
      if (!fs4.existsSync(this.file)) return false;
      const raw = JSON.parse(fs4.readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object") throw new Error("invalid spaced-review structure");
      if (raw.cards && typeof raw.cards === "object") {
        for (const [p, c] of Object.entries(raw.cards)) {
          const card = sanitizeCard(p, c);
          if (card) this.cards.set(p, card);
        }
      }
      if (Array.isArray(raw.reviewLogs)) {
        this.logs = raw.reviewLogs.filter((l) => l && typeof l === "object" && typeof l.path === "string" && typeof l.timestamp === "number").slice(-REVIEW_LOG_MAX);
      }
      if (raw.savedCards && typeof raw.savedCards === "object") {
        for (const [id, c] of Object.entries(raw.savedCards)) {
          const card = sanitizeSavedCard(id, c);
          if (card) this.savedCards.set(id, card);
        }
      }
      if (Array.isArray(raw.savedCardReviewLogs)) {
        this.savedLogs = raw.savedCardReviewLogs.filter((l) => l && typeof l === "object" && typeof l.cardId === "string" && typeof l.timestamp === "number").slice(-REVIEW_LOG_MAX);
      }
      return false;
    } catch {
      const isolated = isolateCorruptFile(this.file);
      this.cards.clear();
      this.logs = [];
      this.savedCards.clear();
      this.savedLogs = [];
      return isolated;
    }
  }
  /* ---------- Note-based FSRS（Phase 20 原 API，不变） ---------- */
  get(pathKey) {
    return this.cards.get(pathKey);
  }
  all() {
    return Array.from(this.cards.values());
  }
  count() {
    return this.cards.size;
  }
  logsAll() {
    return this.logs.slice();
  }
  logsSince(ts) {
    return this.logs.filter((l) => l.timestamp >= ts);
  }
  /**
   * 提交一次评分（§九十五：FSRS save 成功才算完成，失败抛错 → 调用方绝不 markReviewed）。
   * 先原子写盘再更新内存（写失败不产生半状态）；失败抛错由调用方提示并保留原 UI。
   */
  commitReview(pathKey, next, log) {
    const card = { ...next, path: pathKey, updatedAt: Date.now() };
    const entry = { ...log, path: pathKey };
    const nextCards = new Map(this.cards);
    nextCards.set(pathKey, card);
    const nextLogs = this.logs.concat(entry).slice(-REVIEW_LOG_MAX);
    this.persist(nextCards, nextLogs, this.savedCards, this.savedLogs);
    this.cards = nextCards;
    this.logs = nextLogs;
  }
  /** 删除笔记后清理（Test 18 语义）；Saved Card 状态不随 sourcePath 删除（§141） */
  prune(existing) {
    let changed = false;
    for (const k of Array.from(this.cards.keys())) {
      if (!existing.has(k)) {
        this.cards.delete(k);
        changed = true;
      }
    }
    const kept = this.logs.filter((l) => existing.has(l.path));
    if (kept.length !== this.logs.length) {
      this.logs = kept;
      changed = true;
    }
    if (changed) this.persist(this.cards, this.logs, this.savedCards, this.savedLogs);
  }
  /** 笔记 rename 后 path 随行更新（不产生假死路径）；saved 主键 cardId 不变（§85） */
  migratePaths(oldPath, newPath) {
    if (!this.cards.has(oldPath) && !this.logs.some((l) => l.path === oldPath)) return;
    const cards = new Map(this.cards);
    if (cards.has(oldPath)) {
      const c = cards.get(oldPath);
      cards.delete(oldPath);
      cards.set(newPath, { ...c, path: newPath, updatedAt: Date.now() });
    }
    const logs = this.logs.map((l) => l.path === oldPath ? { ...l, path: newPath } : l);
    this.persist(cards, logs, this.savedCards, this.savedLogs);
    this.cards = cards;
    this.logs = logs;
  }
  /** §七十五/七十六：立即重排（笔记卡；备份 → 批量替换 → 失败恢复由调用方以 fileBackup 回滚） */
  replaceAllCards(nextCards) {
    const cards = /* @__PURE__ */ new Map();
    for (const c of nextCards) if (c && c.path) cards.set(c.path, { ...c, updatedAt: Date.now() });
    this.persist(cards, this.logs, this.savedCards, this.savedLogs);
    this.cards = cards;
  }
  /* ---------- Saved Card FSRS（Phase 21：savedCard:<cardId> 主键，§三/五） ---------- */
  scGet(cardId) {
    return this.savedCards.get(cardId);
  }
  scAll() {
    return Array.from(this.savedCards.values());
  }
  scCount() {
    return this.savedCards.size;
  }
  scLogsAll() {
    return this.savedLogs.slice();
  }
  /** §28/二十九：保存卡评分（FSRS save 成功才算完成，失败抛错 → 调用方不标已复习）。 */
  scCommitReview(cardId, next, log) {
    const state = { ...next, cardId, updatedAt: Date.now() };
    const entry = { ...log, cardId };
    const nextStates = new Map(this.savedCards);
    nextStates.set(cardId, state);
    const nextLogs = this.savedLogs.concat(entry).slice(-REVIEW_LOG_MAX);
    this.persist(this.cards, this.logs, nextStates, nextLogs);
    this.savedCards = nextStates;
    this.savedLogs = nextLogs;
  }
  /** §三十九：删除卡 → 同时删 Saved Card FSRS 状态与日志（不动 Exam/Source/AI Cache §39） */
  scRemoveCard(cardId) {
    if (!this.savedCards.has(cardId) && !this.savedLogs.some((l) => l.cardId === cardId)) return;
    const states = new Map(this.savedCards);
    states.delete(cardId);
    const logs = this.savedLogs.filter((l) => l.cardId !== cardId);
    this.persist(this.cards, this.logs, states, logs);
    this.savedCards = states;
    this.savedLogs = logs;
  }
  /** §147：Saved Card 全部重排（与 Note 一起由 main 调用；本方法失败抛错内存不变） */
  scReplaceAll(nextStates) {
    const states = /* @__PURE__ */ new Map();
    for (const s of nextStates) if (s && s.cardId) states.set(s.cardId, { ...s, updatedAt: Date.now() });
    this.persist(this.cards, this.logs, states, this.savedLogs);
    this.savedCards = states;
  }
  /** 文件原文备份（§76：重排前备份，失败 rollback） */
  fileSnapshot() {
    try {
      return fs4.existsSync(this.file) ? fs4.readFileSync(this.file, "utf8") : null;
    } catch {
      return null;
    }
  }
  /** 从备份恢复（§76 rollback）：写回后重载内存 */
  restoreSnapshot(snapshot) {
    try {
      if (snapshot === null) {
        this.cards.clear();
        this.logs = [];
        this.savedCards.clear();
        this.savedLogs = [];
        this.persist(this.cards, this.logs, this.savedCards, this.savedLogs);
        return true;
      }
      fs4.writeFileSync(this.file, snapshot, "utf8");
      this.load();
      return true;
    } catch {
      return false;
    }
  }
  persist(cards, logs, savedCards, savedLogs) {
    const obj = {
      formatVersion: _SpacedReviewStore.FORMAT_VERSION,
      cards: Object.fromEntries(cards),
      reviewLogs: logs,
      savedCards: Object.fromEntries(savedCards),
      savedCardReviewLogs: savedLogs
    };
    atomicWriteJson(this.file, obj);
  }
};
function sanitizeCard(p, c) {
  if (!c || typeof c !== "object") return null;
  const rec = c;
  const fsState = rec["fsrsState"];
  if (!fsState || typeof fsState !== "object") return null;
  const f = (v, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const due = f(fsState["due"], Date.now());
  const lastReviewRaw = fsState["lastReview"];
  const lastReview = typeof lastReviewRaw === "number" && Number.isFinite(lastReviewRaw) ? lastReviewRaw : void 0;
  return {
    path: p,
    fsrsState: {
      due,
      stability: Math.max(1e-3, f(fsState["stability"], 1)),
      difficulty: Math.min(10, Math.max(1, f(fsState["difficulty"], 5))),
      reps: Math.max(0, Math.floor(f(fsState["reps"], 0))),
      lapses: Math.max(0, Math.floor(f(fsState["lapses"], 0))),
      state: Number(fsState["state"]) === State.Learning || Number(fsState["state"]) === State.Review || Number(fsState["state"]) === State.Relearning ? Number(fsState["state"]) : State.New,
      learningSteps: Math.max(0, Math.floor(f(fsState["learningSteps"], 0))),
      lastReview
    },
    lastRating: FSRS_RATINGS.includes(rec["lastRating"]) ? rec["lastRating"] : void 0,
    reviewCount: Math.max(0, Math.floor(f(rec["reviewCount"], 0))),
    lastReviewedAt: typeof rec["lastReviewedAt"] === "number" ? rec["lastReviewedAt"] : void 0,
    masteryPercent: typeof rec["masteryPercent"] === "number" ? Math.max(0, Math.min(100, rec["masteryPercent"])) : void 0,
    createdAt: f(rec["createdAt"], Date.now()),
    updatedAt: f(rec["updatedAt"], Date.now())
  };
}
function sanitizeSavedCard(id, c) {
  if (!c || typeof c !== "object") return null;
  const rec = c;
  const fsState = rec["fsrsState"];
  if (!fsState || typeof fsState !== "object") return null;
  const f = (v, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  const lastReviewRaw = fsState["lastReview"];
  const lastReview = typeof lastReviewRaw === "number" && Number.isFinite(lastReviewRaw) ? lastReviewRaw : void 0;
  return {
    cardId: id,
    fsrsState: {
      due: f(fsState["due"], Date.now()),
      stability: Math.max(1e-3, f(fsState["stability"], 1)),
      difficulty: Math.min(10, Math.max(1, f(fsState["difficulty"], 5))),
      reps: Math.max(0, Math.floor(f(fsState["reps"], 0))),
      lapses: Math.max(0, Math.floor(f(fsState["lapses"], 0))),
      state: Number(fsState["state"]) === State.Learning || Number(fsState["state"]) === State.Review || Number(fsState["state"]) === State.Relearning ? Number(fsState["state"]) : State.New,
      learningSteps: Math.max(0, Math.floor(f(fsState["learningSteps"], 0))),
      lastReview
    },
    lastRating: FSRS_RATINGS.includes(rec["lastRating"]) ? rec["lastRating"] : void 0,
    reviewCount: Math.max(0, Math.floor(f(rec["reviewCount"], 0))),
    lastReviewedAt: typeof rec["lastReviewedAt"] === "number" ? rec["lastReviewedAt"] : void 0,
    masteryPercent: typeof rec["masteryPercent"] === "number" ? Math.max(0, Math.min(100, rec["masteryPercent"])) : void 0,
    createdAt: f(rec["createdAt"], Date.now()),
    updatedAt: f(rec["updatedAt"], Date.now())
  };
}

// src/examGen.ts
function normalizeExamText(s) {
  let t = (s ?? "").trim().toLowerCase();
  t = t.replace(/\u3000/g, " ");
  t = t.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248));
  t = t.replace(/[，。！？；：、,.!?;:()（）《》「」"'“”‘’[\]{}|\\/<>#*_\-—…\s]+/g, " ").trim();
  t = t.replace(/\s+/g, " ");
  return t;
}
function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function examQuestionFingerprint(q) {
  return hashText(normalizeExamText(q.question));
}
function charNGrams(s, n) {
  const t = normalizeExamText(s).replace(/ /g, "");
  const out = /* @__PURE__ */ new Set();
  if (t.length < n) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}
function tokenSet(s) {
  const norm = normalizeExamText(s);
  const out = /* @__PURE__ */ new Set();
  for (const tok of norm.split(" ")) {
    if (!tok) continue;
    if (/^[\u4e00-\u9fff]+$/.test(tok)) {
      out.add(tok);
      if (tok.length >= 2) for (let i = 0; i + 2 <= tok.length; i++) out.add(tok.slice(i, i + 2));
    } else out.add(tok);
  }
  return out;
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
function conceptSimilarity(a, b) {
  if (!a || !b) return 0;
  const na = normalizeExamText(a);
  const nb = normalizeExamText(b);
  if (na === nb) return 1;
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  let overlap = false;
  for (const x of sa) if (sb.has(x)) {
    overlap = true;
    break;
  }
  return overlap ? 0.6 : 0;
}
function questionSimilarity(a, b, conceptA, conceptB) {
  const triA = charNGrams(a, 3);
  const triB = charNGrams(b, 3);
  const tokA = tokenSet(a);
  const tokB = tokenSet(b);
  return jaccard(triA, triB) * 0.45 + jaccard(tokA, tokB) * 0.35 + conceptSimilarity(conceptA, conceptB) * 0.2;
}
function tokenContainment(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.min(sa.size, sb.size);
}
function conceptsEqual(a, b) {
  if (!a || !b) return false;
  return normalizeExamText(a) === normalizeExamText(b);
}
var EXAM_NEAR_DUP_THRESHOLD = 0.78;
function isNearDuplicate(a, b, conceptA, conceptB) {
  if (questionSimilarity(a, b, conceptA, conceptB) >= EXAM_NEAR_DUP_THRESHOLD) return true;
  return conceptsEqual(conceptA, conceptB) && tokenContainment(a, b) >= 0.5;
}
function buildExamHistoryContext(exams) {
  const fpParts = [];
  const prior = [];
  const concepts = /* @__PURE__ */ new Set();
  const topics = /* @__PURE__ */ new Set();
  for (const e of exams) {
    for (const q of e.questions ?? []) {
      if (!q.question) continue;
      fpParts.push(examQuestionFingerprint(q));
      if (prior.length < 100) prior.push({ question: String(q.question).slice(0, 240), concept: q.concept, type: q.type });
      const c = (q.concept ?? "").trim();
      if (c) {
        concepts.add(c);
        fpParts.push("c:" + normalizeExamText(c));
      }
    }
    for (const t of e.coverageTopics ?? []) {
      const tn = (t ?? "").trim();
      if (tn) {
        topics.add(tn);
        fpParts.push("t:" + normalizeExamText(tn));
      }
    }
  }
  const sortedConcepts = [...concepts].sort();
  const sortedTopics = [...topics].sort();
  fpParts.sort();
  return {
    examCount: exams.length,
    priorQuestions: prior,
    priorConcepts: sortedConcepts.slice(0, 100),
    priorCoverageTopics: sortedTopics.slice(0, 100),
    historyFingerprint: hashText(fpParts.join("|"))
  };
}
function dedupeExamQuestions(candidates, history, policy) {
  const kept = [];
  const duplicates = [];
  const fpSeen = /* @__PURE__ */ new Set();
  const conceptTypeSeen = /* @__PURE__ */ new Map();
  for (const h of history.priorQuestions) {
    fpSeen.add(examQuestionFingerprint(h));
    if (h.concept) {
      const set = conceptTypeSeen.get(normalizeExamText(h.concept)) ?? /* @__PURE__ */ new Set();
      set.add(h.type ?? "");
      conceptTypeSeen.set(normalizeExamText(h.concept), set);
    }
  }
  const historyConceptSet = new Set(history.priorConcepts.map((c) => normalizeExamText(c)));
  for (const q of candidates) {
    const fp = examQuestionFingerprint(q);
    if (fpSeen.has(fp)) {
      duplicates.push(q);
      continue;
    }
    const conceptN = normalizeExamText(q.concept ?? "");
    if (policy !== "allow") {
      const nearWith = (otherQ, otherC, otherType) => {
        if (policy === "balanced" && q.type && otherType && q.type !== otherType) return false;
        return isNearDuplicate(otherQ, q.question, otherC, q.concept);
      };
      let near = false;
      for (const k of kept) if (nearWith(k.question, k.concept, k.type)) {
        near = true;
        break;
      }
      if (!near) {
        for (const h of history.priorQuestions) if (nearWith(h.question, h.concept, h.type)) {
          near = true;
          break;
        }
      }
      if (near) {
        duplicates.push(q);
        continue;
      }
    }
    if (q.concept) {
      const types = conceptTypeSeen.get(conceptN);
      const qtype = q.type ?? "";
      const conflict = policy === "strict" ? historyConceptSet.has(conceptN) || !!types : policy === "balanced" ? !!types && types.has(qtype) : false;
      if (policy !== "allow" && conflict) {
        duplicates.push(q);
        continue;
      }
      const set = conceptTypeSeen.get(conceptN) ?? /* @__PURE__ */ new Set();
      set.add(qtype);
      conceptTypeSeen.set(conceptN, set);
    }
    kept.push(q);
    fpSeen.add(fp);
  }
  return { questions: kept, removedCount: duplicates.length, duplicates };
}

// tests/p-hf-exam-delete-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function dir() {
  return fs5.mkdtempSync(path4.join(os.tmpdir(), "kg-examdel-"));
}
var NOW = new Date(2026, 4, 1, 12, 0, 0).getTime();
function mkExam(id, src, title, createdAt) {
  return { id, sourcePath: src, sourceVersion: "v1", title, mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [{ id: "q1", type: "recall", question: title + " \u9898?", referenceAnswer: "r", sourcePath: src }], examVersion: 1, createdAt, updatedAt: createdAt };
}
function mkCard(id, src, examId) {
  return { id, sourcePath: src, sourceVersion: "v1", examId, examQuestionId: "q1", question: "\u5361 " + id, answer: "\u7B54", questionType: "recall", createdAt: NOW, updatedAt: NOW };
}
{
  const d = dir();
  const cache = new AICache(d);
  cache.load();
  cache.put({ key: "k-target", type: "note_exam", createdAt: NOW, updatedAt: NOW, status: "success", data: { title: "x", questions: [] }, promptVersion: "v", candidateFingerprint: "f", configFingerprint: "c" });
  cache.put({ key: "k-other", type: "note_exam", createdAt: NOW, updatedAt: NOW, status: "success", data: { title: "y", questions: [] }, promptVersion: "v", candidateFingerprint: "g", configFingerprint: "c" });
  test(
    "P-HF-EXAM-DELETE-13",
    cache.remove("k-target") === true && cache.get("k-target") === void 0,
    "\u53EA\u5220\u9664 target exam cache\uFF08\xA713\uFF09"
  );
  test(
    "P-HF-EXAM-DELETE-14",
    cache.get("k-other") !== void 0 && cache.byType("note_exam").length === 1,
    "\u5176\u4ED6 note_exam cache \u4FDD\u7559\uFF08\xA714/27\uFF1A\u7EDD\u4E0D clearType\uFF09"
  );
  test("P-HF-EXAM-DELETE-15", cache.remove("k-missing") === false, "cache remove \u5931\u8D25\u65E0\u526F\u4F5C\u7528\uFF08\xA715\uFF09");
  fs5.rmSync(d, { recursive: true, force: true });
}
{
  const d = dir();
  const exams = new ExamStore(d);
  exams.load();
  const sess = new ExamSessionStore(d);
  sess.load();
  const cards = new ReviewCardStore(d);
  cards.load();
  const cr = new CardReviewStore(d);
  cr.load();
  const spaced = new SpacedReviewStore(d);
  spaced.load();
  const src = "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md";
  const examA = mkExam("exA", src, "A \u8003\u8BD5", NOW - 1e3);
  const examB = mkExam("exB", src, "B \u8003\u8BD5", NOW);
  exams.add(examA);
  exams.add(examB);
  sess.upsert({ examId: "exA", mode: "card", currentIndex: 2, answers: [{ questionId: "q1", answer: "a", selfRating: "good" }], status: "running", startedAt: NOW, updatedAt: NOW });
  const cardA = mkCard("cardA", src, "exA");
  cards.add(cardA);
  const state = {
    cardId: "cardA",
    fsrsState: { due: NOW + 5 * 864e5, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 5 * 864e5 },
    lastRating: "good",
    reviewCount: 3,
    lastReviewedAt: NOW - 5 * 864e5,
    masteryPercent: 75,
    createdAt: NOW - 80 * 864e5,
    updatedAt: NOW - 5 * 864e5
  };
  spaced.scCommitReview("cardA", state, { timestamp: NOW - 5 * 864e5, rating: "good", previousDue: null, nextDue: state.fsrsState.due, intervalDays: 10, stability: 10, difficulty: 5, retrievability: 0.9 });
  cr.add({ cardId: "cardA", reviewedAt: NOW, rating: "good" });
  exams.remove("exA");
  sess.remove("exA");
  test("P-HF-EXAM-DELETE-04", exams.get("exA") === void 0, "\u786E\u8BA4\u5220\u9664\uFF1AExamStore \u4E0D\u518D\u5B58\u5728\uFF08\xA7104/4\uFF09");
  test("P-HF-EXAM-DELETE-06", sess.get("exA") === void 0, "ExamSession \u5220\u9664\uFF08\xA7106/5/38\uFF09");
  test("P-HF-EXAM-DELETE-11", exams.get("exB") !== void 0 && exams.findBySource(src).length === 1, "\u5176\u4ED6 Exam \u4FDD\u7559\uFF08\xA7111/10\uFF09");
  test(
    "P-HF-EXAM-DELETE-07",
    cards.get("cardA") !== void 0 && cards.get("cardA")?.examId === "exA",
    "SavedReviewCard \u4FDD\u7559\uFF08examId \u4FDD\u7559\uFF0CUI \u663E\u793A\u539F\u8003\u8BD5\u5DF2\u5220\u9664\uFF0C\xA7107/4/24/25\uFF09"
  );
  test(
    "P-HF-EXAM-DELETE-08",
    spaced.scGet("cardA") !== void 0 && spaced.scGet("cardA")?.fsrsState.due === state.fsrsState.due,
    "Saved Card FSRS \u4FDD\u7559\u4E14\u5B8C\u5168\u4E00\u81F4\uFF08\xA7108\uFF09"
  );
  test("P-HF-EXAM-DELETE-09", cr.byCard("cardA").length === 1, "CardReviewRecord \u4FDD\u7559\uFF08\xA7109\uFF09");
  test("P-HF-EXAM-DELETE-10", examB.sourcePath === src && cards.get("cardA")?.sourcePath === src, "Source Note \u5F15\u7528\u4FDD\u7559\uFF08\xA7110/10\uFF09");
  fs5.rmSync(d, { recursive: true, force: true });
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const mainSrc = fs5.readFileSync(path4.join(__dirname, "..", "src", "main.ts"), "utf8");
  const start = mainSrc.indexOf("async deleteExam(");
  const end = mainSrc.indexOf("\u65E7\u5F0F\u8BB0\u5F55\u590D\u4E60\u5361\u590D\u4E60", start);
  const body = stripComments(mainSrc.slice(start, end > start ? end : start + 6e3));
  test("P-HF-EXAM-DELETE-16", body.includes("mdMissing") && body.includes("\u5DF2\u6E05\u7406\u8003\u8BD5\u7D22\u5F15\u4E0E\u4F1A\u8BDD\u8BB0\u5F55"), "Markdown \u4E0D\u5B58\u5728 \u2192 \u6E05\u7406\u7D22\u5F15/\u4F1A\u8BDD\uFF08\xA716/12/42\uFF09");
  test("P-HF-EXAM-DELETE-17", body.includes("\u8003\u8BD5\u6587\u4EF6\u5220\u9664\u5931\u8D25\uFF0C\u8003\u8BD5\u4ECD\u7136\u4FDD\u7559"), "Markdown \u5220\u9664\u5931\u8D25 \u2192 \u4E0D\u5220 Store\uFF08\xA717/41\uFF09");
  test("P-HF-EXAM-DELETE-18", body.includes("\u8003\u8BD5\u5DF2\u7ECF\u4E0D\u5B58\u5728") && body.includes("return false"), "Exam \u4E0D\u5B58\u5728 \u2192 deleteExam \u8FD4\u56DE false\uFF08\xA718/13\uFF09");
  test(
    "P-HF-EXAM-DELETE-19",
    body.includes('examId: "') && body.includes("cache.remove(") && body.includes("generationCacheKeys"),
    "\u5220\u9664\u987A\u5E8F\u542B frontmatter examId \u6821\u9A8C + \u7CBE\u786E cache.remove\uFF08\xA76/26~30/52\uFF09"
  );
  const hubSrc = fs5.readFileSync(path4.join(__dirname, "..", "src", "examHub.ts"), "utf8");
  test(
    "P-HF-EXAM-DELETE-01",
    hubSrc.includes("\u{1F5D1} \u5220\u9664") && hubSrc.includes("deleting.has(e.id)"),
    "ExamHub \u884C\u6709\u5220\u9664\u6309\u94AE + per-exam \u9632\u8FDE\u70B9\uFF08\xA71/18/49\uFF09"
  );
  test("P-HF-EXAM-DELETE-19b", hubSrc.includes("ev.stopPropagation()"), "\u5220\u9664\u6309\u94AE stopPropagation\uFF08\xA717/2\uFF09");
  test(
    "P-HF-EXAM-DELETE-15b",
    hubSrc.includes("ExamDeleteConfirmModal") && hubSrc.includes("\u5220\u9664\u540E\u65E0\u6CD5\u4ECE\u8003\u8BD5\u4E2D\u5FC3\u6062\u590D"),
    "Obsidian ConfirmModal\uFF08\u975E window.confirm\uFF0C\xA714/15\uFF09"
  );
  test("P-HF-EXAM-DELETE-20", hubSrc.includes("\u8FD9\u7BC7\u7B14\u8BB0\u8FD8\u6CA1\u6709\u521B\u5EFA\u8003\u8BD5"), "\u5220\u7A7A\u540E\u7A7A\u72B6\u6001\u6587\u6848\u4FDD\u7559\uFF08\xA720/21\uFF09");
  test(
    "P-HF-EXAM-DELETE-AI",
    !/\bthis\.ai\b|generateExam\(|recordAccess|markReviewed/.test(body),
    "deleteExam \u5168\u7A0B 0 AI \u4E14\u4E0D\u52A8 Activity\uFF08\xA743\uFF09"
  );
}
{
  const examA = mkExam("A", "s.md", "A \u8003\u8BD5", 1).questions;
  const examB = mkExam("B", "s.md", "B \u8003\u8BD5", 2).questions;
  const examC = mkExam("C", "s.md", "C \u8003\u8BD5", 3).questions;
  const ctxABC = buildExamHistoryContext([examA, examB, examC].map((qs) => ({ questions: qs, coverageTopics: [] })));
  const ctxAC = buildExamHistoryContext([examA, examC].map((qs) => ({ questions: qs, coverageTopics: [] })));
  test(
    "P-HF-EXAM-HISTORY-02",
    ctxABC.historyFingerprint !== ctxAC.historyFingerprint,
    "\u5220\u9664 B \u2192 historyFingerprint \u6539\u53D8\uFF08\xA736/102\uFF09"
  );
  const bLike = { id: "b2", type: "recall", question: "B \u8003\u8BD5 \u9898?", referenceAnswer: "r", sourcePath: "s.md" };
  const keepBRemoved = dedupeExamQuestions([bLike], ctxAC, "strict").questions.length;
  test(
    "P-HF-EXAM-HISTORY-01",
    keepBRemoved === 1,
    "\u5220\u9664 B \u540E\uFF1AB \u7684\u9898\u5E72\u4E0D\u518D\u4F5C\u4E3A\u5386\u53F2\u6392\u9664\uFF0C\u53EF\u91CD\u65B0\u751F\u6210\uFF08\xA737/101\uFF09"
  );
  const keepBWithB = dedupeExamQuestions([bLike], ctxABC, "strict").questions.length;
  test("P-HF-EXAM-HISTORY-01b", keepBWithB === 0, "\u672A\u5220\u9664\u65F6 B \u9898\u5E72\u4ECD\u88AB\u6392\u9664\uFF08\u5BF9\u7167\uFF09");
  const aLike = { id: "a2", type: "recall", question: "A \u8003\u8BD5 \u9898?", referenceAnswer: "r", sourcePath: "s.md" };
  test(
    "P-HF-EXAM-HISTORY-04",
    dedupeExamQuestions([aLike, bLike], ctxAC, "strict").removedCount === 1,
    "\u53EA\u4FDD\u7559 A+C \u4F5C\u4E3A\u5386\u53F2\uFF1AA \u6392\u9664\u3001B \u653E\u884C\uFF08\xA7104/37\uFF09"
  );
  const cardsSrc = fs5.readFileSync(path4.join(__dirname, "..", "src", "cardsView.ts"), "utf8");
  const hubSrc = fs5.readFileSync(path4.join(__dirname, "..", "src", "examHub.ts"), "utf8");
  const viewSrc = fs5.readFileSync(path4.join(__dirname, "..", "src", "examView.ts"), "utf8");
  test(
    "P-HF-EXAM-CARD-04",
    cardsSrc.includes("\u539F\u8003\u8BD5\u5DF2\u5220\u9664"),
    "Card UI\uFF1AexamId \u6307\u5411\u5DF2\u5220\u9664\u8003\u8BD5\u65F6\u663E\u793A\u201C\u539F\u8003\u8BD5\u5DF2\u5220\u9664\u201D\uFF08\xA725/4\uFF09"
  );
  test("P-HF-EXAM-REVIEW-01", hubSrc.includes("\u8BE5\u8003\u8BD5\u5DF2\u88AB\u5220\u9664") && hubSrc.includes("notifyDeleted("), "Exam Review \u89C6\u56FE\uFF1A\u8003\u8BD5\u5DF2\u5220\u9664\u63D0\u793A\uFF08\xA722\uFF09");
  test("P-HF-EXAM-REVIEW-02", hubSrc.includes("\u8FD4\u56DE\u5F53\u524D\u7B14\u8BB0\u8003\u8BD5\u4E2D\u5FC3"), "Exam Review \u8FD4\u56DE\u5165\u53E3\uFF08\xA722\uFF09");
  test(
    "P-HF-EXAM-SESSION-01/02",
    viewSrc.includes("\u8BE5\u8003\u8BD5\u5DF2\u88AB\u5220\u9664") && viewSrc.includes("notifyDeleted("),
    "Exam Session \u89C6\u56FE\uFF1A\u5DF2\u5220\u9664\u63D0\u793A\uFF08\xA723\uFF09"
  );
  test("P-HF-EXAM-CARD-01", cardsSrc.length > 0, "Saved Card \u4FDD\u7559\u7531\u4E0A\u65B9 Store \u6D4B\u8BD5\u8986\u76D6\uFF08\xA7107/101 \u6570\u636E\u5C42\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
/*! Bundled license information:

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)

ts-fsrs/dist/index.mjs:
  (* istanbul ignore next -- @preserve *)
*/
