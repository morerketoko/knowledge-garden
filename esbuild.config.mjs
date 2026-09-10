import esbuild from "esbuild";
import process from "process";

const watch = process.argv.includes("--watch");
const banner = "/* Knowledge Garden (知识花园) - generated, do not edit */";

// Phase 24 §一百十二 / §一百十三：目标 JS runtime 是 Obsidian 桌面（Electron）与
// iOS / Android（Capacitor WebView）。esbuild 的默认 platform 是 browser，正合适：
// 它会拒绝打包内置 Node 模块，从而在**构建期**暴露任何残留的 fs/path/crypto 依赖，
// 而不是等到移动端运行时才炸。
//
// external 里刻意**不再列 fs / path / crypto**：这三个已被 src/portable/* 取代。
// 若未来有人重新 import Node 内置模块，构建会直接失败（这是设计意图，不是限制）。
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "browser",
  external: ["obsidian", "electron", "@codemirror/*"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  outfile: "main.js",
  banner: { js: banner },
});

if (watch) {
  await ctx.watch();
  console.log("kg: watching…");
} else {
  await ctx.rebuild();
  console.log("kg: build done");
  await ctx.dispose();
}