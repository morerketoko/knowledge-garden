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

// tests/p21-mgmt-hotfix-tests.ts
var fs4 = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path3 = __toESM(require("node:path"));

// src/spacedReview.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

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

// src/spacedReview.ts
var REVIEW_LOG_MAX = 4e3;
var FSRS_RATINGS = ["again", "hard", "good", "easy"];
function reviewBandOf(percent) {
  if (percent <= 39) return "relearn";
  if (percent <= 59) return "building";
  if (percent <= 79) return "basic";
  if (percent <= 94) return "proficient";
  return "mastered";
}
function emptyDistribution() {
  return { relearn: 0, building: 0, basic: 0, proficient: 0, mastered: 0 };
}
var SpacedReviewStore = class _SpacedReviewStore {
  constructor(pluginDir) {
    this.cards = /* @__PURE__ */ new Map();
    this.logs = [];
    this.savedCards = /* @__PURE__ */ new Map();
    this.savedLogs = [];
    this.file = path2.join(pluginDir, "cache", "spaced-review.json");
  }
  static {
    this.FORMAT_VERSION = 2;
  }
  /** 启动恢复；损坏 → 隔离 *.corrupt-* 后置空（§36，不阻塞启动） */
  load() {
    try {
      if (!fs2.existsSync(this.file)) return false;
      const raw = JSON.parse(fs2.readFileSync(this.file, "utf8"));
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
      return fs2.existsSync(this.file) ? fs2.readFileSync(this.file, "utf8") : null;
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
      fs2.writeFileSync(this.file, snapshot, "utf8");
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
function savedMasteryDistribution(states) {
  const dist = emptyDistribution();
  for (const s of states) if (typeof s.masteryPercent === "number") dist[reviewBandOf(s.masteryPercent)]++;
  return dist;
}
function savedCardOverview(states, logs, scheduler, now, newCount = 0) {
  const d = new Date(now);
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let due = 0, forgetting = 0, stable = 0;
  const retr = [];
  const mastery = [];
  for (const s of states) {
    const r = scheduler.retrievability(s.fsrsState, now);
    if (s.fsrsState.due <= now) {
      due++;
      if (r !== null && r < 0.7) forgetting++;
    }
    if (r !== null) retr.push(r);
    if (typeof s.masteryPercent === "number") {
      mastery.push(s.masteryPercent);
      if (s.masteryPercent >= 80) stable++;
    }
  }
  return {
    total: states.length + Math.max(0, newCount),
    due,
    forgetting,
    stable,
    newCount: Math.max(0, newCount),
    reviewsToday: logs.filter((l) => l.timestamp >= startOfDay).length,
    avgRetrievability: retr.length ? retr.reduce((a, b) => a + b, 0) / retr.length : null,
    avgMastery: mastery.length ? mastery.reduce((a, b) => a + b, 0) / mastery.length : null,
    dist: savedMasteryDistribution(states)
  };
}
function isValidSavedCardNewWeight(v) {
  return Number.isInteger(v) && v >= 0 && v <= 100;
}
function isNewSavedCard(state) {
  return !state || (state.reviewCount ?? 0) <= 0;
}
function recommendSavedCardScore(m, isNew, newWeight, now) {
  const newBonus = isNew ? Math.max(0, Math.min(100, newWeight)) : 0;
  const forgetRisk = m.retrievability === null ? 0 : Math.max(0, 1 - m.retrievability) * 50;
  const masteryRisk = typeof m.mastery === "number" ? Math.max(0, 100 - m.mastery) * 0.25 : 0;
  const overdueBonus = typeof m.due === "number" && m.due < now ? Math.min(20, Math.max(0, (now - m.due) / 864e5) * 2) : 0;
  const recentPenalty = typeof m.lastReviewedAt === "number" && m.lastReviewedAt >= now - 3 * 864e5 ? 5 : 0;
  return newBonus + forgetRisk + masteryRisk + overdueBonus - recentPenalty;
}
function rankSavedCards(cards, stateOf, metaOf2, mode, newWeight, now) {
  const retr = (m) => m.retrievability !== null ? m.retrievability : Infinity;
  const mastery = (m) => typeof m.mastery === "number" ? m.mastery : Infinity;
  const due = (m) => typeof m.due === "number" ? m.due : Infinity;
  const recent = (m) => typeof m.lastReviewedAt === "number" ? m.lastReviewedAt : -Infinity;
  const scores = /* @__PURE__ */ new Map();
  const isNew = /* @__PURE__ */ new Map();
  for (const c of cards) {
    isNew.set(c.id, isNewSavedCard(stateOf(c.id)));
    scores.set(c.id, recommendSavedCardScore(metaOf2(c.id), isNew.get(c.id) ?? false, newWeight, now));
  }
  const list = [...cards];
  list.sort((a, b) => {
    const ma = metaOf2(a.id);
    const mb = metaOf2(b.id);
    let d = 0;
    switch (mode) {
      case "new": {
        const na = isNew.get(a.id) ?? false;
        const nb = isNew.get(b.id) ?? false;
        if (na !== nb) return na ? -1 : 1;
        if (na && nb) return a.createdAt - b.createdAt;
        d = retr(ma) - retr(mb);
        if (d !== 0) return d;
        return due(ma) - due(mb);
      }
      case "forget":
        d = retr(ma) - retr(mb);
        if (d !== 0) return d;
        return due(ma) - due(mb);
      case "mastery":
        d = mastery(ma) - mastery(mb);
        if (d !== 0) return d;
        return due(ma) - due(mb);
      case "recent":
        return recent(mb) - recent(ma);
      case "next":
        d = due(ma) - due(mb);
        if (d !== 0) return d;
        return retr(ma) - retr(mb);
      case "recommend":
        d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
        if (d !== 0) return d;
        return a.createdAt - b.createdAt;
    }
  });
  return list.map((c) => c.id);
}

// src/ai/cache.ts
var crypto = __toESM(require("crypto"));
function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}
function fingerprintKey(parts) {
  return sha256(parts.join("\0"));
}

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

// src/types.ts
var DEFAULT_SETTINGS = {
  dashboardName: "\u77E5\u8BC6\u82B1\u56ED",
  autoRefresh: false,
  openOnStartup: false,
  hero: {
    background: "",
    folder: "",
    random: true,
    overlay: 0.25,
    title: "Knowledge Garden",
    subtitle: "\u8BA9\u77E5\u8BC6\u91CD\u65B0\u8FDE\u63A5\u8D77\u6765",
    current: ""
  },
  music: { enabled: false, folder: "", shuffle: false, repeat: true, volume: 0.7, autoplay: false, currentTrack: "", currentPos: 0 },
  knowledgeAreas: [],
  ai: {
    provider: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    model: "Qwen/Qwen2.5-7B-Instruct",
    temperature: 0.7,
    maxTokens: 1500,
    timeoutSec: 60
  },
  review: {
    daily: { enabled: false, time: "20:00" },
    weekly: { enabled: false, weekday: 0, time: "20:00" },
    monthly: { enabled: false, day: "last", time: "20:00" },
    quarterly: { enabled: false, day: "last", time: "20:00" },
    custom: { enabled: false, everyDays: 3, anchorDate: "", time: "20:00" }
  },
  reviews: [],
  dashboard: {
    contentWidth: 1480,
    showHero: true,
    showMusic: true,
    showRecentAccess: true,
    showForgotten: true,
    density: "comfortable"
  },
  activity: { newDays: 7, staleDays: 14, forgottenDays: 30, recentLimit: 8 },
  automaticReview: {
    enabled: false,
    // 默认 OFF：首次安装绝不自动消耗 Token（§二十）
    confirmBeforeRun: true,
    // 生成前询问（§21）
    confirmAfterMissed: true,
    // 错过后询问（§19/36）
    startupCheck: true,
    // 应用启动后检查（§36）
    notifiedOnce: false
    // 首次开启自动复盘的一次性提示（§39）
  },
  lastCuriosity: null,
  lastMonthlyEvolution: null,
  lastQuarterlyEvolution: null,
  evolution: { enabled: true, longTermAI: "metadata", keepWeeks: 52 },
  reviewCenter: {
    queueSize: 5,
    autoQueue: true,
    aiQuestion: true,
    maxQuestions: 5,
    skipPenalty: true,
    autoOpenReview: false,
    showAnswerByDefault: true
    // Phase 20 §44：答案默认显示（纯本地，0 AI）
  },
  spacedReview: {
    enabled: true,
    // Phase 20：默认升级为 FSRS 驱动；关闭 = Phase 8-19 行为
    desiredRetention: 0.9,
    maxIntervalDays: 3650,
    learningSteps: "10m,1h",
    relearningSteps: "10m",
    dailyNewCards: 10,
    maxReviewsPerDay: 30,
    dailySavedCardsLimit: 10,
    savedCardNewWeight: 30,
    overdueFirst: true,
    sortByRetrievability: true,
    autoReschedule: false,
    showAnswerByDefault: true,
    fsrsParameters: null
  },
  discovery: {
    curiosity: { scope: { mode: "vault" }, candidateCount: 16, exploreOld: true },
    roaming: { scope: { mode: "vault" }, candidateCount: 16, preferCrossArea: true }
  },
  queryExplorer: {
    scopeMode: "vault",
    candidateCount: 16,
    localResultLimit: 50,
    historyLimit: 20,
    autoSave: false
  },
  capture: {
    inboxFolder: "Knowledge Garden/Inbox",
    processingFolder: "Knowledge Garden/Processing",
    knowledgeFolder: "Knowledge Garden/Knowledge",
    archiveFolder: "Knowledge Garden/Archive",
    autoProcess: false,
    suggestTags: true,
    suggestAreas: true,
    preserveSources: true
  },
  relationship: { folder: "Knowledge Garden/Relationships" },
  stateBrowse: { mode: "vault" },
  aiProfiles: [],
  // 首次启动由旧 settings.ai 自动迁移生成 default（§一百三十九），见 main.loadSettings
  aiFunctionConfig: [],
  webSearch: { providers: [] },
  // Phase 14：知识考试（§176 默认：holistic / 5 题 / 中等 / 原文优先 / 卡片模式 / Web 关闭）
  exam: {
    generationProfileId: "",
    gradingProfileId: "",
    defaultMode: "holistic",
    defaultCount: 5,
    defaultDifficulty: "medium",
    defaultAnswerMode: "source_preferred",
    webEnabled: false,
    relatedNotesEnabled: false,
    autoGrade: false,
    cardMode: true
  },
  // Phase 13：Workspace / Skills / Capability / Permission（默认跟随旧行为，§一百二十九）
  workspaces: [],
  currentWorkspaceId: null,
  skillRegistry: [],
  modelMetadata: [],
  permissionsPolicy: {},
  // Phase 15：AI Workbench（§二百五十八；Web 默认关闭 §四十二；批量写默认 5 §七十五）
  workbench: {
    enabled: true,
    maxSteps: 8,
    // 5 / 8 / 12（§二百五十八）
    maxQueries: 5,
    // 默认 5（§四十四）
    maxPages: 10,
    // 默认 10（§四十六）
    maxChars: 2e4,
    // 默认 20000（§五十五）
    maxBatchWrites: 5,
    // 1 / 5 / 10（§七十五）
    webEnabledByDefault: false,
    // Web 必须显式启用（§四十二/二百五十八）
    historyLimit: 20,
    // 任务/问题历史保留条数（§一百九十三）
    vaultScope: "vault",
    // Retrieval v3：AI 可以搜索的范围（vault | workspace | current-folder | custom）
    customFolders: []
    // 自定义搜索目录（vaultScope=custom 时生效）
  }
};

// tests/p21-mgmt-hotfix-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
var DAY = 864e5;
var NOW = new Date(2026, 2, 10, 12, 0, 0).getTime();
function baseCard(id, createdAt) {
  return { id, sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", question: "\u9898 " + id, answer: "\u7B54", questionType: "recall", createdAt, updatedAt: createdAt };
}
function oldState(id, opts = {}) {
  const retr = opts.retr ?? 0.9;
  const stability = Math.max(1, 60 * (1 - retr) + 1);
  return {
    cardId: id,
    fsrsState: { due: opts.due ?? NOW + 3 * DAY, stability, difficulty: 5, reps: opts.reviewCount ?? 1, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 40 * DAY },
    lastRating: "good",
    reviewCount: opts.reviewCount ?? 1,
    lastReviewedAt: opts.lastReviewedAt,
    masteryPercent: opts.mastery,
    createdAt: opts.createdAt ?? NOW - 30 * DAY,
    updatedAt: NOW - 30 * DAY
  };
}
function metaOf(m) {
  return { due: m.due, retrievability: m.retrievability, mastery: m.mastery, lastReviewedAt: m.lastReviewedAt };
}
{
  const st0 = oldState("B", { reviewCount: 0 });
  const st1 = oldState("C", { reviewCount: 1 });
  test("P-HF-NEW-08", isNewSavedCard(st0) === true, "\u6709 state \u4F46 reviewCount=0 \u2192 \u4ECD\u4E3A\u65B0\u5361\uFF08\xA716/40\uFF09");
  test("P-HF-NEW-09", isNewSavedCard(st1) === false, "reviewCount=1 \u2192 \u4E0D\u662F\u65B0\u5361\uFF08\xA741\uFF09");
  test(
    "P-HF-NEW-09b",
    isNewSavedCard(null) === true && isNewSavedCard(void 0) === true,
    "\u65E0 FSRS state \u2192 \u65B0\u5361\uFF08\u4ECE\u672A\u771F\u5B9E FSRS Rating\uFF0C\xA715\uFF1B\u65E7 reviewCount \u4E0D\u4F5C\u6570\uFF09"
  );
  test(
    "P-HF-NEW-12a",
    DEFAULT_SETTINGS.spacedReview.savedCardNewWeight === 30,
    "savedCardNewWeight \u9ED8\u8BA4 30\uFF08mergeSettings \u4F1A\u4E3A\u65E7 data.json \u81EA\u52A8\u8865\u9ED8\u8BA4\uFF0C\xA763\uFF09"
  );
}
{
  const cards = [baseCard("A", NOW - 100 * DAY), baseCard("B", NOW - 50 * DAY)];
  const stateOf = (id) => id === "B" ? oldState("B", { reviewCount: 1 }) : null;
  const metaOf2 = (id) => {
    const st = stateOf(id);
    return { due: st ? st.fsrsState.due : void 0, retrievability: st ? 0.9 : null, mastery: st ? 50 : void 0, lastReviewedAt: st?.lastReviewedAt };
  };
  const orderNew = rankSavedCards(cards, stateOf, metaOf2, "new", 30, NOW);
  test("P-HF-NEW-01", orderNew[0] === "A" && orderNew[1] === "B", "\u65B0\u5361\u6A21\u5F0F\uFF1AA(\u65E0 state) \u5728 B(reviewCount=1) \u4E4B\u524D\uFF08\xA733\uFF09");
  const twoNew = [baseCard("A1", NOW - 200 * DAY), baseCard("B1", NOW - 20 * DAY)];
  const orderNew2 = rankSavedCards(twoNew, () => null, () => metaOf2("A"), "new", 30, NOW);
  test("P-HF-NEW-02", orderNew2[0] === "A1" && orderNew2[1] === "B1", "\u4E24\u5F20\u65B0\u5361 \u2192 \u6700\u65E9\u6536\u85CF\u5728\u524D\uFF08createdAt ASC\uFF0C\xA734\uFF09");
  const stateB = oldState("B2", { reviewCount: 1, retr: 0.1 });
  const orderNew3 = rankSavedCards(
    [baseCard("A2", NOW - 300 * DAY), baseCard("B2", NOW - 10 * DAY)],
    (id) => id === "B2" ? stateB : null,
    (id) => id === "B2" ? metaOf2({ retrievability: 0.1, due: NOW - DAY, mastery: 10 }) : metaOf2({ retrievability: null }),
    "new",
    30,
    NOW
  );
  test("P-HF-NEW-03", orderNew3[0] === "A2", "\u65B0\u5361\u6A21\u5F0F\uFF1AA(\u65B0) \u4F18\u5148\u4E8E\u4E25\u91CD\u9057\u5FD8\u7684\u65E7\u5361 B\uFF08\xA73/35\uFF09");
}
{
  const metaFor = (st) => st ? metaOf({ retrievability: 0.9, due: st.fsrsState.due, mastery: 90, lastReviewedAt: void 0 }) : metaOf({ retrievability: null });
  const stB = oldState("B", { reviewCount: 3, retr: 0.9, due: NOW + DAY, mastery: 90 });
  const cards = [baseCard("A", NOW - 50 * DAY), baseCard("B", NOW - 100 * DAY)];
  const byState = (id) => id === "B" ? stB : null;
  const byMeta = (id) => metaFor(byState(id));
  const rec30 = rankSavedCards(cards, byState, byMeta, "recommend", 30, NOW);
  test("P-HF-NEW-04", rec30[0] === "A", "\u9ED8\u8BA4\u6743\u91CD 30\uFF1AA(\u65B0) \u6BD4\u6307\u6807\u63A5\u8FD1\u7684\u65E7\u5361 B \u6392\u524D\uFF08\xA736\uFF09");
  const rec0 = rankSavedCards(cards, byState, byMeta, "recommend", 0, NOW);
  test(
    "P-HF-NEW-05",
    rec0[0] === "B" && rec0[1] === "A",
    "\u6743\u91CD 0\uFF1A\u65B0\u5361\u65E0 bonus \u2192 \u540C\u5206\u4EE5 createdAt \u7A33\u5B9A tie-break\uFF08B \u66F4\u65E9\uFF0C\xA737/71\uFF09"
  );
  const rec100 = rankSavedCards(cards, byState, byMeta, "recommend", 100, NOW);
  test("P-HF-NEW-06", rec100[0] === "A", "\u6743\u91CD 100\uFF1A\u65B0\u5361\u660E\u663E\u4F18\u5148\uFF08\xA738\uFF09");
  test(
    "P-HF-NEW-07",
    !isValidSavedCardNewWeight(-1) && !isValidSavedCardNewWeight(101) && isValidSavedCardNewWeight(0) && isValidSavedCardNewWeight(100),
    "\u6743\u91CD\u8FB9\u754C\uFF1A-1/101 \u62D2\u7EDD\uFF0C0/100 \u63A5\u53D7\uFF08\xA739\uFF09"
  );
  test(
    "P-HF-NEW-10",
    recommendSavedCardScore(metaOf({ retrievability: null }), true, 30, NOW) === 30,
    "\u65B0\u5361 + mastery/retr \u7F3A\u5931\uFF1A\u4E0D\u5D29\uFF0Cscore=30\uFF08newBonus \u751F\u6548\uFF09\uFF08\xA742\uFF09"
  );
  const scoreOld = recommendSavedCardScore(metaOf({ retrievability: 0.9, mastery: 90, due: NOW + DAY }), false, 30, NOW);
  const scoreNew = recommendSavedCardScore(metaOf({ retrievability: null }), true, 30, NOW);
  test(
    "P-HF-NEW-11",
    Number.isFinite(scoreOld) && Number.isFinite(scoreNew) && scoreNew > scoreOld,
    "retrievability null \u6B63\u5E38\u53C2\u4E0E\u8BC4\u5206\uFF08\xA743\uFF09"
  );
  test(
    "P-HF-NEW-12",
    rankSavedCards([baseCard("D", NOW - 5 * DAY)], () => null, () => metaOf({ retrievability: null }), "next", 30, NOW).length === 1,
    "\u65B0\u5361 due undefined \u2192 next \u6392\u5E8F\u4E0D\u5D29\uFF08\xA744\uFF1BUI \u663E\u793A\u201C\u9996\u6B21\u590D\u4E60\u201D\uFF09"
  );
}
{
  const dir = fs4.mkdtempSync(path3.join(os.tmpdir(), "kg-mgmt-"));
  const cards = new ReviewCardStore(dir);
  cards.load();
  const cr = new CardReviewStore(dir);
  cr.load();
  const exams = new ExamStore(dir);
  exams.load();
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  const exam = { id: "e1", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u6765\u6E90\u8003\u8BD5", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  exams.add(exam);
  cards.add({ ...baseCard("cardX", NOW), examId: "e1" });
  cr.add({ cardId: "cardX", reviewedAt: NOW, rating: "good" });
  spaced.scCommitReview("cardX", oldState("cardX", { reviewCount: 1, due: NOW + DAY }), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  cards.remove("cardX");
  spaced.scRemoveCard("cardX");
  cr.removeByCard("cardX");
  test("P-HF-DELETE-03", cards.get("cardX") === void 0 && cards.count() === 0, "\u786E\u8BA4\u5220\u9664\uFF1A\u5361\u7247\u4ECE ReviewCardStore \u6D88\u5931\uFF08\xA747\uFF09");
  test("P-HF-DELETE-04", spaced.scGet("cardX") === void 0 && spaced.scCount() === 0, "FSRS state \u5220\u9664\uFF08scRemoveCard\uFF0C\xA748/9\uFF09");
  test("P-HF-DELETE-05", cr.byCard("cardX").length === 0 && cr.count() === 0, "CardReviewRecord \u5220\u9664\uFF08\xA749\uFF09");
  test("P-HF-DELETE-07", exams.get("e1") !== void 0 && exams.findBySource("01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md").length === 1, "Exam \u4E0D\u53D7\u5F71\u54CD\uFF08\xA751\uFF09");
  test("P-HF-DELETE-08", exams.all()[0].sourcePath === "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", "source note \u4E0D\u53D7\u5F71\u54CD\uFF08\xA752\uFF09");
  test("P-HF-DELETE-13", cards.count() === 0 && cards.all().length === 0, "\u5220\u9664\u540E\u603B\u6570 -1\uFF08\u65B0\u5361\u7EDF\u8BA1\u968F\u4E4B\u66F4\u65B0\uFF0C\xA757/6\uFF09");
  cards.remove("cardX");
  test("P-HF-DELETE-15", cards.count() === 0, "\u91CD\u590D\u5220\u9664\uFF1Ano-op\uFF0C\u53EA\u6210\u529F\u4E00\u6B21\uFF08\xA759\uFF1BUI \u53E6\u6709 deleting \u9632\u8FDE\u70B9\uFF09");
  const st = oldState("old1", { reviewCount: 2, mastery: 90 });
  const ov = savedCardOverview([st], [], new class {
    retrievability() {
      return 0.9;
    }
  }(), NOW, 5);
  test(
    "P-HF-NEW-12b",
    ov.newCount === 5 && ov.total === 6 && ov.dist.proficient === 1,
    "overview\uFF1A\u65B0\u5361\u5355\u72EC\u8BA1\u6570\u4E14\u4E0D\u8BA1\u5165\u638C\u63E1\u5206\u5E03\uFF08got newCount=" + ov.newCount + ", total=" + ov.total + ", proficient=" + ov.dist.proficient + "\uFF09\uFF08\xA728/29/30/31\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const srcPath = path3.join(__dirname, "..", "src", "main.ts");
  const src = stripComments(fs4.readFileSync(srcPath, "utf8"));
  const delStart = src.indexOf("async deleteCard(cardId: string): Promise<void> {");
  const delMarker = src.indexOf("\u5DF2\u5220\u9664\u590D\u4E60\u5361\uFF080 AI\uFF09", delStart);
  const delBody = delStart >= 0 && delMarker > delStart ? src.slice(delStart, delMarker) : "";
  test(
    "P-HF-DELETE-09",
    delBody.length > 0 && !/\bAI\b|generate|prompt|apiKey/.test(delBody),
    "\u5220\u9664\u540E\u7AEF 0 AI\uFF08deleteCard \u65E0 AI/\u751F\u6210\u8C03\u7528\uFF0C\xA753\uFF09"
  );
  test(
    "P-HF-DELETE-10",
    !/recordAccess|markReviewed/.test(delBody),
    "\u5220\u9664\u4E0D\u8C03\u7528 recordAccess / markReviewed\uFF08Activity \u4E0D\u53D8\uFF0C\xA754/10\uFF09"
  );
  test(
    "P-HF-DELETE-06",
    /trash\(/.test(delBody) && /cardMarkdownPath/.test(delBody),
    "Review Card Markdown \u5220\u9664\u5165\u53E3\u4FDD\u7559\uFF08\u5B9E\u9645 trash \u5728 Obsidian \u8FD0\u884C\u5C42\uFF0C\xA750/6\uFF09"
  );
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
