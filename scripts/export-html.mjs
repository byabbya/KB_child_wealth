import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerUrl = pathToFileURL(path.join(root, "dist/server/index.js"));
workerUrl.searchParams.set("export", String(Date.now()));

const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request("http://localhost/", { headers: { accept: "text/html" } }),
  { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
  { waitUntil() {}, passThroughOnException() {} },
);

if (!response.ok) {
  throw new Error(`HTML export failed with status ${response.status}`);
}

let html = await response.text();
const assetDirectory = path.join(root, "dist/client/assets");
const cssFiles = (await fs.readdir(assetDirectory)).filter((name) => name.endsWith(".css"));
const css = (await Promise.all(cssFiles.map((name) => fs.readFile(path.join(assetDirectory, name), "utf8")))).join("\n");

html = html
  .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace("</head>", `<style>${css}</style></head>`);

const outputDirectory = path.join(root, "deliverables");
await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, "kb-child-wealth.html"), html, "utf8");

console.log(path.join(outputDirectory, "kb-child-wealth.html"));
