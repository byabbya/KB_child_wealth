import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /포트폴리오 명세서/);
  assert.match(html, /AI 포트폴리오 분석/);
  assert.match(html, /현재 포트폴리오/);
  assert.match(html, /AI 추천 포트폴리오 · 샘플/);
  assert.match(html, /샘플 AI 분석 결과 · 실제 AI 분석 전/);
  assert.match(html, /AI 실행 전 화면 확인용 샘플 분석/);
  assert.match(html, /AI 추천 근거/);
  assert.match(html, /사용자 분석/);
  assert.match(html, /시장 분석/);
  assert.match(html, /최종 추천/);
  assert.match(html, /규칙 확인/);
  assert.match(html, /KB 상품 연결/);
  assert.match(html, /추천 상품/);
  assert.match(html, /목표 포트폴리오.*추천 상품.*리밸런싱 제안/s);
  assert.doesNotMatch(html, /지난 목표 대비 변화/);
  assert.doesNotMatch(html, /Gemini 포트폴리오 분석/);
  assert.match(html, /donut-arrow/);
  assert.doesNotMatch(html, /donut-arrow[^>]*>→</);
  assert.match(html, /자산군.*현재.*추천.*차이/s);
  assert.doesNotMatch(html, /10년 증여재산공제 시뮬레이션|추가 증여 시뮬레이션/);
  assert.doesNotMatch(html, /샘플 자산 데이터|고정 시나리오|실제 자녀·계좌 정보를 조회하거나 연결하지 않습니다/);
  assert.doesNotMatch(html, /KB 적금 대비 성과 점검/);
  assert.doesNotMatch(html, /보호자 승인|보호자 최종 확인|승인 취소/);
  assert.doesNotMatch(html, /프로토타입|PortfolioAdvisorAgent|규칙 엔진/);
  assert.match(html, /선호 성향/);
  assert.doesNotMatch(html, /공모전 데모|DEMO|로그인|signin-with-chatgpt|KB증권 계좌 연결/);
  assert.doesNotMatch(html, /Ollama|OLLAMA/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("places previous-goal comparison inside the rebalancing view", async () => {
  const source = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  const rebalanceView = source.slice(source.indexOf("function RebalanceView"));
  assert.match(rebalanceView, /<PreviousGoalComparison/);
  assert.match(rebalanceView, /이번 달 리밸런싱 제안/);
});
