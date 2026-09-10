/**
 * Phase 21.x Hotfix 自动测试：考试生成 >15 题失败（max_tokens 截断 → JSON 非法）修复验证。
 * 覆盖：题数联动 token 预算（examGenerationMaxTokens）、finish_reason=length 截断识别（truncationError）、
 * service/provider 接线（结构断言）。
 */
import "./portable-bootstrap";
import * as fs from "node:fs";
import * as path from "node:path";
import { examGenerationMaxTokens } from "../src/prompts";
import { truncationError, AIError } from "../src/ai/provider";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

/* ============ 题数 → 输出 token 预算（联动修复） ============ */
{
  test("T-TOK-01", examGenerationMaxTokens(5) === 3000, "5 题：保底 3000");
  test("T-TOK-02", examGenerationMaxTokens(15) === 6000 && examGenerationMaxTokens(15) > 3000,
    "15 题：预算提升到 6000（原固定 3000 的临界区已解除）");
  test("T-TOK-03", examGenerationMaxTokens(16) === 6400 && examGenerationMaxTokens(16) > examGenerationMaxTokens(15),
    "16 题：随题数继续提升（6400 > 6000）——此前 16 题即截断的根因预算已消失");
  test("T-TOK-04", examGenerationMaxTokens(20) === 8000, "20 题：8000");
  test("T-TOK-05", examGenerationMaxTokens(30) === 8192 && examGenerationMaxTokens(50) === 8192,
    "30/50 题：封顶 8192（模型输出窗口兜底，不无限放大）");
  test("T-TOK-06", examGenerationMaxTokens(1) === 3000 && examGenerationMaxTokens(-5) === 3000,
    "边界：最少也保底 3000；非法/负数不崩");
  const seq = [5, 10, 15, 16, 20, 30].map((n) => examGenerationMaxTokens(n));
  test("T-TOK-07", seq.every((v, i, a) => i === 0 || a[i - 1] <= v), "预算随题数单调不减（无回落）");
  test("T-TOK-08", seq.every((v) => v >= 3000 && v <= 8192), "预算始终在 [3000, 8192]");
}

/* ============ finish_reason=length 截断识别（人性化错误） ============ */
{
  const trunc = truncationError("length");
  test("T-TOK-09", trunc !== null && trunc instanceof AIError && trunc.code === "TRUNCATED",
    "finish_reason=length → 抛 TRUNCATED（明确提示截断，而不是误报“JSON 非法”）");
  test("T-TOK-10", trunc !== null && /截断/.test(trunc.message), "TRUNCATED 文案含“截断”并提示减少题数");
  test("T-TOK-11", truncationError("stop") === null && truncationError(undefined) === null && truncationError("content_filter") === null && truncationError("") === null,
    "stop / undefined / content_filter / 空 → 不误判（只有 length 才算截断）");
}

/* ============ 接线结构断言（service/provider 已连上修复） ============ */
{
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const svc = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "ai", "service.ts"), "utf8"));
  const prov = stripComments(fs.readFileSync(path.join(__dirname, "..", "src", "ai", "provider.ts"), "utf8"));
  test("T-TOK-12", /chatOpts\(["']note_exam_generation["'],\s*examGenerationMaxTokens\(opts\.questionCount\)\)/.test(svc) || (svc.includes("examGenerationMaxTokens(opts.questionCount)") && !/chatOpts\(["']note_exam_generation["'],\s*3000\)/.test(svc)),
    "service.generateExam 已把固定 3000 改为随题数联动的 examGenerationMaxTokens");
  test("T-TOK-13", prov.includes("truncationError(") && prov.includes("finish_reason") && prov.includes('"length"'),
    "provider.chat 已接入 finish_reason=length 截断检测");
  test("T-TOK-14", svc.includes('"TRUNCATED"') && /code === "TRUNCATED"|includes\("截断"\)/.test(svc),
    "service.errorCode 已把截断映射为 TRUNCATED（错误缓存/诊断可见）");
}

/* ============ 汇总 ============ */
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
