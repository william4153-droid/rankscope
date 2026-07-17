import { build } from "esbuild";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

for (const file of await readdir("public")) {
  if (file === "app.js") continue;
  const source = join("public", file);
  if ([".html", ".css", ".ico", ".png", ".svg", ".webmanifest"].includes(extname(file))) {
    await copyFile(source, join("dist", file));
  }
}

await build({
  entryPoints: ["public/app.js"],
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2022"],
  format: "iife",
  outfile: "dist/app.js",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

console.log("Static assets copied and frontend bundle created in dist/.");
