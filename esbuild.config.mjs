import esbuild from "esbuild";
import process from "process";

const watch = process.argv.includes("--watch");
const banner = "/* Knowledge Garden (知识花园) - generated, do not edit */";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "fs", "path", "crypto"],
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