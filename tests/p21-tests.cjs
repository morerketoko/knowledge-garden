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

// tests/p21-tests.ts
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
function padZero(num2) {
  return num2 < 10 ? `0${num2}` : `${num2}`;
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
var FUZZ_RANGES = [
  {
    start: 2.5,
    end: 7,
    factor: 0.15
  },
  {
    start: 7,
    end: 20,
    factor: 0.1
  },
  {
    start: 20,
    end: Infinity,
    factor: 0.05
  }
];
function get_fuzz_range(interval, elapsed_days, maximum_interval) {
  let delta = 1;
  for (const range of FUZZ_RANGES) {
    delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
  }
  interval = Math.min(interval, maximum_interval);
  let min_ivl = Math.max(2, Math.round(interval - delta));
  const max_ivl = Math.min(Math.round(interval + delta), maximum_interval);
  if (interval > elapsed_days) {
    min_ivl = Math.max(min_ivl, elapsed_days + 1);
  }
  min_ivl = Math.min(min_ivl, max_ivl);
  return { min_ivl, max_ivl };
}
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function roundTo(num2, decimals) {
  const factor = 10 ** decimals;
  return Math.round(num2 * factor) / factor;
}
function dateDiffInDays(last, cur) {
  const utc1 = Date.UTC(
    last.getUTCFullYear(),
    last.getUTCMonth(),
    last.getUTCDate()
  );
  const utc2 = Date.UTC(
    cur.getUTCFullYear(),
    cur.getUTCMonth(),
    cur.getUTCDate()
  );
  return Math.floor(
    (utc2 - utc1) / 864e5
    /** 1000 * 60 * 60 * 24*/
  );
}
var ConvertStepUnitToMinutes = (step) => {
  const unit = step.slice(-1);
  const value = parseInt(step.slice(0, -1), 10);
  if (Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
    throw new FSRSValidationError(`Invalid step value: ${step}`);
  }
  switch (unit) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 1440;
    default:
      throw new FSRSValidationError(
        `Invalid step unit: ${step}, expected m/h/d`
      );
  }
};
var BasicLearningStepsStrategy = (params, state, cur_step) => {
  const learning_steps = state === State.Relearning || state === State.Review ? params.relearning_steps : params.learning_steps;
  const steps_length = learning_steps.length;
  if (steps_length === 0 || cur_step >= steps_length) return {};
  const firstStep = learning_steps[0];
  const toMinutes = ConvertStepUnitToMinutes;
  const getAgainInterval = () => {
    return toMinutes(firstStep);
  };
  const getHardInterval = () => {
    if (steps_length === 1) return Math.round(toMinutes(firstStep) * 1.5);
    const nextStep = learning_steps[1];
    return Math.round((toMinutes(firstStep) + toMinutes(nextStep)) / 2);
  };
  const getStepInfo = (index) => {
    if (index < 0 || index >= steps_length) {
      return null;
    } else {
      return learning_steps[index];
    }
  };
  const getGoodMinutes = (step) => {
    return toMinutes(step);
  };
  const result = {};
  const step_info = getStepInfo(Math.max(0, cur_step));
  if (state === State.Review) {
    result[Rating.Again] = {
      scheduled_minutes: toMinutes(step_info),
      next_step: 0
    };
    return result;
  } else {
    result[Rating.Again] = {
      scheduled_minutes: getAgainInterval(),
      next_step: 0
    };
    result[Rating.Hard] = {
      scheduled_minutes: getHardInterval(),
      next_step: cur_step
    };
    const next_info = getStepInfo(cur_step + 1);
    if (next_info) {
      const nextMin = getGoodMinutes(next_info);
      if (nextMin) {
        result[Rating.Good] = {
          scheduled_minutes: Math.round(nextMin),
          next_step: cur_step + 1
        };
      }
    }
  }
  return result;
};
function DefaultInitSeedStrategy() {
  const time = this.review_time.getTime();
  const reps = this.current.reps;
  const mul = this.current.difficulty * this.current.stability;
  return `${time}_${reps}_${mul}`;
}
var StrategyMode = /* @__PURE__ */ ((StrategyMode2) => {
  StrategyMode2["SCHEDULER"] = "Scheduler";
  StrategyMode2["LEARNING_STEPS"] = "LearningSteps";
  StrategyMode2["SEED"] = "Seed";
  return StrategyMode2;
})(StrategyMode || {});
var AbstractScheduler = class {
  last;
  current;
  review_time;
  next = /* @__PURE__ */ new Map();
  algorithm;
  strategies;
  elapsed_days = 0;
  // init
  constructor(card, now, algorithm, strategies) {
    this.algorithm = algorithm;
    this.last = TypeConvert.card(card);
    this.current = TypeConvert.card(card);
    this.review_time = TypeConvert.time(now);
    this.strategies = strategies;
    this.init();
  }
  checkGrade(grade) {
    if (!Number.isFinite(grade) || grade < 1 || grade > 4) {
      throw new FSRSValidationError(`Invalid grade "${grade}",expected 1-4`);
    }
  }
  init() {
    const { state, last_review } = this.current;
    let interval = 0;
    if (state !== State.New && last_review) {
      interval = dateDiffInDays(last_review, this.review_time);
    }
    this.current.last_review = this.review_time;
    this.elapsed_days = interval;
    this.current.elapsed_days = interval;
    this.current.reps += 1;
    let seed_strategy = DefaultInitSeedStrategy;
    if (this.strategies) {
      const custom_strategy = this.strategies.get(StrategyMode.SEED);
      if (custom_strategy) {
        seed_strategy = custom_strategy;
      }
    }
    this.algorithm.seed = seed_strategy.call(this);
  }
  preview() {
    return {
      [Rating.Again]: this.review(Rating.Again),
      [Rating.Hard]: this.review(Rating.Hard),
      [Rating.Good]: this.review(Rating.Good),
      [Rating.Easy]: this.review(Rating.Easy),
      [Symbol.iterator]: this.previewIterator.bind(this)
    };
  }
  *previewIterator() {
    for (const grade of Grades) {
      yield this.review(grade);
    }
  }
  review(grade) {
    const { state } = this.last;
    let item;
    this.checkGrade(grade);
    switch (state) {
      case State.New:
        item = this.newState(grade);
        break;
      case State.Learning:
      case State.Relearning:
        item = this.learningState(grade);
        break;
      case State.Review:
        item = this.reviewState(grade);
        break;
    }
    return item;
  }
  buildLog(rating) {
    const { last_review, due, elapsed_days } = this.last;
    return {
      rating,
      state: this.current.state,
      due: last_review || due,
      stability: this.current.stability,
      difficulty: this.current.difficulty,
      elapsed_days: this.elapsed_days,
      last_elapsed_days: elapsed_days,
      scheduled_days: this.current.scheduled_days,
      learning_steps: this.current.learning_steps,
      review: this.review_time
    };
  }
};
var Alea = class {
  c;
  s0;
  s1;
  s2;
  constructor(seed) {
    const mash = Mash();
    this.c = 1;
    this.s0 = mash(" ");
    this.s1 = mash(" ");
    this.s2 = mash(" ");
    if (seed == null) seed = Date.now();
    this.s0 -= mash(seed);
    if (this.s0 < 0) this.s0 += 1;
    this.s1 -= mash(seed);
    if (this.s1 < 0) this.s1 += 1;
    this.s2 -= mash(seed);
    if (this.s2 < 0) this.s2 += 1;
  }
  next() {
    const t = 2091639 * this.s0 + this.c * 23283064365386963e-26;
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.c = t | 0;
    this.s2 = t - this.c;
    return this.s2;
  }
  set state(state) {
    this.c = state.c;
    this.s0 = state.s0;
    this.s1 = state.s1;
    this.s2 = state.s2;
  }
  get state() {
    return {
      c: this.c,
      s0: this.s0,
      s1: this.s1,
      s2: this.s2
    };
  }
};
function Mash() {
  let n = 4022871197;
  return function mash(data) {
    data = String(data);
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 4294967296;
    }
    return (n >>> 0) * 23283064365386963e-26;
  };
}
function alea(seed) {
  const xg = new Alea(seed);
  const prng = () => xg.next();
  prng.int32 = () => xg.next() * 4294967296 | 0;
  prng.double = () => prng() + (prng() * 2097152 | 0) * 11102230246251565e-32;
  prng.state = () => xg.state;
  prng.importState = (state) => {
    xg.state = state;
    return prng;
  };
  return prng;
}
var version = "5.4.2";
var default_request_retention = 0.9;
var default_maximum_interval = 36500;
var default_enable_fuzz = false;
var default_enable_short_term = true;
var default_learning_steps = Object.freeze([
  "1m",
  "10m"
]);
var default_relearning_steps = Object.freeze([
  "10m"
]);
var FSRSVersion = `v${version} using FSRS-6.0`;
var S_MIN = 1e-3;
var INIT_S_MAX = 100;
var FSRS5_DEFAULT_DECAY = 0.5;
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
var W17_W18_Ceiling = 2;
var CLAMP_PARAMETERS = (w17_w18_ceiling, enable_short_term = default_enable_short_term) => [
  [S_MIN, INIT_S_MAX],
  [S_MIN, INIT_S_MAX],
  [S_MIN, INIT_S_MAX],
  [S_MIN, INIT_S_MAX],
  [1, 10],
  [1e-3, 4],
  [1e-3, 4],
  [1e-3, 0.75],
  [0, 4.5],
  [0, 0.8],
  [1e-3, 3.5],
  [1e-3, 5],
  [1e-3, 0.25],
  [1e-3, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, w17_w18_ceiling],
  [0, w17_w18_ceiling],
  [
    enable_short_term ? 0.01 : 0,
    0.8
  ],
  [0.1, 0.8]
];
var clipParameters = (parameters, numRelearningSteps, enableShortTerm = default_enable_short_term) => {
  const clip = CLAMP_PARAMETERS(W17_W18_Ceiling, enableShortTerm).slice(
    0,
    parameters.length
  );
  if (Math.max(0, numRelearningSteps) > 1) {
    const w11 = clamp(parameters[11] || 0, clip[11][0], clip[11][1]);
    const w13 = clamp(parameters[13] || 0, clip[13][0], clip[13][1]);
    const w14 = clamp(parameters[14] || 0, clip[14][0], clip[14][1]);
    const value = -(Math.log(w11) + Math.log(Math.pow(2, w13) - 1) + w14 * 0.3) / numRelearningSteps;
    const w17_w18_ceiling = clamp(
      roundTo(Math.sqrt(Math.max(value, 0)), 8),
      0.01,
      W17_W18_Ceiling
    );
    if (clip[17]) clip[17] = [clip[17][0], w17_w18_ceiling];
    if (clip[18]) clip[18] = [clip[18][0], w17_w18_ceiling];
  }
  return clip.map(
    ([min, max], index) => clamp(parameters[index] || 0, min, max)
  );
};
var migrateParameters = (parameters, numRelearningSteps = 0, enableShortTerm = default_enable_short_term) => {
  if (parameters === void 0) {
    return [...default_w];
  }
  switch (parameters.length) {
    case 21:
      return clipParameters(
        Array.from(parameters),
        numRelearningSteps,
        enableShortTerm
      );
    case 19:
      console.debug("[FSRS-6]auto fill w from 19 to 21 length");
      return clipParameters(
        Array.from(parameters),
        numRelearningSteps,
        enableShortTerm
      ).concat([0, FSRS5_DEFAULT_DECAY]);
    case 17: {
      const w = clipParameters(
        Array.from(parameters),
        numRelearningSteps,
        enableShortTerm
      );
      w[4] = +(w[5] * 2 + w[4]).toFixed(8);
      w[5] = +(Math.log(w[5] * 3 + 1) / 3).toFixed(8);
      w[6] = +(w[6] + 0.5).toFixed(8);
      console.debug("[FSRS-6]auto fill w from 17 to 21 length");
      return w.concat([0, 0, 0, FSRS5_DEFAULT_DECAY]);
    }
    default:
      console.warn("[FSRS]Invalid parameters length, using default parameters");
      return [...default_w];
  }
};
var generatorParameters = (props) => {
  const learning_steps = Array.isArray(props?.learning_steps) ? props.learning_steps : default_learning_steps;
  const relearning_steps = Array.isArray(props?.relearning_steps) ? props.relearning_steps : default_relearning_steps;
  const enable_short_term = props?.enable_short_term ?? default_enable_short_term;
  const w = migrateParameters(
    props?.w,
    relearning_steps.length,
    enable_short_term
  );
  return {
    request_retention: props?.request_retention || default_request_retention,
    maximum_interval: props?.maximum_interval || default_maximum_interval,
    w,
    enable_fuzz: props?.enable_fuzz ?? default_enable_fuzz,
    enable_short_term,
    learning_steps,
    relearning_steps
  };
};
function createEmptyCard(now, afterHandler) {
  const emptyCard = {
    due: now ? TypeConvert.time(now) : /* @__PURE__ */ new Date(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    state: State.New,
    last_review: void 0
  };
  if (afterHandler && typeof afterHandler === "function") {
    return afterHandler(emptyCard);
  } else {
    return emptyCard;
  }
}
var computeDecayFactor = (decayOrParams) => {
  const decay = typeof decayOrParams === "number" ? -decayOrParams : -decayOrParams[20];
  const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1;
  return { decay, factor: roundTo(factor, 8) };
};
function forgetting_curve(decayOrParams, elapsed_days, stability) {
  const { decay, factor } = computeDecayFactor(decayOrParams);
  return roundTo(Math.pow(1 + factor * elapsed_days / stability, decay), 8);
}
var FSRSAlgorithm = class {
  param;
  intervalModifier;
  _seed;
  constructor(params) {
    this.param = new Proxy(
      this.prepare_parameters(params),
      this.params_handler_proxy()
    );
    this.intervalModifier = this.calculate_interval_modifier(
      this.param.request_retention
    );
    this.forgetting_curve = forgetting_curve.bind(this, this.param.w);
  }
  get interval_modifier() {
    return this.intervalModifier;
  }
  set seed(seed) {
    this._seed = seed;
  }
  /**
   * @see https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm#fsrs-5
   *
   * The formula used is: $$I(r,s) = (r^{\frac{1}{DECAY}} - 1) / FACTOR \times s$$
   * @param request_retention 0<request_retention<=1,Requested retention rate
   * @throws {Error} Requested retention rate should be in the range (0,1]
   */
  calculate_interval_modifier(request_retention) {
    if (request_retention <= 0 || request_retention > 1) {
      throw new FSRSValidationError(
        "Requested retention rate should be in the range (0,1]"
      );
    }
    const { decay, factor } = computeDecayFactor(this.param.w);
    return roundTo((Math.pow(request_retention, 1 / decay) - 1) / factor, 8);
  }
  /**
   * Get the parameters of the algorithm.
   */
  get parameters() {
    return this.param;
  }
  /**
   * Set the parameters of the algorithm.
   * @param params Partial<FSRSParameters>
   */
  set parameters(params) {
    this.update_parameters(params);
  }
  params_handler_proxy() {
    const _this = this;
    return {
      set: function(target, prop, value) {
        if (prop === "request_retention" && Number.isFinite(value)) {
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(value)
          );
        } else if (prop === "w") {
          value = migrateParameters(
            value,
            target.relearning_steps.length,
            target.enable_short_term
          );
          value = clipParameters(
            Array.from(value),
            target.relearning_steps.length,
            target.enable_short_term
          );
          _this.forgetting_curve = forgetting_curve.bind(this, value);
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(target.request_retention)
          );
        }
        Reflect.set(target, prop, value);
        return true;
      }
    };
  }
  update_parameters(params) {
    const _params = this.prepare_parameters(params);
    for (const key in _params) {
      const paramKey = key;
      this.param[paramKey] = _params[paramKey];
    }
  }
  prepare_parameters = (params) => {
    const generated = generatorParameters(params);
    generated.w = clipParameters(
      Array.from(generated.w),
      generated.relearning_steps.length,
      generated.enable_short_term
    );
    return generated;
  };
  /**
     * The formula used is :
     * $$ S_0(G) = w_{G-1}$$
     * $$S_0 = \max \lbrace S_0,0.1\rbrace $$
  
     * @param g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return Stability (interval when R=90%)
     */
  init_stability(g) {
    return Math.max(this.param.w[g - 1], 0.1);
  }
  /**
   * The formula used is :
   * $$D_0(G) = w_4 - e^{(G-1) \cdot w_5} + 1 $$
   * $$D_0 = \min \lbrace \max \lbrace D_0(G),1 \rbrace,10 \rbrace$$
   * where the $$D_0(1)=w_4$$ when the first rating is good.
   *
   * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
   * @return {number} Difficulty $$D \in [1,10]$$
   */
  init_difficulty(g) {
    const w = this.param.w;
    const d = w[4] - Math.exp((g - 1) * w[5]) + 1;
    return roundTo(d, 8);
  }
  /**
   * If fuzzing is disabled or ivl is less than 2.5, it returns the original interval.
   * @param {number} ivl - The interval to be fuzzed.
   * @param {number} elapsed_days t days since the last review
   * @return {number} - The fuzzed interval.
   **/
  apply_fuzz(ivl, elapsed_days) {
    if (!this.param.enable_fuzz || ivl < 2.5) return Math.round(ivl);
    const generator = alea(this._seed);
    const fuzz_factor = generator();
    const { min_ivl, max_ivl } = get_fuzz_range(
      ivl,
      elapsed_days,
      this.param.maximum_interval
    );
    return Math.floor(fuzz_factor * (max_ivl - min_ivl + 1) + min_ivl);
  }
  /**
   *   @see The formula used is : {@link FSRSAlgorithm.calculate_interval_modifier}
   *   @param {number} s - Stability (interval when R=90%)
   *   @param {number} elapsed_days t days since the last review
   */
  next_interval(s, elapsed_days) {
    const newInterval = Math.min(
      Math.max(1, Math.round(s * this.intervalModifier)),
      this.param.maximum_interval
    );
    return this.apply_fuzz(newInterval, elapsed_days);
  }
  /**
   * @see https://github.com/open-spaced-repetition/fsrs4anki/issues/697
   */
  linear_damping(delta_d, old_d) {
    return roundTo(delta_d * (10 - old_d) / 9, 8);
  }
  /**
   * The formula used is :
   * $$\text{delta}_d = -w_6 \cdot (g - 3)$$
   * $$\text{next}_d = D + \text{linear damping}(\text{delta}_d , D)$$
   * $$D^\prime(D,R) = w_7 \cdot D_0(4) +(1 - w_7) \cdot \text{next}_d$$
   * @param {number} d Difficulty $$D \in [1,10]$$
   * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
   * @return {number} $$\text{next}_D$$
   */
  next_difficulty(d, g) {
    const delta_d = -this.param.w[6] * (g - 3);
    const next_d = d + this.linear_damping(delta_d, d);
    return clamp(
      this.mean_reversion(this.init_difficulty(Rating.Easy), next_d),
      1,
      10
    );
  }
  /**
   * The formula used is :
   * $$w_7 \cdot \text{init} +(1 - w_7) \cdot \text{current}$$
   * @param {number} init $$w_2 : D_0(3) = w_2 + (R-2) \cdot w_3= w_2$$
   * @param {number} current $$D - w_6 \cdot (R - 2)$$
   * @return {number} difficulty
   */
  mean_reversion(init, current) {
    const w = this.param.w;
    return roundTo(w[7] * init + (1 - w[7]) * current, 8);
  }
  /**
   * The formula used is :
   * $$S^\prime_r(D,S,R,G) = S\cdot(e^{w_8}\cdot (11-D)\cdot S^{-w_9}\cdot(e^{w_{10}\cdot(1-R)}-1)\cdot w_{15}(\text{if} G=2) \cdot w_{16}(\text{if} G=4)+1)$$
   * @param {number} d Difficulty D \in [1,10]
   * @param {number} s Stability (interval when R=90%)
   * @param {number} r Retrievability (probability of recall)
   * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
   * @return {number} S^\prime_r new stability after recall
   */
  next_recall_stability(d, s, r, g) {
    const w = this.param.w;
    const hard_penalty = Rating.Hard === g ? w[15] : 1;
    const easy_bound = Rating.Easy === g ? w[16] : 1;
    return roundTo(
      clamp(
        s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard_penalty * easy_bound),
        S_MIN,
        36500
      ),
      8
    );
  }
  /**
   * The formula used is :
   * $$S^\prime_f(D,S,R) = w_{11}\cdot D^{-w_{12}}\cdot ((S+1)^{w_{13}}-1) \cdot e^{w_{14}\cdot(1-R)}$$
   * enable_short_term = true : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, \frac{S}{e^{w_{17} \cdot w_{18}}} \rbrace$$
   * enable_short_term = false : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, S \rbrace$$
   * @param {number} d Difficulty D \in [1,10]
   * @param {number} s Stability (interval when R=90%)
   * @param {number} r Retrievability (probability of recall)
   * @return {number} S^\prime_f new stability after forgetting
   */
  next_forget_stability(d, s, r) {
    const w = this.param.w;
    return roundTo(
      clamp(
        w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]),
        S_MIN,
        36500
      ),
      8
    );
  }
  /**
   * The formula used is :
   * $$S^\prime_s(S,G) = S \cdot e^{w_{17} \cdot (G-3+w_{18})}$$
   * @param {number} s Stability (interval when R=90%)
   * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
   */
  next_short_term_stability(s, g) {
    const w = this.param.w;
    const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
    const maskedSinc = g >= Rating.Hard ? Math.max(sinc, 1) : sinc;
    return roundTo(clamp(s * maskedSinc, S_MIN, 36500), 8);
  }
  /**
   * The formula used is :
   * $$R(t,S) = (1 + \text{FACTOR} \times \frac{t}{9 \cdot S})^{\text{DECAY}}$$
   * @param {number} elapsed_days t days since the last review
   * @param {number} stability Stability (interval when R=90%)
   * @return {number} r Retrievability (probability of recall)
   */
  forgetting_curve;
  /**
   * Calculates the next state of memory based on the current state, time elapsed, and grade.
   *
   * @param memory_state - The current state of memory, which can be null.
   * @param t - The time elapsed since the last review.
   * @param {Rating} g Grade (Rating[0.Manual,1.Again,2.Hard,3.Good,4.Easy])
   * @param r - Optional retrievability value. If not provided, it will be calculated.
   * @returns The next state of memory with updated difficulty and stability.
   */
  next_state(memory_state, t, g, r) {
    const { difficulty: d, stability: s } = memory_state ?? {
      difficulty: 0,
      stability: 0
    };
    if (t < 0) {
      throw new FSRSValidationError(`Invalid delta_t "${t}"`);
    }
    if (g < 0 || g > 4) {
      throw new FSRSValidationError(`Invalid grade "${g}"`);
    }
    if (d === 0 && s === 0) {
      return {
        difficulty: clamp(this.init_difficulty(g), 1, 10),
        stability: this.init_stability(g)
      };
    }
    if (g === 0) {
      return {
        difficulty: d,
        stability: s
      };
    }
    if (d < 1 || s < S_MIN) {
      throw new FSRSValidationError(
        `Invalid memory state { difficulty: ${d}, stability: ${s} }`
      );
    }
    const w = this.param.w;
    r = typeof r === "number" ? r : this.forgetting_curve(t, s);
    let new_s;
    if (t === 0 && this.param.enable_short_term) {
      new_s = this.next_short_term_stability(s, g);
    } else if (g === 1) {
      const s_after_fail = this.next_forget_stability(d, s, r);
      let [w_17, w_18] = [0, 0];
      if (this.param.enable_short_term) {
        w_17 = w[17];
        w_18 = w[18];
      }
      const next_s_min = s / Math.exp(w_17 * w_18);
      new_s = clamp(roundTo(next_s_min, 8), S_MIN, s_after_fail);
    } else {
      new_s = this.next_recall_stability(d, s, r, g);
    }
    const new_d = this.next_difficulty(d, g);
    return { difficulty: new_d, stability: new_s };
  }
};
var BasicScheduler = class extends AbstractScheduler {
  learningStepsStrategy;
  constructor(card, now, algorithm, strategies) {
    super(card, now, algorithm, strategies);
    let learningStepStrategy = BasicLearningStepsStrategy;
    if (this.strategies) {
      const custom_strategy = this.strategies.get(StrategyMode.LEARNING_STEPS);
      if (custom_strategy) {
        learningStepStrategy = custom_strategy;
      }
    }
    this.learningStepsStrategy = learningStepStrategy;
  }
  getLearningInfo(card, grade) {
    const parameters = this.algorithm.parameters;
    card.learning_steps = card.learning_steps || 0;
    const steps_strategy = this.learningStepsStrategy(
      parameters,
      card.state,
      card.learning_steps
    );
    const scheduled_minutes = Math.max(
      0,
      steps_strategy[grade]?.scheduled_minutes ?? 0
    );
    const next_steps = Math.max(0, steps_strategy[grade]?.next_step ?? 0);
    return {
      scheduled_minutes,
      next_steps
    };
  }
  /**
   * @description This function applies the learning steps based on the current card's state and grade.
   */
  applyLearningSteps(nextCard, grade, to_state) {
    const { scheduled_minutes, next_steps } = this.getLearningInfo(
      this.current,
      grade
    );
    if (scheduled_minutes > 0 && scheduled_minutes < 1440) {
      nextCard.learning_steps = next_steps;
      nextCard.scheduled_days = 0;
      nextCard.state = to_state;
      nextCard.due = date_scheduler(
        this.review_time,
        Math.round(scheduled_minutes),
        false
        /** true:days false: minute */
      );
    } else {
      nextCard.state = State.Review;
      if (scheduled_minutes >= 1440) {
        nextCard.learning_steps = next_steps;
        nextCard.due = date_scheduler(
          this.review_time,
          Math.round(scheduled_minutes),
          false
          /** true:days false: minute */
        );
        nextCard.scheduled_days = Math.floor(scheduled_minutes / 1440);
      } else {
        nextCard.learning_steps = 0;
        const interval = this.algorithm.next_interval(
          nextCard.stability,
          this.elapsed_days
        );
        nextCard.scheduled_days = interval;
        nextCard.due = date_scheduler(this.review_time, interval, true);
      }
    }
  }
  newState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const next = this.next_ds(this.elapsed_days, grade);
    this.applyLearningSteps(next, grade, State.Learning);
    const item = {
      card: next,
      log: this.buildLog(grade)
    };
    this.next.set(grade, item);
    return item;
  }
  learningState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const next = this.next_ds(this.elapsed_days, grade);
    this.applyLearningSteps(
      next,
      grade,
      this.last.state
      /** Learning or Relearning */
    );
    const item = {
      card: next,
      log: this.buildLog(grade)
    };
    this.next.set(grade, item);
    return item;
  }
  reviewState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const interval = this.elapsed_days;
    const retrievability = this.algorithm.forgetting_curve(
      interval,
      this.current.stability
    );
    const next_again = this.next_ds(interval, Rating.Again, retrievability);
    const next_hard = this.next_ds(interval, Rating.Hard, retrievability);
    const next_good = this.next_ds(interval, Rating.Good, retrievability);
    const next_easy = this.next_ds(interval, Rating.Easy, retrievability);
    this.next_interval(next_hard, next_good, next_easy, interval);
    this.next_state(next_hard, next_good, next_easy);
    this.applyLearningSteps(next_again, Rating.Again, State.Relearning);
    next_again.lapses += 1;
    const item_again = {
      card: next_again,
      log: this.buildLog(Rating.Again)
    };
    const item_hard = {
      card: next_hard,
      log: super.buildLog(Rating.Hard)
    };
    const item_good = {
      card: next_good,
      log: super.buildLog(Rating.Good)
    };
    const item_easy = {
      card: next_easy,
      log: super.buildLog(Rating.Easy)
    };
    this.next.set(Rating.Again, item_again);
    this.next.set(Rating.Hard, item_hard);
    this.next.set(Rating.Good, item_good);
    this.next.set(Rating.Easy, item_easy);
    return this.next.get(grade);
  }
  /**
   * Review next_ds
   */
  next_ds(t, g, r) {
    const next_state = this.algorithm.next_state(
      {
        difficulty: this.current.difficulty,
        stability: this.current.stability
      },
      t,
      g,
      r
    );
    const card = TypeConvert.card(this.current);
    card.difficulty = next_state.difficulty;
    card.stability = next_state.stability;
    return card;
  }
  /**
   * Review next_interval
   */
  next_interval(next_hard, next_good, next_easy, interval) {
    let hard_interval, good_interval;
    hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
    good_interval = this.algorithm.next_interval(next_good.stability, interval);
    hard_interval = Math.min(hard_interval, good_interval);
    good_interval = Math.max(good_interval, hard_interval + 1);
    const easy_interval = Math.max(
      this.algorithm.next_interval(next_easy.stability, interval),
      good_interval + 1
    );
    next_hard.scheduled_days = hard_interval;
    next_hard.due = date_scheduler(this.review_time, hard_interval, true);
    next_good.scheduled_days = good_interval;
    next_good.due = date_scheduler(this.review_time, good_interval, true);
    next_easy.scheduled_days = easy_interval;
    next_easy.due = date_scheduler(this.review_time, easy_interval, true);
  }
  /**
   * Review next_state
   */
  next_state(next_hard, next_good, next_easy) {
    next_hard.state = State.Review;
    next_hard.learning_steps = 0;
    next_good.state = State.Review;
    next_good.learning_steps = 0;
    next_easy.state = State.Review;
    next_easy.learning_steps = 0;
  }
};
var LongTermScheduler = class extends AbstractScheduler {
  newState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    this.current.scheduled_days = 0;
    this.current.elapsed_days = 0;
    const first_interval = 0;
    const next_again = this.next_ds(first_interval, Rating.Again);
    const next_hard = this.next_ds(first_interval, Rating.Hard);
    const next_good = this.next_ds(first_interval, Rating.Good);
    const next_easy = this.next_ds(first_interval, Rating.Easy);
    this.next_interval(
      next_again,
      next_hard,
      next_good,
      next_easy,
      first_interval
    );
    this.next_state(next_again, next_hard, next_good, next_easy);
    this.update_next(next_again, next_hard, next_good, next_easy);
    return this.next.get(grade);
  }
  next_ds(t, g, r) {
    const next_state = this.algorithm.next_state(
      {
        difficulty: this.current.difficulty,
        stability: this.current.stability
      },
      t,
      g,
      r
    );
    const card = TypeConvert.card(this.current);
    card.difficulty = next_state.difficulty;
    card.stability = next_state.stability;
    return card;
  }
  /**
   * @see https://github.com/open-spaced-repetition/ts-fsrs/issues/98#issuecomment-2241923194
   */
  learningState(grade) {
    return this.reviewState(grade);
  }
  reviewState(grade) {
    const exist = this.next.get(grade);
    if (exist) {
      return exist;
    }
    const interval = this.elapsed_days;
    const retrievability = this.algorithm.forgetting_curve(
      interval,
      this.current.stability
    );
    const next_again = this.next_ds(interval, Rating.Again, retrievability);
    const next_hard = this.next_ds(interval, Rating.Hard, retrievability);
    const next_good = this.next_ds(interval, Rating.Good, retrievability);
    const next_easy = this.next_ds(interval, Rating.Easy, retrievability);
    this.next_interval(next_again, next_hard, next_good, next_easy, interval);
    this.next_state(next_again, next_hard, next_good, next_easy);
    next_again.lapses += 1;
    this.update_next(next_again, next_hard, next_good, next_easy);
    return this.next.get(grade);
  }
  /**
   * Review/New next_interval
   */
  next_interval(next_again, next_hard, next_good, next_easy, interval) {
    let again_interval, hard_interval, good_interval, easy_interval;
    again_interval = this.algorithm.next_interval(
      next_again.stability,
      interval
    );
    hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
    good_interval = this.algorithm.next_interval(next_good.stability, interval);
    easy_interval = this.algorithm.next_interval(next_easy.stability, interval);
    again_interval = Math.min(again_interval, hard_interval);
    hard_interval = Math.max(hard_interval, again_interval + 1);
    good_interval = Math.max(good_interval, hard_interval + 1);
    easy_interval = Math.max(easy_interval, good_interval + 1);
    next_again.scheduled_days = again_interval;
    next_again.due = date_scheduler(this.review_time, again_interval, true);
    next_hard.scheduled_days = hard_interval;
    next_hard.due = date_scheduler(this.review_time, hard_interval, true);
    next_good.scheduled_days = good_interval;
    next_good.due = date_scheduler(this.review_time, good_interval, true);
    next_easy.scheduled_days = easy_interval;
    next_easy.due = date_scheduler(this.review_time, easy_interval, true);
  }
  /**
   * Review/New next_state
   */
  next_state(next_again, next_hard, next_good, next_easy) {
    next_again.state = State.Review;
    next_again.learning_steps = 0;
    next_hard.state = State.Review;
    next_hard.learning_steps = 0;
    next_good.state = State.Review;
    next_good.learning_steps = 0;
    next_easy.state = State.Review;
    next_easy.learning_steps = 0;
  }
  update_next(next_again, next_hard, next_good, next_easy) {
    const item_again = {
      card: next_again,
      log: this.buildLog(Rating.Again)
    };
    const item_hard = {
      card: next_hard,
      log: super.buildLog(Rating.Hard)
    };
    const item_good = {
      card: next_good,
      log: super.buildLog(Rating.Good)
    };
    const item_easy = {
      card: next_easy,
      log: super.buildLog(Rating.Easy)
    };
    this.next.set(Rating.Again, item_again);
    this.next.set(Rating.Hard, item_hard);
    this.next.set(Rating.Good, item_good);
    this.next.set(Rating.Easy, item_easy);
  }
};
var Reschedule = class {
  fsrs;
  /**
   * Creates an instance of the `Reschedule` class.
   * @param fsrs - An instance of the FSRS class used for scheduling.
   */
  constructor(fsrs2) {
    this.fsrs = fsrs2;
  }
  /**
   * Replays a review for a card and determines the next review date based on the given rating.
   * @param card - The card being reviewed.
   * @param reviewed - The date the card was reviewed.
   * @param rating - The grade given to the card during the review.
   * @returns A `RecordLogItem` containing the updated card and review log.
   */
  replay(card, reviewed, rating) {
    return this.fsrs.next(card, reviewed, rating);
  }
  /**
   * Processes a manual review for a card, allowing for custom state, stability, difficulty, and due date.
   * @param card - The card being reviewed.
   * @param state - The state of the card after the review.
   * @param reviewed - The date the card was reviewed.
   * @param elapsed_days - The number of days since the last review.
   * @param stability - (Optional) The stability of the card.
   * @param difficulty - (Optional) The difficulty of the card.
   * @param due - (Optional) The due date for the next review.
   * @returns A `RecordLogItem` containing the updated card and review log.
   * @throws Will throw an error if the state or due date is not provided when required.
   */
  handleManualRating(card, state, reviewed, elapsed_days, stability, difficulty, due) {
    if (typeof state === "undefined") {
      throw new FSRSValidationError(
        "reschedule: state is required for manual rating"
      );
    }
    let log;
    let next_card;
    if (state === State.New) {
      log = {
        rating: Rating.Manual,
        state,
        due: due ?? reviewed,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days,
        last_elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        review: reviewed
      };
      next_card = createEmptyCard(reviewed);
      next_card.last_review = reviewed;
    } else {
      if (typeof due === "undefined") {
        throw new FSRSValidationError(
          "reschedule: due is required for manual rating"
        );
      }
      const scheduled_days = date_diff(due, reviewed, "days");
      log = {
        rating: Rating.Manual,
        state: card.state,
        due: card.last_review || card.due,
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days,
        last_elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        review: reviewed
      };
      next_card = {
        ...card,
        state,
        due,
        last_review: reviewed,
        stability: stability || card.stability,
        difficulty: difficulty || card.difficulty,
        elapsed_days,
        scheduled_days,
        reps: card.reps + 1
      };
    }
    return { card: next_card, log };
  }
  /**
   * Reschedules a card based on its review history.
   *
   * @param current_card - The card to be rescheduled.
   * @param reviews - An array of review history objects.
   * @returns An array of record log items representing the rescheduling process.
   */
  reschedule(current_card, reviews) {
    const collections = [];
    let cur_card = createEmptyCard(current_card.due);
    for (const review of reviews) {
      let item;
      review.review = TypeConvert.time(review.review);
      if (review.rating === Rating.Manual) {
        let interval = 0;
        if (cur_card.state !== State.New && cur_card.last_review) {
          interval = date_diff(review.review, cur_card.last_review, "days");
        }
        item = this.handleManualRating(
          cur_card,
          review.state,
          review.review,
          interval,
          review.stability,
          review.difficulty,
          review.due ? TypeConvert.time(review.due) : void 0
        );
      } else {
        item = this.replay(cur_card, review.review, review.rating);
      }
      collections.push(item);
      cur_card = item.card;
    }
    return collections;
  }
  calculateManualRecord(current_card, now, record_log_item, update_memory) {
    if (!record_log_item) {
      return null;
    }
    const { card: reschedule_card, log } = record_log_item;
    const cur_card = TypeConvert.card(current_card);
    if (cur_card.due.getTime() === reschedule_card.due.getTime()) {
      return null;
    }
    cur_card.scheduled_days = date_diff(
      reschedule_card.due,
      cur_card.due,
      "days"
    );
    return this.handleManualRating(
      cur_card,
      reschedule_card.state,
      TypeConvert.time(now),
      log.elapsed_days,
      update_memory ? reschedule_card.stability : void 0,
      update_memory ? reschedule_card.difficulty : void 0,
      reschedule_card.due
    );
  }
};
function applyAfterHandler(value, afterHandler) {
  return typeof afterHandler === "function" ? afterHandler(value) : value;
}
var FSRS = class extends FSRSAlgorithm {
  strategyHandler = /* @__PURE__ */ new Map();
  Scheduler;
  constructor(param) {
    super(param);
    const { enable_short_term } = this.parameters;
    this.Scheduler = enable_short_term ? BasicScheduler : LongTermScheduler;
  }
  params_handler_proxy() {
    const _this = this;
    return {
      set: function(target, prop, value) {
        if (prop === "request_retention" && Number.isFinite(value)) {
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(value)
          );
        } else if (prop === "enable_short_term") {
          _this.Scheduler = value === true ? BasicScheduler : LongTermScheduler;
        } else if (prop === "w") {
          value = migrateParameters(
            value,
            target.relearning_steps.length,
            target.enable_short_term
          );
          value = clipParameters(
            Array.from(value),
            target.relearning_steps.length,
            target.enable_short_term
          );
          _this.forgetting_curve = forgetting_curve.bind(this, value);
          _this.intervalModifier = _this.calculate_interval_modifier(
            Number(target.request_retention)
          );
        }
        Reflect.set(target, prop, value);
        return true;
      }
    };
  }
  useStrategy(mode, handler) {
    this.strategyHandler.set(mode, handler);
    return this;
  }
  clearStrategy(mode) {
    if (mode) {
      this.strategyHandler.delete(mode);
    } else {
      this.strategyHandler.clear();
    }
    return this;
  }
  getScheduler(card, now) {
    const schedulerStrategy = this.strategyHandler.get(
      StrategyMode.SCHEDULER
    );
    const Scheduler = schedulerStrategy || this.Scheduler;
    const instance = new Scheduler(card, now, this, this.strategyHandler);
    return instance;
  }
  /**
   * Display the collection of cards and logs for the four scenarios after scheduling the card at the current time.
   * @param card Card to be processed
   * @param now Current time or scheduled time
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const card: Card = createEmptyCard(new Date());
   * const f = fsrs();
   * const recordLog = f.repeat(card, new Date());
   * ```
   * @example
   * ```typescript
   * interface RevLogUnchecked
   *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
   *   cid: string;
   *   due: Date | number;
   *   state: StateType;
   *   review: Date | number;
   *   rating: RatingType;
   * }
   *
   * interface RepeatRecordLog {
   *   card: CardUnChecked; //see method: createEmptyCard
   *   log: RevLogUnchecked;
   * }
   *
   * function repeatAfterHandler(recordLog: RecordLog) {
   *     const record: { [key in Grade]: RepeatRecordLog } = {} as {
   *       [key in Grade]: RepeatRecordLog;
   *     };
   *     for (const grade of Grades) {
   *       record[grade] = {
   *         card: {
   *           ...(recordLog[grade].card as Card & { cid: string }),
   *           due: recordLog[grade].card.due.getTime(),
   *           state: State[recordLog[grade].card.state] as StateType,
   *           last_review: recordLog[grade].card.last_review
   *             ? recordLog[grade].card.last_review!.getTime()
   *             : null,
   *         },
   *         log: {
   *           ...recordLog[grade].log,
   *           cid: (recordLog[grade].card as Card & { cid: string }).cid,
   *           due: recordLog[grade].log.due.getTime(),
   *           review: recordLog[grade].log.review.getTime(),
   *           state: State[recordLog[grade].log.state] as StateType,
   *           rating: Rating[recordLog[grade].log.rating] as RatingType,
   *         },
   *       };
   *     }
   *     return record;
   * }
   * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
   * const f = fsrs();
   * const recordLog = f.repeat(card, new Date(), repeatAfterHandler);
   * ```
   */
  repeat(card, now, afterHandler) {
    const instance = this.getScheduler(card, now);
    const recordLog = instance.preview();
    return applyAfterHandler(recordLog, afterHandler);
  }
  /**
   * Display the collection of cards and logs for the card scheduled at the current time, after applying a specific grade rating.
   * @param card Card to be processed
   * @param now Current time or scheduled time
   * @param grade Rating of the review (Again, Hard, Good, Easy)
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const card: Card = createEmptyCard(new Date());
   * const f = fsrs();
   * const recordLogItem = f.next(card, new Date(), Rating.Again);
   * ```
   * @example
   * ```typescript
   * interface RevLogUnchecked
   *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
   *   cid: string;
   *   due: Date | number;
   *   state: StateType;
   *   review: Date | number;
   *   rating: RatingType;
   * }
   *
   * interface NextRecordLog {
   *   card: CardUnChecked; //see method: createEmptyCard
   *   log: RevLogUnchecked;
   * }
   *
  function nextAfterHandler(recordLogItem: RecordLogItem) {
    const recordItem = {
      card: {
        ...(recordLogItem.card as Card & { cid: string }),
        due: recordLogItem.card.due.getTime(),
        state: State[recordLogItem.card.state] as StateType,
        last_review: recordLogItem.card.last_review
          ? recordLogItem.card.last_review!.getTime()
          : null,
      },
      log: {
        ...recordLogItem.log,
        cid: (recordLogItem.card as Card & { cid: string }).cid,
        due: recordLogItem.log.due.getTime(),
        review: recordLogItem.log.review.getTime(),
        state: State[recordLogItem.log.state] as StateType,
        rating: Rating[recordLogItem.log.rating] as RatingType,
      },
    };
    return recordItem
  }
   * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
   * const f = fsrs();
   * const recordLogItem = f.repeat(card, new Date(), Rating.Again, nextAfterHandler);
   * ```
   */
  next(card, now, grade, afterHandler) {
    const instance = this.getScheduler(card, now);
    const g = TypeConvert.rating(grade);
    if (g === Rating.Manual) {
      throw new FSRSValidationError("Cannot review a manual rating");
    }
    const recordLogItem = instance.review(g);
    return applyAfterHandler(recordLogItem, afterHandler);
  }
  /**
   * Get the retrievability of the card
   * @param card  Card to be processed
   * @param now  Current time or scheduled time
   * @param format  default:true , Convert the result to another type. (Optional)
   * @returns  The retrievability of the card,if format is true, the result is a string, otherwise it is a number
   */
  get_retrievability(card, now, format = true) {
    const processedCard = TypeConvert.card(card);
    now = now ? TypeConvert.time(now) : /* @__PURE__ */ new Date();
    const t = processedCard.state !== State.New ? Math.max(date_diff(now, processedCard.last_review, "days"), 0) : 0;
    const r = processedCard.state !== State.New ? this.forgetting_curve(t, +processedCard.stability.toFixed(8)) : 0;
    return format ? `${(r * 100).toFixed(2)}%` : r;
  }
  /**
   *
   * @param card Card to be processed
   * @param log last review log
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const now = new Date();
   * const f = fsrs();
   * const emptyCardFormAfterHandler = createEmptyCard(now);
   * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now);
   * const { card, log } = repeatFormAfterHandler[Rating.Hard];
   * const rollbackFromAfterHandler = f.rollback(card, log);
   * ```
   *
   * @example
   * ```typescript
   * const now = new Date();
   * const f = fsrs();
   * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler);  //see method: createEmptyCard
   * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
   * const { card, log } = repeatFormAfterHandler[Rating.Hard];
   * const rollbackFromAfterHandler = f.rollback(card, log, cardAfterHandler);
   * ```
   */
  rollback(card, log, afterHandler) {
    const processedCard = TypeConvert.card(card);
    const processedLog = TypeConvert.review_log(log);
    if (processedLog.rating === Rating.Manual) {
      throw new FSRSValidationError("Cannot rollback a manual rating");
    }
    let last_due;
    let last_review;
    let last_lapses;
    switch (processedLog.state) {
      case State.New:
        last_due = processedLog.due;
        last_review = void 0;
        last_lapses = 0;
        break;
      case State.Learning:
      case State.Relearning:
      case State.Review:
        last_due = processedLog.review;
        last_review = processedLog.due;
        last_lapses = processedCard.lapses - (processedLog.rating === Rating.Again && processedLog.state === State.Review ? 1 : 0);
        break;
    }
    const prevCard = {
      ...processedCard,
      due: last_due,
      stability: processedLog.stability,
      difficulty: processedLog.difficulty,
      elapsed_days: processedLog.last_elapsed_days,
      scheduled_days: processedLog.scheduled_days,
      reps: Math.max(0, processedCard.reps - 1),
      lapses: Math.max(0, last_lapses),
      learning_steps: processedLog.learning_steps,
      state: processedLog.state,
      last_review
    };
    return applyAfterHandler(prevCard, afterHandler);
  }
  /**
   *
   * @param card Card to be processed
   * @param now Current time or scheduled time
   * @param reset_count Should the review count information(reps,lapses) be reset. (Optional)
   * @param afterHandler Convert the result to another type. (Optional)
   * @example
   * ```typescript
   * const now = new Date();
   * const f = fsrs();
   * const emptyCard = createEmptyCard(now);
   * const scheduling_cards = f.repeat(emptyCard, now);
   * const { card, log } = scheduling_cards[Rating.Hard];
   * const forgetCard = f.forget(card, new Date(), true);
   * ```
   *
   * @example
   * ```typescript
   * interface RepeatRecordLog {
   *   card: CardUnChecked; //see method: createEmptyCard
   *   log: RevLogUnchecked; //see method: fsrs.repeat()
   * }
   *
   * function forgetAfterHandler(recordLogItem: RecordLogItem): RepeatRecordLog {
   *     return {
   *       card: {
   *         ...(recordLogItem.card as Card & { cid: string }),
   *         due: recordLogItem.card.due.getTime(),
   *         state: State[recordLogItem.card.state] as StateType,
   *         last_review: recordLogItem.card.last_review
   *           ? recordLogItem.card.last_review!.getTime()
   *           : null,
   *       },
   *       log: {
   *         ...recordLogItem.log,
   *         cid: (recordLogItem.card as Card & { cid: string }).cid,
   *         due: recordLogItem.log.due.getTime(),
   *         review: recordLogItem.log.review.getTime(),
   *         state: State[recordLogItem.log.state] as StateType,
   *         rating: Rating[recordLogItem.log.rating] as RatingType,
   *       },
   *     };
   * }
   * const now = new Date();
   * const f = fsrs();
   * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler); //see method:  createEmptyCard
   * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
   * const { card } = repeatFormAfterHandler[Rating.Hard];
   * const forgetFromAfterHandler = f.forget(card, date_scheduler(now, 1, true), false, forgetAfterHandler);
   * ```
   */
  forget(card, now, reset_count = false, afterHandler) {
    const processedCard = TypeConvert.card(card);
    now = TypeConvert.time(now);
    const scheduled_days = processedCard.state === State.New ? 0 : date_diff(now, processedCard.due, "days");
    const forget_log = {
      rating: Rating.Manual,
      state: processedCard.state,
      due: processedCard.due,
      stability: processedCard.stability,
      difficulty: processedCard.difficulty,
      elapsed_days: 0,
      last_elapsed_days: processedCard.elapsed_days,
      scheduled_days,
      learning_steps: processedCard.learning_steps,
      review: now
    };
    const forget_card = {
      ...processedCard,
      due: now,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: reset_count ? 0 : processedCard.reps,
      lapses: reset_count ? 0 : processedCard.lapses,
      learning_steps: 0,
      state: State.New,
      last_review: processedCard.last_review
    };
    const recordLogItem = { card: forget_card, log: forget_log };
    return applyAfterHandler(recordLogItem, afterHandler);
  }
  /**
   * Reschedules the current card and returns the rescheduled collections and reschedule item.
   *
   * @template T - The type of the record log item.
   * @param {CardInput | Card} current_card - The current card to be rescheduled.
   * @param {Array<FSRSHistory>} reviews - The array of FSRSHistory objects representing the reviews.
   * @param {Partial<RescheduleOptions<T>>} options - The optional reschedule options.
   * @returns {IReschedule<T>} - The rescheduled collections and reschedule item.
   *
   * @example
   * ```typescript
   * const f = fsrs()
   * const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Good, Rating.Good]
   * const reviews_at = [
   *   new Date(2024, 8, 13),
   *   new Date(2024, 8, 13),
   *   new Date(2024, 8, 17),
   *   new Date(2024, 8, 28),
   * ]
   *
   * const reviews: FSRSHistory[] = []
   * for (let i = 0; i < grades.length; i++) {
   *   reviews.push({
   *     rating: grades[i],
   *     review: reviews_at[i],
   *   })
   * }
   *
   * const results_short = scheduler.reschedule(
   *   createEmptyCard(),
   *   reviews,
   *   {
   *     skipManual: false,
   *   }
   * )
   * console.log(results_short)
   * ```
   */
  reschedule(current_card, reviews = [], options = {}) {
    const {
      recordLogHandler,
      reviewsOrderBy,
      skipManual = true,
      now = /* @__PURE__ */ new Date(),
      update_memory_state: updateMemoryState = false
    } = options;
    if (reviewsOrderBy && typeof reviewsOrderBy === "function") {
      reviews.sort(reviewsOrderBy);
    }
    if (skipManual) {
      reviews = reviews.filter((review) => review.rating !== Rating.Manual);
    }
    const rescheduleSvc = new Reschedule(this);
    const collections = rescheduleSvc.reschedule(
      options.first_card || createEmptyCard(),
      reviews
    );
    const len = collections.length;
    const cur_card = TypeConvert.card(current_card);
    const manual_item = rescheduleSvc.calculateManualRecord(
      cur_card,
      now,
      len ? collections[len - 1] : void 0,
      updateMemoryState
    );
    return {
      collections: typeof recordLogHandler === "function" ? collections.map(recordLogHandler) : collections,
      reschedule_item: manual_item ? applyAfterHandler(manual_item, recordLogHandler) : null
    };
  }
};
var fsrs = (params) => {
  return new FSRS(params || {});
};

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
var FSRS_RATING_SCORE = {
  again: 25,
  hard: 50,
  good: 75,
  easy: 100
};
var MASTERY_CONFIDENCE_MIN = 3;
function isValidDesiredRetention(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0.7 && v <= 0.97;
}
function isValidMaxIntervalDays(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 30 && v <= 36500;
}
function isValidSavedCardsDailyLimit(v) {
  return Number.isInteger(v) && v >= 0 && v <= 500;
}
function parseLearningSteps(text) {
  const raw = (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) return null;
  const out = [];
  for (const step of raw) {
    const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(step);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (m[2] === "d" && n > 36500) return null;
    out.push(step);
  }
  return out;
}
function schedulerConfigFingerprint(cfg) {
  const s = "ret:" + cfg.desiredRetention + "|max:" + cfg.maxIntervalDays + "|ls:" + cfg.learningSteps + "|rs:" + cfg.relearningSteps;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function toGrade(rating) {
  switch (rating) {
    case "again":
      return Rating.Again;
    case "hard":
      return Rating.Hard;
    case "good":
      return Rating.Good;
    case "easy":
      return Rating.Easy;
  }
}
var DAY_MS = 864e5;
function num(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function toTsCard(fs5) {
  const lastReview = typeof fs5.lastReview === "number" ? new Date(fs5.lastReview) : void 0;
  const dueMs = num(fs5.due, Date.now());
  const elapsedDays = lastReview ? Math.max(0, Math.round((dueMs - lastReview.getTime()) / DAY_MS)) : 0;
  return {
    due: new Date(dueMs),
    stability: Math.max(1e-3, num(fs5.stability, 0)),
    difficulty: Math.min(10, Math.max(1, num(fs5.difficulty, 5))),
    elapsed_days: elapsedDays,
    scheduled_days: Math.max(0, Math.floor((dueMs - (lastReview?.getTime() ?? dueMs)) / DAY_MS)),
    learning_steps: Math.max(0, Math.floor(num(fs5.learningSteps, 0))),
    reps: Math.max(0, Math.floor(num(fs5.reps, 0))),
    lapses: Math.max(0, Math.floor(num(fs5.lapses, 0))),
    state: fs5.state === State.Learning || fs5.state === State.Review || fs5.state === State.Relearning ? fs5.state : State.New,
    last_review: lastReview
  };
}
function fromTsCard(card) {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learningSteps: card.learning_steps || 0,
    lastReview: card.last_review ? card.last_review.getTime() : void 0
  };
}
function toFSRSParameters(p) {
  return generatorParameters({
    request_retention: p.request_retention,
    maximum_interval: p.maximum_interval,
    learning_steps: p.learning_steps,
    relearning_steps: p.relearning_steps
    // enable_short_term 默认 true：学习/重学步骤生效（Anki 语义）
  });
}
var FsrsScheduler = class {
  constructor(params) {
    this.params = params;
    this.engine = fsrs(toFSRSParameters(params));
  }
  /** 新卡首次复习前的空状态（ts-fsrs createEmptyCard） */
  emptyCardState(now) {
    const card = createEmptyCard(new Date(now));
    return fromTsCard(card);
  }
  /**
   * §四十八：真实调用 FSRS scheduler.next()，保存状态由调用方负责。
   * card 为 null → 首次评分（createEmptyCard 起步，§十三）。
   */
  schedule(rating, card, now) {
    const base = card ? toTsCard(card) : createEmptyCard(new Date(now));
    const reviewTime = new Date(now);
    const preRetr = card && typeof card.lastReview === "number" ? this.retrievability(card, now) ?? 1 : 1;
    const item = this.engine.next(base, reviewTime, toGrade(rating));
    const next = fromTsCard(item.card);
    const prevDue = card ? card.due : null;
    const reviewMs = reviewTime.getTime();
    const dueMs = next.due;
    const lastReviewMs = next.lastReview ?? reviewMs;
    const intervalDays = dueMs >= lastReviewMs ? Number(((dueMs - lastReviewMs) / DAY_MS).toFixed(3)) : 0;
    const log = {
      timestamp: reviewMs,
      rating,
      previousDue: prevDue,
      nextDue: dueMs,
      intervalDays,
      stability: next.stability,
      difficulty: next.difficulty,
      retrievability: Math.max(0, Math.min(1, preRetr))
    };
    return { next, log };
  }
  /**
   * §四十九：真实预览四种评分的下次时间（绝不写死；不落盘，仅 UI 标签）。
   * 用同一当前卡分别模拟四档 → 返回各自 due/intervalDays。
   */
  previewAll(card, now) {
    const base = card ? toTsCard(card) : createEmptyCard(new Date(now));
    const reviewTime = new Date(now);
    const all = this.engine.repeat(base, reviewTime);
    const out = {};
    for (const rating of FSRS_RATINGS) {
      const item = all[toGrade(rating)];
      const dueMs = item.card.due.getTime();
      const lastReviewMs = item.card.last_review ? item.card.last_review.getTime() : reviewTime.getTime();
      const intervalDays = dueMs >= lastReviewMs ? Number(((dueMs - lastReviewMs) / DAY_MS).toFixed(3)) : 0;
      out[rating] = { due: dueMs, intervalDays };
    }
    return out;
  }
  /** 当前保持率（FSRS retrievability 0~1，format=false 取数值）。无历史/新卡 → null */
  retrievability(card, now) {
    if (!card) return null;
    if (card.state === State.New || typeof card.lastReview !== "number") return null;
    const base = toTsCard(card);
    const v = this.engine.get_retrievability(base, new Date(now), false);
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  }
};
function schedulerFromConfig(cfg) {
  const ls = parseLearningSteps(cfg.learningSteps) ?? ["10m", "1h"];
  const rs = parseLearningSteps(cfg.relearningSteps) ?? ["10m"];
  const retention = isValidDesiredRetention(cfg.desiredRetention) ? cfg.desiredRetention : 0.9;
  const maxIvl = isValidMaxIntervalDays(cfg.maxIntervalDays) ? cfg.maxIntervalDays : 3650;
  return new FsrsScheduler({
    request_retention: retention,
    maximum_interval: maxIvl,
    learning_steps: ls,
    relearning_steps: rs
  });
}
function nextMasteryPercent(prev, prevCount, rating) {
  const score = FSRS_RATING_SCORE[rating];
  const n = Math.max(0, prevCount);
  if (n === 0 || typeof prev !== "number" || !Number.isFinite(prev)) return score;
  const merged = (prev * n + score * 2) / (n + 2);
  return Math.round(Math.max(0, Math.min(100, merged)));
}
function masteryConfidence(reviewCount) {
  return reviewCount < MASTERY_CONFIDENCE_MIN ? { low: true, hint: "\u6570\u636E\u8F83\u5C11" } : { low: false, hint: "" };
}
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
function savedCardInFolder(sourcePath, folderPath) {
  const fp = (folderPath || "").replace(/\/+$/, "");
  if (!fp) return true;
  if (sourcePath === fp || sourcePath === fp + ".md") return true;
  return sourcePath.startsWith(fp + "/");
}
function filterSavedCardObjects(cards, scope) {
  if (!scope || scope.mode === "vault") return cards;
  const match = (c) => {
    switch (scope.mode) {
      case "current-note":
        return !!scope.notePath && c.sourcePath === scope.notePath;
      case "folder":
        return !!scope.folderPath && savedCardInFolder(c.sourcePath, scope.folderPath);
      case "area":
        return !!scope.folderPath && savedCardInFolder(c.sourcePath, scope.folderPath);
      case "exam":
        return !!scope.examId && c.examId === scope.examId;
      case "custom": {
        if (scope.folders && scope.folders.length) {
          if (!scope.folders.some((f) => savedCardInFolder(c.sourcePath, f))) return false;
        }
        return true;
      }
      default:
        return true;
    }
  };
  return cards.filter(match);
}
function savedCardScopeFingerprint(scope) {
  const o = { mode: scope?.mode ?? "vault" };
  if (scope?.notePath) o["notePath"] = scope.notePath;
  if (scope?.folderPath) o["folderPath"] = scope.folderPath;
  if (scope?.areaId) o["areaId"] = scope.areaId;
  if (scope?.examId) o["examId"] = scope.examId;
  if (scope?.folders && scope.folders.length) o["folders"] = [...scope.folders].sort();
  const s = JSON.stringify(o);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function defaultSavedCardScope() {
  return { mode: "vault" };
}
function savedCardScopeText(scope, examTitle) {
  if (!scope || scope.mode === "vault") return "\u6574\u4E2A Vault";
  switch (scope.mode) {
    case "current-note":
      return scope.notePath ? scope.notePath.replace(/\.md$/i, "") : "\u5F53\u524D\u7B14\u8BB0";
    case "folder":
      return scope.folderPath || "\uFF08\u672A\u9009\u6587\u4EF6\u5939\uFF09";
    case "area":
      return scope.areaId || "\uFF08\u672A\u9009\u533A\u57DF\uFF09";
    case "exam":
      return examTitle || scope.examId || "\uFF08\u672A\u9009\u8003\u8BD5\uFF09";
    case "custom": {
      const folders = (scope.folders ?? []).slice(0, 2);
      const more = (scope.folders ?? []).length > 2 ? " \u7B49 " + (scope.folders?.length ?? 0) + " \u4E2A" : "";
      return (folders.length ? folders.join("\u3001") : "\uFF08\u672A\u9009\u6587\u4EF6\u5939\uFF09") + more;
    }
  }
}
function savedDayKey(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return "daily:" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function buildSavedCardReviewQueue(cards, states, scheduler, now, dailySavedCardsLimit, scope) {
  const scoped = filterSavedCardObjects(cards, scope);
  const stateById = new Map(states.map((s) => [s.cardId, s]));
  const limit = Math.max(0, Math.floor(dailySavedCardsLimit));
  if (limit <= 0) return { periodKey: savedDayKey(now), items: [], completedCount: 0, skippedCount: 0 };
  const due = scoped.map((c) => ({ c, st: stateById.get(c.id) })).filter((x) => !!x.st && x.st.fsrsState.due <= now).map((x) => ({ id: x.c.id, state: x.st, retr: scheduler.retrievability(x.st.fsrsState, now) ?? 1 })).sort((a, b) => a.retr - b.retr || a.state.fsrsState.due - b.state.fsrsState.due).map((x) => ({ id: x.id, state: x.state }));
  const fresh = scoped.filter((c) => !stateById.has(c.id)).sort((a, b) => a.createdAt - b.createdAt).map((c) => ({ id: c.id, state: null }));
  const selected = [...due, ...fresh].slice(0, limit);
  return {
    periodKey: savedDayKey(now),
    items: selected.map((x) => ({
      cardId: x.id,
      state: x.state,
      due: x.state ? x.state.fsrsState.due : void 0,
      retrievability: x.state ? scheduler.retrievability(x.state.fsrsState, now) ?? void 0 : void 0
    })),
    completedCount: 0,
    skippedCount: 0
  };
}
function savedMasteryDistribution(states) {
  const dist = emptyDistribution();
  for (const s of states) if (typeof s.masteryPercent === "number") dist[reviewBandOf(s.masteryPercent)]++;
  return dist;
}
function savedCardOverview(states, logs, scheduler, now) {
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
    total: states.length,
    due,
    forgetting,
    stable,
    reviewsToday: logs.filter((l) => l.timestamp >= startOfDay).length,
    avgRetrievability: retr.length ? retr.reduce((a, b) => a + b, 0) / retr.length : null,
    avgMastery: mastery.length ? mastery.reduce((a, b) => a + b, 0) / mastery.length : null,
    dist: savedMasteryDistribution(states)
  };
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
function escYaml(s) {
  return '"' + (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function unescYaml(s) {
  const m = /^"(.*)"$/.exec(s);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : s;
}
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
function cardMarkdown(c) {
  const dateStr = new Date(c.createdAt).toISOString().slice(0, 10);
  const wiki = (p) => "[[" + (p.split("/").pop() ?? p).replace(/\.md$/i, "") + "]]";
  return [
    "---",
    "type: review-card",
    'cardId: "' + c.id + '"',
    'sourcePath: "' + c.sourcePath + '"',
    'sourceVersion: "' + c.sourceVersion + '"',
    ...c.examId ? ['examId: "' + c.examId + '"'] : [],
    ...c.examQuestionId ? ['examQuestionId: "' + c.examQuestionId + '"'] : [],
    'questionType: "' + c.questionType + '"',
    ...c.options && c.options.length ? ["options: [" + c.options.map(escYaml).join(", ") + "]"] : [],
    ...c.correctAnswer ? ["correctAnswer: " + escYaml(c.correctAnswer)] : [],
    ...c.concept ? ['concept: "' + c.concept + '"'] : [],
    ...c.tags && c.tags.length ? ["tags: [" + c.tags.map(escYaml).join(", ") + "]"] : [],
    "createdAt: " + c.createdAt,
    "---",
    "",
    "# " + c.question,
    "",
    "## \u7B54\u6848",
    "",
    c.answer,
    "",
    ...c.explanation ? ["## \u89E3\u91CA", "", c.explanation, ""] : [],
    ...c.sourceEvidence && c.sourceEvidence.length ? ["## \u539F\u6587\u4F9D\u636E", "", ...c.sourceEvidence.map((s) => "- " + s), ""] : [],
    "",
    "## \u6765\u6E90",
    "",
    wiki(c.sourcePath),
    "",
    "<!-- " + dateStr + " -->"
  ].join("\n");
}
function parseCardMarkdown(md) {
  if (!md.startsWith("---")) return { card: null };
  const end = md.indexOf("\n---", 3);
  if (end < 0) return { card: null };
  const block = md.slice(3, end);
  const kv = /* @__PURE__ */ new Map();
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
  const inlineArr = (v) => {
    if (!v) return void 0;
    if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map((s) => unescYaml(s.trim())).filter(Boolean);
    return void 0;
  };
  const id = unescYaml(kv.get("cardId") ?? "");
  if (!id) return { card: null };
  const qtypeRaw = unescYaml(kv.get("questionType") ?? "");
  const hashIdx = md.indexOf("# ", end);
  const q = hashIdx >= 0 ? md.slice(hashIdx + 2, md.indexOf("\n", hashIdx)).trim() || id : id;
  const ansM = /^## 答案[\s\S]*?\n\n([\s\S]*?)\n\n## /m.exec(md.slice(end));
  const expM = /^## 解释[\s\S]*?\n\n([\s\S]*?)\n\n## /m.exec(md.slice(end));
  const card = {
    id,
    sourcePath: unescYaml(kv.get("sourcePath") ?? ""),
    sourceVersion: unescYaml(kv.get("sourceVersion") ?? ""),
    examId: unescYaml(kv.get("examId") ?? ""),
    examQuestionId: unescYaml(kv.get("examQuestionId") ?? ""),
    question: q,
    answer: ansM ? ansM[1].trim() : "",
    explanation: expM ? expM[1].trim() : void 0,
    questionType: ["recall", "explanation", "comparison", "application", "true_false", "multiple_choice", "counterexample"].includes(qtypeRaw) ? qtypeRaw : "recall",
    options: inlineArr(kv.get("options")),
    correctAnswer: unescYaml(kv.get("correctAnswer") ?? ""),
    concept: unescYaml(kv.get("concept") ?? ""),
    tags: inlineArr(kv.get("tags")),
    createdAt: parseInt(kv.get("createdAt") ?? "", 10) || Date.now(),
    updatedAt: Date.now()
  };
  return { card };
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

// src/examEngine.ts
function examProgress(exam, answers) {
  return {
    total: exam.questions.length,
    answered: answers.filter((a) => typeof a.answer === "string" && a.answer.trim() && !a.skipped).length,
    skipped: answers.filter((a) => a.skipped).length,
    rated: answers.filter((a) => a.selfRating).length,
    graded: answers.filter((a) => typeof a.aiScore === "number").length
  };
}
function examSessionFinished(state, total) {
  if (state.status === "completed") return true;
  if (!state.answers.length) return false;
  const handled = state.answers.filter((a) => a.skipped || typeof a.selfRating !== "undefined" || typeof a.answer === "string" || typeof a.aiScore === "number").length;
  return handled >= total;
}

// tests/p21-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
function tmpRoot(tag) {
  return fs4.mkdtempSync(path3.join(os.tmpdir(), "kg-p21-" + tag + "-"));
}
function eqSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
var DAY = 864e5;
var NOW = new Date(2026, 1, 10, 12, 0, 0).getTime();
var CFG = { desiredRetention: 0.9, maxIntervalDays: 3650, learningSteps: "10m,1h", relearningSteps: "10m" };
function sched() {
  return schedulerFromConfig(CFG);
}
function savedState(cardId, due, stability, mastery = 75) {
  return {
    cardId,
    fsrsState: { due, stability, difficulty: 5, reps: 3, lapses: 0, state: 2, learningSteps: 0, lastReview: NOW - 40 * DAY },
    lastRating: "good",
    reviewCount: 3,
    lastReviewedAt: NOW - 40 * DAY,
    masteryPercent: mastery,
    createdAt: NOW - 80 * DAY,
    updatedAt: NOW - 40 * DAY
  };
}
function sampleCards() {
  const base = { answer: "\u7B54\u6848", questionType: "recall", sourceVersion: "v1", createdAt: NOW, updatedAt: NOW };
  return [
    { ...base, id: "cardA", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", examId: "exam1", examQuestionId: "q1", question: "A \u9898" },
    { ...base, id: "cardB", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u7CFB\u7EDF\u8FB9\u754C.md", examId: "exam2", examQuestionId: "q1", question: "B \u9898" },
    { ...base, id: "cardC", sourcePath: "02 \u8D44\u6599/\u8C03\u7814.md", examId: "exam1", examQuestionId: "q2", question: "C \u9898" },
    { ...base, id: "cardD", sourcePath: "\u6839\u7B14\u8BB0.md", question: "D \u9898" }
  ];
}
{
  const dir = tmpRoot("scindep");
  const store = new SpacedReviewStore(dir);
  store.load();
  const s = sched();
  const ra = s.schedule("good", null, NOW);
  const rb = s.schedule("again", null, NOW);
  store.scCommitReview("cardA", savedState("cardA", NOW + 2 * DAY, 10), { timestamp: NOW, rating: "good", previousDue: null, nextDue: ra.next.due, intervalDays: 0.04, stability: ra.next.stability, difficulty: ra.next.difficulty, retrievability: 1 });
  store.scCommitReview("cardB", savedState("cardB", NOW + 5 * DAY, 8), { timestamp: NOW, rating: "again", previousDue: null, nextDue: rb.next.due, intervalDays: 0.01, stability: rb.next.stability, difficulty: rb.next.difficulty, retrievability: 1 });
  const a = store.scGet("cardA");
  const b = store.scGet("cardB");
  test(
    "P21-01",
    !!a && !!b && a.fsrsState.due !== b.fsrsState.due && a.cardId !== b.cardId,
    "\u540C\u4E00 sourcePath \u7684 A/B \u4E24\u5361 FSRS \u72B6\u6001\u5F7C\u6B64\u72EC\u7ACB\uFF08\u4E3B\u952E savedCard:cardId\uFF0C\xA796\uFF09"
  );
  test(
    "P21-02",
    a.fsrsState.due !== b.fsrsState.due,
    "A Good / B Again \u2192 due \u4E0D\u540C\uFF08\u771F\u5B9E FSRS\uFF09"
  );
  const beforeB = b.reviewCount;
  const ra2 = s.schedule("good", a.fsrsState, NOW + DAY);
  const a2 = {
    cardId: "cardA",
    fsrsState: ra2.next,
    lastRating: "good",
    reviewCount: a.reviewCount + 1,
    lastReviewedAt: NOW + DAY,
    masteryPercent: nextMasteryPercent(a.masteryPercent, a.reviewCount, "good"),
    createdAt: a.createdAt,
    updatedAt: NOW + DAY
  };
  store.scCommitReview("cardA", a2, { timestamp: NOW + DAY, rating: "good", previousDue: a2.fsrsState.due, nextDue: a2.fsrsState.due, intervalDays: 1, stability: ra2.next.stability, difficulty: ra2.next.difficulty, retrievability: 0.9 });
  test(
    "P21-03",
    store.scGet("cardA")?.reviewCount === 4 && store.scGet("cardB")?.reviewCount === beforeB,
    "A \u590D\u4E60\u8BA1\u6570\u4E0D\u5F71\u54CD B"
  );
  store.scRemoveCard("cardA");
  test(
    "P21-04",
    store.scGet("cardA") === void 0 && store.scGet("cardB") !== void 0,
    "\u5220\u9664 A\uFF1AA \u7684 FSRS \u72B6\u6001\u4E0E\u65E5\u5FD7\u88AB\u6E05\uFF0CB \u4FDD\u6301\u4E0D\u53D8\uFF08\xA739/96\uFF09"
  );
  const reload = new SpacedReviewStore(dir);
  reload.load();
  test(
    "P21-04b",
    reload.scGet("cardB") !== void 0 && reload.scGet("cardA") === void 0 && reload.scCount() === 1,
    "\u5220\u9664\u6301\u4E45\u5316\uFF1A\u91CD\u542F\u540E A \u4E0D\u590D\u6D3B\u3001B \u4ECD\u5728"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpRoot("sep");
  const store = new SpacedReviewStore(dir);
  store.load();
  const s = sched();
  const noteRes = s.schedule("good", null, NOW);
  store.commitReview("01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", { path: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", fsrsState: noteRes.next, reviewCount: 1, lastRating: "good", lastReviewedAt: NOW, createdAt: NOW, updatedAt: NOW }, { timestamp: NOW, rating: "good", previousDue: null, nextDue: noteRes.next.due, intervalDays: 1, stability: 2, difficulty: 5, retrievability: 1 });
  const scRes = s.schedule("easy", null, NOW);
  store.scCommitReview("cardX", savedState("cardX", NOW + 9 * DAY, 10), { timestamp: NOW, rating: "easy", previousDue: null, nextDue: scRes.next.due, intervalDays: 8, stability: 9, difficulty: 3, retrievability: 1 });
  test(
    "P21-41",
    store.count() === 1 && store.scCount() === 1 && store.get("01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md")?.fsrsState.due !== store.scGet("cardX")?.fsrsState.due,
    "\u7B14\u8BB0\u590D\u4E60\u4E0E\u590D\u4E60\u5361\u590D\u4E60\u72B6\u6001\u72EC\u7ACB\uFF08\xA741/138\uFF09"
  );
  store.prune(/* @__PURE__ */ new Set());
  test("P21-41b", store.count() === 0 && store.scCount() === 1, "Source \u5220\u9664\u4E0D\u5220 Saved Card FSRS\uFF08\xA7141/142\uFF09");
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const cards = sampleCards();
  const pathsOf = (s) => filterSavedCardObjects(cards, s).map((c) => c.id);
  test("P21-05", pathsOf(defaultSavedCardScope()).length === 4, "vault \u2192 \u5168\u90E8");
  test(
    "P21-06",
    eqSet(pathsOf({ mode: "current-note", notePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }), ["cardA"]),
    "current note \u2192 \u53EA\u663E\u793A sourcePath===\u5F53\u524D\u7B14\u8BB0\uFF08\xA718\uFF09"
  );
  test(
    "P21-07",
    eqSet(pathsOf({ mode: "folder", folderPath: "01 \u76D2\u5B50/\u6E38\u620F" }), ["cardA", "cardB"]),
    "folder \u2192 sourcePath \u524D\u7F00\u8FC7\u6EE4\uFF08\xA720\uFF09"
  );
  test(
    "P21-08",
    eqSet(pathsOf({ mode: "area", areaId: "a1", folderPath: "01 \u76D2\u5B50" }), ["cardA", "cardB"]),
    "area \u2192 KnowledgeArea.folder \u524D\u7F00\uFF08\xA721\uFF09"
  );
  test(
    "P21-09",
    eqSet(pathsOf({ mode: "exam", examId: "exam1" }), ["cardA", "cardC"]),
    "exam \u2192 \u53EA\u663E\u793A examId \u5339\u914D\u7684\u5361\uFF08\xA719\uFF09"
  );
  test(
    "P21-10",
    eqSet(pathsOf({ mode: "custom", folders: ["01 \u76D2\u5B50/\u6E38\u620F", "02 \u8D44\u6599"] }), ["cardA", "cardB", "cardC"]),
    "custom \u2192 \u591A\u6587\u4EF6\u5939\u6765\u6E90\uFF08\xA722\uFF09"
  );
  const f1 = savedCardScopeFingerprint({ mode: "exam", examId: "exam1" });
  const f2 = savedCardScopeFingerprint({ mode: "exam", examId: "exam2" });
  test(
    "P21-10b",
    f1 !== f2 && savedCardScopeFingerprint({ mode: "exam", examId: "exam1" }) === f1,
    "saved scope \u6307\u7EB9\uFF1A\u4E0D\u540C examId \u4E0D\u540C key\uFF08\u72EC\u7ACB\u7F13\u5B58\u8BED\u4E49 \xA729\uFF09"
  );
  test(
    "P21-10c",
    savedCardScopeText({ mode: "exam", examId: "exam1" }, "\u6E38\u620F \xB7 \u6574\u4F53\u8003\u5BDF") === "\u6E38\u620F \xB7 \u6574\u4F53\u8003\u5BDF",
    "scope \u663E\u793A\u540D\uFF08View \u7528\uFF09"
  );
}
{
  test("P21-17", nextMasteryPercent(80, 5, "again") < 80, "Again \u2192 \u638C\u63E1\u5EA6\u4E0B\u964D");
  test("P21-18", nextMasteryPercent(40, 5, "good") > 40, "Good \u2192 \u638C\u63E1\u5EA6\u4E0A\u5347");
  test("P21-19", masteryConfidence(2).low && masteryConfidence(5).low === false, "mastery confidence\uFF08\xA7101/57\uFF09");
}
{
  const dir = tmpRoot("retr");
  const store = new SpacedReviewStore(dir);
  store.load();
  const s = sched();
  store.scCommitReview("cardA", savedState("cardA", NOW + DAY, 3, 60), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 3, difficulty: 5, retrievability: 1 });
  const st = store.scGet("cardA");
  const r0 = s.retrievability(st.fsrsState, NOW);
  const r30 = s.retrievability(st.fsrsState, NOW + 30 * DAY);
  test("P21-20", r0 > r30, "\u4FDD\u6301\u7387\u968F\u65F6\u95F4\u4E0B\u964D\uFF08" + r0.toFixed(3) + " > " + r30.toFixed(3) + "\uFF09");
  const cards = sampleCards();
  const states = [savedState("cardA", NOW - DAY, 2, 50), savedState("cardB", NOW - DAY, 10, 70), savedState("cardC", NOW - DAY, 60, 90)];
  const q = buildSavedCardReviewQueue(cards, states, s, NOW, 3);
  test(
    "P21-21",
    q.items.length === 3 && q.items[0].cardId === "cardA" && q.items[2].cardId === "cardC",
    "\u6700\u53EF\u80FD\u5FD8\u8BB0\uFF08\u4FDD\u6301\u7387\u6700\u4F4E\uFF09\u4F18\u5148\uFF08" + q.items.map((i) => i.cardId).join(",") + "\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const mc = {
    id: "mc1",
    sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    sourceVersion: "v1",
    examId: "e1",
    examQuestionId: "q9",
    question: "\u6A21\u5757\u8FB9\u754C\u7684\u4F5C\u7528\uFF1F",
    answer: "\u53C2\u8003\u7B54\u6848\uFF1A\u9694\u79BB\u53D8\u5316\u3002",
    questionType: "multiple_choice",
    options: ["\u9694\u79BB\u53D8\u5316", "\u589E\u52A0\u8026\u5408", "\u51CF\u5C11\u6587\u4EF6\u6570", "\u9690\u85CF\u6D4B\u8BD5"],
    correctAnswer: "A",
    createdAt: NOW,
    updatedAt: NOW
  };
  const md = cardMarkdown(mc);
  const parsed = parseCardMarkdown(md);
  test("P21-22", parsed.card?.questionType === "multiple_choice", "MC \u5361\u7C7B\u578B\u5E8F\u5217\u5316\u5F80\u8FD4\u4FDD\u6301 multiple_choice\uFF08\xA737\uFF09");
  test(
    "P21-23",
    parsed.card?.options?.length === 4 && parsed.card.options.join("|") === "\u9694\u79BB\u53D8\u5316|\u589E\u52A0\u8026\u5408|\u51CF\u5C11\u6587\u4EF6\u6570|\u9690\u85CF\u6D4B\u8BD5",
    "MC \u4FDD\u5B58 4 \u4E2A options\uFF08\xA733/37\uFF09"
  );
  test(
    "P21-24",
    parsed.card?.correctAnswer === "A" && parsed.card.examQuestionId === "q9" && parsed.card.examId === "e1",
    "correctAnswer / examQuestionId / examId \u53EF\u6062\u590D\uFF08Markdown \u4E3A\u771F\u76F8\u6E90\uFF0C\xA7117\uFF09"
  );
  const legacy = parseCardMarkdown(cardMarkdown({ ...mc, options: void 0, correctAnswer: void 0, examQuestionId: void 0 }));
  test(
    "P21-24b",
    legacy.card !== null && legacy.card.options === void 0 && legacy.card.questionType === "multiple_choice",
    "\u65E7\u5361\uFF08\u65E0 options/correctAnswer/examQuestionId\uFF09\u6B63\u5E38\u89E3\u6790\uFF0C\u4E0D\u7834\u574F\uFF08\xA733/38\uFF09"
  );
}
{
  const dir = tmpRoot("hub");
  const examStore = new ExamStore(dir);
  examStore.load();
  const examA = { id: "e1", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u6E38\u620F\u6846\u67B6 \xB7 \u6574\u4F53\u8003\u5BDF", mode: "holistic", questionCount: 10, answerMode: "source_preferred", questions: [], examVersion: 1, createdAt: NOW - DAY, updatedAt: NOW - DAY };
  const examB = { id: "e2", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u6E38\u620F\u6846\u67B6 \xB7 \u4E3B\u9898\u5377", mode: "custom", topic: "\u6A21\u5757\u8FB9\u754C", questionCount: 5, answerMode: "source_preferred", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  const examOther = { id: "e3", sourcePath: "02 \u8D44\u6599/\u8C03\u7814.md", sourceVersion: "v1", title: "\u8C03\u7814", mode: "holistic", questionCount: 2, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY };
  examStore.add(examA);
  examStore.add(examB);
  examStore.add(examOther);
  const list = examStore.findBySource("01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md");
  test("P21-25", list.length === 2, "findBySource \u8FD4\u56DE\u8BE5\u7B14\u8BB0\u5168\u90E8\u8003\u8BD5\uFF08\xA743/81\uFF09");
  test("P21-26", examStore.findBySource("\u4E0D\u5B58\u5728.md").length === 0, "\u96F6\u8003\u8BD5 \u2192 \u7A7A\u5217\u8868\uFF08\u7A7A\u72B6\u6001 \xA7129/26\uFF09");
  test("P21-27", list[0].id === "e2" && list[1].id === "e1", "createdAt DESC\uFF08\u6700\u65B0\u5728\u524D\uFF0C\xA744/27\uFF09");
  const sessStore = new ExamSessionStore(dir);
  sessStore.load();
  const qs = Array.from({ length: 10 }, (_, i) => ({ id: "q" + i }));
  const exam10 = { ...examA, id: "e10", questionCount: 10, questions: qs };
  examStore.add(exam10);
  const sess = { examId: "e10", mode: "card", currentIndex: 7, status: "running", startedAt: NOW, updatedAt: NOW, answers: Array.from({ length: 7 }, (_, i) => ({ questionId: "q" + i, answer: "a", selfRating: "good", answeredAt: NOW })) };
  sessStore.upsert(sess);
  const p = examProgress(exam10, sess.answers);
  test(
    "P21-28",
    p.total === 10 && p.answered === 7 && examSessionFinished(sess, 10) === false,
    "Exam Hub \u8FDB\u5EA6 7/10 \u7531 ExamSessionStore \u89E3\u6790\uFF08\xA745/28\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpRoot("link");
  const cardStore = new ReviewCardStore(dir);
  cardStore.load();
  const card = {
    id: "cardQ1",
    sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md",
    sourceVersion: "v1",
    examId: "exam1",
    examQuestionId: "q1",
    question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F",
    answer: "\u9694\u79BB\u53D8\u5316\u2026",
    questionType: "recall",
    createdAt: NOW,
    updatedAt: NOW
  };
  cardStore.add(card);
  test("P21-34", cardStore.findByExamQuestion("exam1", "q1")?.id === "cardQ1", "\u8003\u8BD5\u9898 \u2192 \u6536\u85CF\u5361\uFF08\u6309 examId+questionId \u53EF\u67E5\uFF0C\xA734\uFF09");
  const dup = cardStore.findByExamQuestion("exam1", "q1");
  test(
    "P21-35",
    !!dup && cardStore.findByExamQuestion("exam1", "q2") === void 0,
    "\u540C examId+questionId \u53BB\u91CD\uFF08\u4E0D\u751F\u6210\u7B2C\u4E8C\u5F20\uFF0C\xA754/35\uFF09"
  );
  const examStore = new ExamStore(dir);
  examStore.load();
  examStore.add({ id: "exam1", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u6E38\u620F\u6846\u67B6", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [{ id: "q1", type: "recall", question: "\u4E3A\u4EC0\u4E48\u9700\u8981\u6A21\u5757\u8FB9\u754C\uFF1F", referenceAnswer: "\u9694\u79BB\u53D8\u5316\u2026", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md" }], examVersion: 1, createdAt: NOW, updatedAt: NOW });
  examStore.remove("exam1");
  test(
    "P21-36",
    cardStore.get("cardQ1") !== void 0 && examStore.get("exam1") === void 0,
    "\u5220\u9664\u8003\u8BD5\u4E0D\u5220\u9664\u5361\uFF08examId \u4FDD\u7559\u5386\u53F2\uFF0CUI \u663E\u793A\u201C\u539F\u8003\u8BD5\u5DF2\u5220\u9664\u201D\xA740/36\uFF09"
  );
  const keepExam = { id: "exam9", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u6E38\u620F\u6846\u67B6.md", sourceVersion: "v1", title: "\u4FDD\u7559\u8003\u8BD5", mode: "holistic", questionCount: 1, answerMode: "source_only", questions: [], examVersion: 1, createdAt: NOW, updatedAt: NOW };
  examStore.add(keepExam);
  const linked = cardStore.get("cardQ1");
  const titleOf = linked?.examId ? examStore.get(linked.examId)?.title : void 0;
  test(
    "P21-37",
    linked?.examId === "exam1" && titleOf === void 0 && cardStore.get("cardQ1") !== void 0,
    "\u5361\u53EF\u67E5\u6765\u6E90\u8003\u8BD5\uFF1BExam \u5DF2\u5220\u65F6 title \u4F18\u96C5\u4E3A undefined\uFF08UI \u663E\u793A\u539F\u8003\u8BD5\u5DF2\u5220\u9664\uFF0C\xA740/37\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const f1 = schedulerConfigFingerprint(CFG);
  const f2 = schedulerConfigFingerprint(CFG);
  const f3 = schedulerConfigFingerprint({ ...CFG, desiredRetention: 0.85 });
  test("P21-38", f1 === f2 && f1 !== f3, "\u540C\u4E00\u5168\u5C40 desiredRetention\uFF08\u590D\u4E60\u5361\u4E0E\u7B14\u8BB0\u590D\u4E60\u5171\u7528 \xA738/64/65\uFF09");
  const a = schedulerFromConfig(CFG);
  const b = schedulerFromConfig(CFG);
  const dA = a.schedule("good", null, NOW).next.due;
  const dB = b.schedule("good", null, NOW).next.due;
  test("P21-40", dA === dB, "\u540C\u4E00 FsrsScheduler\uFF08\u540C\u8BBE\u7F6E\u5B9E\u4F8B\u7ED3\u679C\u4E00\u81F4\uFF1B\u4FDD\u5B58\u5361/\u7B14\u8BB0\u5171\u7528\u5F15\u64CE \xA740/69\uFF09");
  test("P21-39", CFG.learningSteps === "10m,1h" && CFG.relearningSteps === "10m", "\u5171\u7528\u5B66\u4E60\u6B65\u9AA4\u8BBE\u7F6E\uFF08\xA739/66\uFF09");
}
{
  const dir = tmpRoot("src");
  const cardStore = new ReviewCardStore(dir);
  cardStore.load();
  const card = { id: "c1", sourcePath: "01 \u76D2\u5B50/\u6E38\u620F/\u65E7\u540D.md", sourceVersion: "v1", question: "\u9898", answer: "\u7B54", questionType: "recall", createdAt: NOW, updatedAt: NOW };
  cardStore.add(card);
  cardStore.migratePaths("01 \u76D2\u5B50/\u6E38\u620F/\u65E7\u540D.md", "01 \u76D2\u5B50/\u6E38\u620F/\u65B0\u540D.md");
  const migrated = cardStore.get("c1");
  test("P21-44", migrated?.sourcePath === "01 \u76D2\u5B50/\u6E38\u620F/\u65B0\u540D.md", "source rename \u8DDF\u968F\u5DF2\u6709 migratePaths\uFF08\xA785/44\uFF09");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  spaced.scCommitReview("c1", savedState("c1", NOW + DAY, 5, 70), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  spaced.migratePaths("01 \u76D2\u5B50/\u6E38\u620F/\u65E7\u540D.md", "01 \u76D2\u5B50/\u6E38\u620F/\u65B0\u540D.md");
  test(
    "P21-44b",
    spaced.scGet("c1")?.cardId === "c1" && spaced.scGet("c1").fsrsState.due === NOW + DAY,
    "FSRS \u4E3B\u952E cardId \u4E0D\u53D8\uFF08source rename \u53EA\u6539\u5361\u7247 sourcePath\uFF0C\xA785\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpRoot("cache");
  fs4.mkdirSync(path3.join(dir, "cache"), { recursive: true });
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  spaced.scCommitReview("c1", savedState("c1", NOW + DAY, 5, 70), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  const cardStore = new ReviewCardStore(dir);
  cardStore.load();
  cardStore.add({ id: "c1", sourcePath: "a.md", sourceVersion: "v1", question: "\u9898", answer: "\u7B54", questionType: "recall", createdAt: NOW, updatedAt: NOW });
  fs4.writeFileSync(path3.join(dir, "cache", "ai-cache.json"), JSON.stringify({ entries: [] }), "utf8");
  fs4.rmSync(path3.join(dir, "cache", "ai-cache.json"), { force: true });
  const spaced2 = new SpacedReviewStore(dir);
  spaced2.load();
  const cards2 = new ReviewCardStore(dir);
  cards2.load();
  test("P21-51", cards2.count() === 1 && cardStore.get("c1") !== void 0, "AI cache \u6E05\u9664\u4E0D\u5F71\u54CD Saved Cards\uFF08\xA751\uFF09");
  test(
    "P21-52",
    spaced2.scCount() === 1 && spaced2.scGet("c1").fsrsState.due === NOW + DAY,
    "AI cache \u6E05\u9664\u4E0D\u5F71\u54CD FSRS state\uFF08\xA752\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpRoot("mig");
  fs4.mkdirSync(path3.join(dir, "cache"), { recursive: true });
  fs4.writeFileSync(path3.join(dir, "cache", "cards.json"), JSON.stringify({ formatVersion: 1, entries: [{ id: "old1", sourcePath: "a.md", sourceVersion: "v1", question: "\u65E7\u5361", answer: "\u65E7\u7B54\u6848", questionType: "recall", createdAt: NOW, updatedAt: NOW }] }), "utf8");
  fs4.writeFileSync(path3.join(dir, "cache", "card-reviews.json"), JSON.stringify({ formatVersion: 1, records: [{ cardId: "old1", reviewedAt: NOW, rating: "good" }] }), "utf8");
  const cs = new ReviewCardStore(dir);
  test("P21-53", cs.load() === false && cs.count() === 1 && cs.get("old1")?.question === "\u65E7\u5361", "\u65E7 cards.json \u52A0\u8F7D\uFF08\xA753\uFF09");
  const cr = new CardReviewStore(dir);
  test("P21-54", cr.load() === false && cr.count() === 1 && cr.byCard("old1").length === 1, "\u65E7 card-reviews.json \u52A0\u8F7D\uFF08\xA754\uFF09");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  test("P21-55", spaced.scGet("old1") === void 0 && spaced.scCount() === 0, "\u65E7\u5361\u65E0 saved FSRS \u72B6\u6001\uFF08\u53EF lazy \u9996\u8BC4\uFF09");
  const s = sched();
  const first = s.schedule("good", null, NOW);
  test(
    "P21-55b",
    first.next.due > NOW && spaced.scGet("old1") === void 0,
    "\u9996\u6B21\u8BC4\u5206 createEmptyCard \u8BED\u4E49\u53EF\u7528\uFF08\u72B6\u6001\u521B\u5EFA\u7531 main.rateSavedCard \u8D1F\u8D23\uFF0C\xA738\uFF09"
  );
  fs4.writeFileSync(path3.join(dir, "cache", "spaced-review.json"), "{broken", "utf8");
  const corrupt = new SpacedReviewStore(dir);
  test(
    "P21-56",
    corrupt.load() === true && corrupt.scCount() === 0 && corrupt.count() === 0,
    "corrupt spaced-review.json \u9694\u79BB\u4E3A\u7A7A\uFF08\xA756/36\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmpRoot("fmt");
  const spaced = new SpacedReviewStore(dir);
  spaced.load();
  spaced.scCommitReview("c1", savedState("c1", NOW + DAY, 5, 70), { timestamp: NOW, rating: "good", previousDue: null, nextDue: NOW + DAY, intervalDays: 1, stability: 5, difficulty: 5, retrievability: 1 });
  const raw = JSON.parse(fs4.readFileSync(path3.join(dir, "cache", "spaced-review.json"), "utf8"));
  test(
    "P21-60a",
    raw.formatVersion === 2 && typeof raw.savedCards === "object" && Array.isArray(raw.savedCardReviewLogs),
    "\u540C\u6587\u4EF6 formatVersion=2\uFF1AsavedCards + savedCardReviewLogs\uFF08\xA76/123\uFF0C\u4E0D\u65B0\u5EFA\u7B2C\u4E8C\u6587\u4EF6\uFF09"
  );
  const log = raw.savedCardReviewLogs[0];
  const keys = ["cardId", "timestamp", "rating", "previousDue", "nextDue", "intervalDays", "stability", "difficulty", "retrievability"];
  test("P21-60b", keys.every((k) => k in log) && !("prompt" in log) && !("content" in log), "Saved Card Review Log \u5B57\u6BB5\u767D\u540D\u5355\uFF08\xA77\uFF09");
  fs4.writeFileSync(path3.join(dir, "cache", "spaced-review.json"), JSON.stringify({ formatVersion: 1, cards: {}, reviewLogs: [] }), "utf8");
  const v1 = new SpacedReviewStore(dir);
  v1.load();
  test("P21-60c", v1.scCount() === 0 && v1.count() === 0, "v1 \u6587\u4EF6\u5BB9\u9519\u52A0\u8F7D\uFF08savedCards \u7F3A\u5931 \u2192 \u7A7A\uFF0C\xA76/38\uFF09");
  const cards = sampleCards();
  const states = [savedState("cardA", NOW - DAY, 2), savedState("cardB", NOW + DAY, 10)];
  const q10 = buildSavedCardReviewQueue(cards, states, sched(), NOW, 10);
  const q2 = buildSavedCardReviewQueue(cards, states, sched(), NOW, 2);
  test(
    "P21-60d",
    q10.items.length === 3 && q2.items.length === 2 && q10.items[0].cardId === "cardA",
    "Saved Card \u961F\u5217\u72EC\u7ACB\u4E0A\u9650\uFF08\xA767/70\uFF1Adue \u4F18\u5148+\u65B0\u5361\u8865\u8DB3\uFF0C\u4E0A\u9650 2 \u622A\u65AD\uFF1BcardB \u672A\u5230\u671F\u4E0D\u5165\u961F\uFF09"
  );
  test(
    "P21-60e",
    isValidSavedCardsDailyLimit(0) && isValidSavedCardsDailyLimit(500) && !isValidSavedCardsDailyLimit(501) && !isValidSavedCardsDailyLimit(-1),
    "\u6BCF\u65E5\u590D\u4E60\u5361\u4E0A\u9650 0~500 \u6821\u9A8C"
  );
  const ov = savedCardOverview(states, [], sched(), NOW);
  test(
    "P21-60f",
    ov.total === 2 && ov.due === 1 && ov.stable === 0 && ov.avgRetrievability !== null && ov.avgMastery !== null,
    "Saved Card \u6982\u89C8\uFF08\u5230\u671F/\u4FDD\u6301\u7387/\u638C\u63E1\u5EA6\u805A\u5408\u53EF\u7528\uFF09"
  );
  fs4.rmSync(dir, { recursive: true, force: true });
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
