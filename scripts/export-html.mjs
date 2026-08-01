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
const scenario = JSON.parse(await fs.readFile(path.join(root, "data/sample_scenario.json"), "utf8"));
const interactions = await fs.readFile(path.join(root, "scripts/standalone-interactions.js"), "utf8");
const standaloneCss = `
  .standalone-modal-content { margin-top: 18px; }
  .standalone-copy { color: #625d54; font-size: 13px; line-height: 1.7; }
  .standalone-assets { border-top: 1px solid #ece7dd; }
  .standalone-asset-row { align-items: center; border-bottom: 1px solid #ece7dd; display: flex; gap: 16px; justify-content: space-between; padding: 13px 0; }
  .standalone-asset-row > div { align-items: flex-start; display: flex; flex-direction: column; gap: 5px; }
  .standalone-asset-row strong, .standalone-asset-row b { font-size: 12px; }
  .standalone-asset-row small { color: #928b82; font-size: 10px; }
  .standalone-form-grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
  .standalone-form-grid label { position: relative; }
  .standalone-form-grid label small { bottom: 14px; color: #8d867b; position: absolute; right: 12px; }
  .standalone-ranking { background: #f8f6f2; border-radius: 13px; margin-top: 16px; padding: 14px; }
  .standalone-ranking > strong { display: block; font-size: 12px; margin-bottom: 9px; }
  .standalone-ranking-list { display: grid; gap: 6px; }
  .standalone-rank-item { align-items: center; background: #fff; border: 1px solid #e6e0d6; border-radius: 9px; display: grid; gap: 9px; grid-template-columns: 26px 1fr auto; min-height: 44px; padding: 5px 7px; }
  .standalone-rank-item b { font-size: 11px; }
  .standalone-rebalance-panel { margin-bottom: 18px; }
  .standalone-rebalance-list > div { align-items: center; border-bottom: 1px solid #ece7dd; display: grid; gap: 11px; grid-template-columns: 28px 1fr auto; padding: 13px 0; }
  .standalone-rebalance-list p { display: flex; flex-direction: column; margin: 0; }
  .standalone-rebalance-list strong, .standalone-rebalance-list b { font-size: 12px; }
  .standalone-rebalance-list small { color: #918a80; font-size: 10px; margin-top: 3px; }
  .standalone-rebalance-note { background: #fff8d8; border-radius: 10px; color: #675b36; font-size: 11px; line-height: 1.6; margin-top: 15px; padding: 12px; }
  .standalone-toast { background: #2f2b25; border-radius: 999px; bottom: 24px; color: #fff; font-size: 12px; left: 50%; padding: 11px 17px; position: fixed; transform: translateX(-50%); z-index: 200; }
  .choice-row button.standalone-selected { background: #fff4bd; border-color: #dfbd27; color: #4d400f; }
  .standalone-spec-detail { grid-template-columns: 1fr 1fr; }
  @media (max-width: 650px) { .standalone-form-grid, .standalone-spec-detail { grid-template-columns: 1fr; } }
`;

html = html
  .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace("</head>", `<style>${css}\n${standaloneCss}</style></head>`)
  .replace("</body>", `<script>window.__KB_STANDALONE_DATA__=${JSON.stringify(scenario).replaceAll("<", "\\u003c")};</script><script>${interactions}</script></body>`);

const outputDirectory = path.join(root, "deliverables");
await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, "kb-child-wealth.html"), html, "utf8");

console.log(path.join(outputDirectory, "kb-child-wealth.html"));
