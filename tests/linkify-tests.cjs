"use strict";

// src/workbenchLinks.ts
var BEFORE_BLOCK = /[A-Za-z0-9_-]/;
var AFTER_BLOCK = /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z0-9_-]/;
var CJKRUN = /[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g;
function linkifyAnswerText(text, sources) {
  const vault2 = (sources ?? []).filter((s) => s.type === "vault" && s.path);
  if (vault2.length === 0) return text || "";
  const cands = [];
  const seenBases = /* @__PURE__ */ new Set();
  for (const s of vault2) {
    const p = s.path;
    const stem = p.replace(/\.md$/i, "");
    const base = stem.split("/").pop() || stem;
    cands.push({ pattern: p, link: stem });
    cands.push({ pattern: stem, link: stem });
    if (!seenBases.has(base)) {
      seenBases.add(base);
      cands.push({ pattern: base, link: stem });
    }
  }
  cands.sort((a, b) => b.pattern.length - a.pattern.length);
  const P0 = "\uE000";
  const P1 = "\uE001";
  const slots = [];
  let out = text || "";
  let n = 0;
  for (const c of cands) {
    if (c.pattern.length < 1) continue;
    const token = P0 + n + P1;
    slots.push("[[" + c.link + "]]");
    out = replaceBoundary(out, c.pattern, token);
    n++;
  }
  return out.replace(new RegExp(P0 + "(\\d+)" + P1, "g"), (_m, d) => slots[Number(d)] ?? "");
}
function replaceBoundary(text, pattern, replacement) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(pattern, i);
    if (idx < 0) {
      out += text.slice(i);
      break;
    }
    const before = idx > 0 ? text[idx - 1] : "";
    const after = text[idx + pattern.length] ?? "";
    if (!BEFORE_BLOCK.test(before) && !AFTER_BLOCK.test(after)) {
      out += text.slice(i, idx) + replacement;
      i = idx + pattern.length;
    } else {
      out += text.slice(i, idx + 1);
      i = idx + 1;
    }
  }
  return out;
}
function extractEvidenceSnippet(content, reason, limit = 500) {
  const body = (content || "").trim();
  if (!body) return "";
  const keywords = (reason || "").match(CJKRUN) ?? [];
  if (keywords.length) {
    const ordered = [...new Set(keywords)].sort((a, b) => b.length - a.length);
    for (const k of ordered) {
      const at = body.indexOf(k);
      if (at >= 0) {
        const half = Math.floor(limit / 2);
        const start = Math.max(0, at - half);
        const slice = body.slice(start, start + limit);
        return (start > 0 ? "\u2026" : "") + slice + (start + limit < body.length ? "\u2026" : "");
      }
    }
  }
  return body.slice(0, limit) + (body.length > limit ? "\u2026" : "");
}
function existingVaultSources(sources, exists) {
  return (sources ?? []).filter(
    (s) => s.type !== "vault" || !!s.path && exists(s.path)
  );
}

// tests/linkify-tests.ts
var results = [];
function test(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log((pass ? "PASS" : "FAIL") + " " + id + " :: " + detail);
}
var vault = (p, title) => ({ type: "vault", path: p, title: title ?? p });
{
  const out = linkifyAnswerText("\u6839\u636E Vault \u5019\u9009\u6E05\u5355\uFF0C\u627E\u5230\u7B14\u8BB0\uFF1A01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md")]);
  test("R1", out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212]]") && !out.includes("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md"), "\u5B8C\u6574\u8DEF\u5F84\u66FF\u6362\u4E3A\u53EF\u70B9\u51FB wikilink\uFF1A" + out);
}
{
  const out = linkifyAnswerText("\u5176\u4E2D\u6700\u76F4\u63A5\u7684\u662F \u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md")]);
  test("R2", out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212]]") && !out.includes("\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212\u3002"), "\u6B63\u6587\u4E2D\u7684\u7B14\u8BB0\u540D\u81EA\u52A8\u53D8\u6210\u94FE\u63A5\uFF1A" + out);
}
{
  const out = linkifyAnswerText("\u6211\u5199\u8FC7\u4E00\u7BC7\u5173\u4E8E\u6E38\u620F\u8BBE\u8BA1\u7684\u6587\u7AE0\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F.md")]);
  test("R3", !out.includes("[["), "\u77ED\u540D\u4E0D\u8BEF\u94FE\u8FDB\u5165\u957F\u8BCD\u5185\u90E8\uFF1A" + out);
}
{
  const out = linkifyAnswerText("\u76F8\u5173\u7B14\u8BB0\uFF1A\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212\u3001\u6E38\u620F\u6846\u67B6\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md"), vault("01 \u76D2\u5B50/\u6E38\u620F\u6846\u67B6.md")]);
  test("R4", out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212]]") && out.includes("[[01 \u76D2\u5B50/\u6E38\u620F\u6846\u67B6]]"), "\u591A\u6765\u6E90\u5168\u90E8\u94FE\u63A5\u5316");
}
{
  const out = linkifyAnswerText("\u53E6\u5916\u8FD8\u63D0\u5230\u4E86 \u54F2\u5B66\u6C89\u601D\u5F55\u3002", [vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md")]);
  test("R5", !out.includes("[[\u54F2\u5B66") && !out.includes("[["), "\u975E\u6765\u6E90\u540D\u79F0\u4FDD\u6301\u539F\u6837\uFF1A" + out);
}
{
  const srcs = [{ type: "web", url: "https://example.com", title: "Example" }, { type: "inference", snippet: "\u63A8\u7406\u5185\u5BB9" }, vault("01 \u76D2\u5B50/\u6E38\u620F.md")];
  const out = linkifyAnswerText("\u89C1 Example \u4E0E \u6E38\u620F\u3002", srcs);
  test("R6", !out.includes("[[Example") && out.includes("[[01 \u76D2\u5B50/\u6E38\u620F]]"), "\u4EC5 vault source \u53C2\u4E0E\u94FE\u63A5\u5316\uFF1A" + out);
}
{
  const src = vault("01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md");
  const out = linkifyAnswerText("\u8DEF\u5F84\uFF1A01 \u76D2\u5B50/\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212.md\uFF0C\u540D\u79F0\uFF1A\u6E38\u620F\u6587\u6848\u4E0E\u7B56\u5212", [src]);
  test("R7", !out.includes("[[[[") && out.split("[[").length - 1 === 2 && !out.includes("\xB7md]]"), "\u957F\u4F18\u5148\u4E14\u9632\u5D4C\u5957\uFF0C\u6070\u4E24\u4E2A\u94FE\u63A5\uFF1A" + out);
}
{
  test("R8", linkifyAnswerText("", [vault("01 \u76D2\u5B50/\u6E38\u620F.md")]) === "" && linkifyAnswerText("\u6B63\u6587", []) === "\u6B63\u6587", "\u7A7A\u8F93\u5165\u5B89\u5168");
}
{
  const srcs = [vault("\u76EE\u5F55A/\u540C\u540D.md"), vault("\u76EE\u5F55B/\u540C\u540D.md")];
  const out = linkifyAnswerText("\u53C2\u89C1 \u540C\u540D\u3002", srcs);
  test("R9", out.split("[[").length - 1 === 1, "\u91CD\u590D basename \u4EC5\u751F\u6210\u4E00\u4E2A\u94FE\u63A5\uFF1A" + out);
}
{
  const body = "\u7B2C\u4E00\u6BB5\u539F\u6587\u5185\u5BB9\u3002" + "\u8865\u5145\u6587\u5B57".repeat(120);
  const snip = extractEvidenceSnippet(body);
  test("R10", snip.length <= 505 && snip.startsWith("\u7B2C\u4E00\u6BB5\u539F\u6587\u5185\u5BB9"), "\u8BC1\u636E\u7247\u6BB5\u53D6\u81EA\u771F\u5B9E\u539F\u6587\u5F00\u5934\uFF08\u975E AI \u751F\u6210\uFF09");
}
{
  const body = "\u5F00\u573A\u94FA\u57AB\u3002" + "\u5173".repeat(30) + "\u6E38\u620F\u673A\u5236\u8BBE\u8BA1\u662F\u6838\u5FC3\u3002" + "\u5C3E\u6BB5\u8865\u5145".repeat(60);
  const snip = extractEvidenceSnippet(body, "\u56E0\u4E3A\u63D0\u5230\u4E86 \u6E38\u620F\u673A\u5236\u8BBE\u8BA1");
  test("R11", snip.includes("\u6E38\u620F\u673A\u5236\u8BBE\u8BA1"), "\u8BC1\u636E\u7247\u6BB5\u4F18\u5148\u5B9A\u4F4D reason \u5173\u952E\u8BCD\u9644\u8FD1\u539F\u6587\uFF1A" + snip.slice(0, 60));
}
{
  const srcs = [vault("\u5B58\u5728.md"), vault("\u5DF2\u5220\u9664.md"), { type: "web", url: "https://x.com" }, { type: "inference", snippet: "\u63A8\u7406" }];
  const kept = existingVaultSources(srcs, (p) => p === "\u5B58\u5728.md");
  test("R12", kept.length === 3 && kept.some((s) => s.path === "\u5B58\u5728.md") && !kept.some((s) => s.path === "\u5DF2\u5220\u9664.md"), "\u5DF2\u5220\u9664 vault \u6765\u6E90\u88AB\u8FC7\u6EE4\uFF0Cweb/inference \u4FDD\u7559\uFF08count=" + kept.length + "\uFF09");
}
setTimeout(() => {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log("==== SUMMARY ====");
  console.log("TOTAL=" + results.length + " PASS=" + pass + " FAIL=" + fail);
  for (const r of results.filter((x) => !x.pass)) console.log("FAILED: " + r.id + " :: " + r.detail);
  process.exit(fail > 0 ? 1 : 0);
}, 100);
