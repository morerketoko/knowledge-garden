/**
 * Workbench Source Link 纯函数测试（R1~R12）：
 * - 第一层：linkifyAnswerText 将正文中的真实笔记名链接化为 [[路径]]（防边界误链 / 防嵌套）。
 * - 第二层：extractEvidenceSnippet 返回真实原文片段；existingVaultSources 过滤已删除的 vault source。
 * - 全部纯函数，0 AI 请求，无 Obsidian DOM 依赖。
 */
import { linkifyAnswerText, extractEvidenceSnippet, existingVaultSources } from "../src/workbenchLinks";
import type { AIAnswerSource } from "../src/types";

const results: { id: string; pass: boolean; detail: string }[] = [];
function test(id: string, pass: boolean, detail: string): void {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}

const vault = (p: string, title?: string): AIAnswerSource => ({ type: "vault", path: p, title: title ?? p });

// ---------- R1：完整路径（含 .md）→ [[去 .md 路径]] ----------
{
  const out = linkifyAnswerText("根据 Vault 候选清单，找到笔记：01 盒子/游戏文案与策划.md", [vault("01 盒子/游戏文案与策划.md")]);
  test("R1", out.includes("[[01 盒子/游戏文案与策划]]") && !out.includes("01 盒子/游戏文案与策划.md"), "完整路径替换为可点击 wikilink：" + out);
}

// ---------- R2：basename（不带路径）也能链接化 ----------
{
  const out = linkifyAnswerText("其中最直接的是 游戏文案与策划。", [vault("01 盒子/游戏文案与策划.md")]);
  test("R2", out.includes("[[01 盒子/游戏文案与策划]]") && !out.includes("游戏文案与策划。"), "正文中的笔记名自动变成链接：" + out);
}

// ---------- R3：边界防误链（「游戏」不匹配「游戏设计」内部） ----------
{
  const out = linkifyAnswerText("我写过一篇关于游戏设计的文章。", [vault("01 盒子/游戏.md")]);
  test("R3", !out.includes("[["), "短名不误链进入长词内部：" + out);
}

// ---------- R4：多个来源全部替换 ----------
{
  const out = linkifyAnswerText("相关笔记：游戏文案与策划、游戏框架。", [vault("01 盒子/游戏文案与策划.md"), vault("01 盒子/游戏框架.md")]);
  test("R4", out.includes("[[01 盒子/游戏文案与策划]]") && out.includes("[[01 盒子/游戏框架]]"), "多来源全部链接化");
}

// ---------- R5：不在 sources 中的名称不链接 ----------
{
  const out = linkifyAnswerText("另外还提到了 哲学沉思录。", [vault("01 盒子/游戏文案与策划.md")]);
  test("R5", !out.includes("[[哲学") && !out.includes("[["), "非来源名称保持原样：" + out);
}

// ---------- R6：web / inference 不参与正文链接化 ----------
{
  const srcs: AIAnswerSource[] = [{ type: "web", url: "https://example.com", title: "Example" }, { type: "inference", snippet: "推理内容" }, vault("01 盒子/游戏.md")];
  const out = linkifyAnswerText("见 Example 与 游戏。", srcs);
  test("R6", !out.includes("[[Example") && out.includes("[[01 盒子/游戏]]"), "仅 vault source 参与链接化：" + out);
}

// ---------- R7：不嵌套（[[...]] 内不再被 basename 二次替换） ----------
{
  const src = vault("01 盒子/游戏文案与策划.md");
  const out = linkifyAnswerText("路径：01 盒子/游戏文案与策划.md，名称：游戏文案与策划", [src]);
  test("R7", !out.includes("[[[[") && out.split("[[").length - 1 === 2 && !out.includes("·md]]"), "长优先且防嵌套，恰两个链接：" + out);
}

// ---------- R8：空文本 / 空来源安全 ----------
{
  test("R8", linkifyAnswerText("", [vault("01 盒子/游戏.md")]) === "" && linkifyAnswerText("正文", []) === "正文", "空输入安全");
}

// ---------- R9：重复 basename 只链接一次（不歧义） ----------
{
  const srcs = [vault("目录A/同名.md"), vault("目录B/同名.md")];
  const out = linkifyAnswerText("参见 同名。", srcs);
  test("R9", out.split("[[").length - 1 === 1, "重复 basename 仅生成一个链接：" + out);
}

// ---------- R10：证据片段 = 真实原文开头 ----------
{
  const body = "第一段原文内容。" + "补充文字".repeat(120);
  const snip = extractEvidenceSnippet(body);
  test("R10", snip.length <= 505 && snip.startsWith("第一段原文内容"), "证据片段取自真实原文开头（非 AI 生成）");
}

// ---------- R11：reason 关键词定位原文片段 ----------
{
  const body = "开场铺垫。" + "关".repeat(30) + "游戏机制设计是核心。" + "尾段补充".repeat(60);
  const snip = extractEvidenceSnippet(body, "因为提到了 游戏机制设计");
  test("R11", snip.includes("游戏机制设计"), "证据片段优先定位 reason 关键词附近原文：" + snip.slice(0, 60));
}

// ---------- R12：existingVaultSources 过滤已删除的 vault source ----------
{
  const srcs: AIAnswerSource[] = [vault("存在.md"), vault("已删除.md"), { type: "web", url: "https://x.com" }, { type: "inference", snippet: "推理" }];
  const kept = existingVaultSources(srcs, (p) => p === "存在.md");
  test("R12", kept.length === 3 && kept.some((s) => s.path === "存在.md") && !kept.some((s) => s.path === "已删除.md"), "已删除 vault 来源被过滤，web/inference 保留（count=" + kept.length + "）");
}

// ---------- 汇总 ----------
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);