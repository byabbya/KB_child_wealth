import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the KB child asset management dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>KB 우리 아이 자산관리<\/title>/i);
  assert.match(html, /KB스타뱅킹/);
  assert.match(html, /현재 가입 가능한 KB국민은행 및 KB증권 상품/);
  assert.match(html, /추천 포트폴리오/);
  assert.match(html, /KB 적금 대비 성과 점검/);
  assert.match(html, /보호자 승인/);
  assert.match(html, /프로토타입/);
  assert.match(html, /선호 성향/);
  assert.doesNotMatch(html, /공모전 데모|DEMO|로그인|signin-with-chatgpt/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});
