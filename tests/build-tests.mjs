/**
 * Phase 24：重建 tests/*.cjs（Node 测试 bundle）。
 *
 * 为什么需要这个脚本：
 * - 测试源码 `import ... from "../src/xxx"`，源码内部 import 了 `obsidian`。
 *   Node 里没有 obsidian 运行时，必须把 `obsidian` 别名到 `tests/obsidian-stub.ts`。
 * - Phase 24 的便携存储要有宿主：每个测试 bundle 都预置
 *   `import "./portable-bootstrap";`（把 mkdtempSync 变相对路径 + 装配 MemoryRoot 宿主）。
 *
 * 用法：node tests/build-tests.mjs
 */
import esbuild from "esbuild";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const obsidianStub = join(here, "obsidian-stub.ts");

const stubPlugin = {
  name: "obsidian-stub",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({ path: obsidianStub }));
  },
};

const entries = readdirSync(here).filter((f) => f.endsWith("-tests.ts"));
let failed = 0;
for (const f of entries) {
  const input = join(here, f);
  const output = join(here, f.replace(/\.ts$/, ".cjs"));
  try {
    await esbuild.build({
      entryPoints: [input],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node18",
      outfile: output,
      plugins: [stubPlugin],
      logLevel: "error",
    });
  } catch (e) {
    failed++;
    console.error("build failed: " + f + " :: " + (e?.message ?? e));
  }
}
console.log("kg-tests: built " + (entries.length - failed) + "/" + entries.length + " bundles");
if (failed) process.exitCode = 1;
