import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateHoldings,
  calculateRiskLevel,
  eligibleBankProducts,
  eligibleSecuritiesAssets,
  generatePlan,
  getRateQuote,
  getTargetAllocation,
  parseCsv,
  parseTaxYaml,
  shouldKeepDeposit,
} from "../lib/engine.mjs";

const root = new URL("../", import.meta.url);
const [bankCsv, securitiesCsv, holdingsText, taxText] = await Promise.all([
  readFile(new URL("data/kb_bank_products.csv", root), "utf8"),
  readFile(new URL("data/kb_securities_assets.csv", root), "utf8"),
  readFile(new URL("data/sample_holdings.json", root), "utf8"),
  readFile(new URL("data/tax_rules.yaml", root), "utf8"),
]);

const banks = parseCsv(bankCsv);
const securities = parseCsv(securitiesCsv);
const data = JSON.parse(holdingsText);
const taxRules = parseTaxYaml(taxText);
const context = {
  age: 12,
  asOf: "2026-07-30",
  horizonYears: 8,
  monthlyContribution: 500000,
};

test("risk score and horizon guardrails produce deterministic allocations", () => {
  assert.deepEqual(calculateRiskLevel([2, 2, 2, 2]), {
    score: 8,
    label: "위험중립형",
    index: 2,
  });
  const short = getTargetAllocation("공격투자형", 2);
  const risky = short.domesticEtf + short.overseasEtf + short.domesticStock + short.overseasStock;
  assert.ok(risky <= 20.1);
  assert.equal(short.domesticStock + short.overseasStock, 0);
});

test("KB bank products are searched before any external, adult-only or discontinued product", () => {
  const external = {
    ...banks[0],
    product_id: "OTHER-BANK",
    product_name: "외부은행 테스트 상품",
    provider: "다른은행",
    base_rate: 99,
  };
  const candidates = eligibleBankProducts([...banks, external], context);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((product) => product.provider === "KB국민은행"));
  assert.ok(candidates.every((product) => product.minor_eligible === true));
  assert.ok(candidates.every((product) => product.product_status === "active"));
  assert.ok(!candidates.some((product) => product.product_id === "KB-ADULT-ONLY"));
  assert.ok(!candidates.some((product) => product.product_id === "KB-YOUTH-LEGACY"));
});

test("stocks and ETFs remain KB Securities assets and unsafe instruments are excluded", () => {
  const candidates = eligibleSecuritiesAssets(securities, context);
  assert.ok(candidates.length >= 8);
  assert.ok(candidates.every((asset) => asset.provider === "KB증권"));
  assert.ok(candidates.every((asset) => !asset.leverage_flag && !asset.inverse_flag));
  assert.ok(candidates.every((asset) => asset.minor_account_tradable && asset.approved));
  assert.ok(!candidates.some((asset) => asset.asset_id.startsWith("KBSEC-FILTER")));
});

test("unverified preferential conditions never apply the maximum rate", () => {
  const product = banks.find((item) => item.product_id === "KB-YOUNG-SAVINGS");
  const quote = getRateQuote(
    product,
    { kb_account: "confirmed", child_allowance: "possible", fingerprint: "unknown" },
    "2026-07-30",
  );
  assert.equal(quote.baseRate, 2.35);
  assert.equal(quote.expectedRate, 2.65);
  assert.equal(quote.maximumRate, 3.65);
  assert.ok(quote.expectedRate < quote.maximumRate);
  assert.ok(quote.conditions.some((condition) => condition.status === "충족 가능"));
  assert.ok(quote.conditions.some((condition) => condition.status === "충족 여부 미확인"));
});

test("stale rates warn, stop yield calculation and eventually leave the candidate set", () => {
  const product = {
    ...banks.find((item) => item.product_id === "KB-YOUNG-SAVINGS"),
    last_verified_at: "2026-06-10",
  };
  const quote = getRateQuote(product, {}, "2026-07-30");
  assert.equal(quote.freshness.status, "warning");
  assert.equal(quote.baseRate, null);
  assert.match(quote.warning, /30일/);
  assert.equal(eligibleBankProducts([product], context).length, 1);
  const expired = { ...product, last_verified_at: "2026-01-01" };
  assert.equal(eligibleBankProducts([expired], context).length, 0);
});

test("discontinued products remain visible as holdings but never become new recommendations", () => {
  const aggregated = aggregateHoldings(data, banks, securities, true);
  assert.ok(aggregated.amounts.cash >= 7700000);
  const plan = generatePlan({
    bankProducts: banks,
    securitiesAssets: securities,
    data,
    profile: { riskScores: [2, 2, 2, 2], horizonYears: 8, monthlyContribution: 500000 },
    taxRules,
  });
  assert.ok(!plan.recommendations.some((item) => item.id === "KB-YOUTH-LEGACY"));
  assert.equal(plan.recommendations.find((item) => item.assetClass === "savings").id, "KB-YOUNG-SAVINGS");
  assert.equal(plan.recommendations.find((item) => item.assetClass === "domesticEtf").provider, "KB증권");
});

test("large early-termination loss or near maturity keeps KB deposits intact", () => {
  assert.equal(
    shouldKeepDeposit({
      daysToMaturity: 45,
      earlyTerminationLoss: 1000,
      expectedImprovement: 100000,
      safeAssetAfterWeight: 30,
      safeAssetTargetWeight: 30,
    }),
    true,
  );
  assert.equal(
    shouldKeepDeposit({
      daysToMaturity: 200,
      earlyTerminationLoss: 200000,
      expectedImprovement: 100000,
      safeAssetAfterWeight: 30,
      safeAssetTargetWeight: 30,
    }),
    true,
  );
});

test("Mock-only demo builds a full plan and explains unavailable KB Securities candidates", () => {
  const connectedPlan = generatePlan({
    bankProducts: banks,
    securitiesAssets: securities,
    data,
    profile: { riskScores: [2, 2, 2, 2], horizonYears: 8, monthlyContribution: 500000 },
    taxRules,
  });
  assert.ok(connectedPlan.recommendations.length >= 6);
  assert.ok(connectedPlan.rebalancing.holds.some((item) => item.keep));
  const disconnectedPlan = generatePlan({
    bankProducts: banks,
    securitiesAssets: securities,
    data,
    connected: false,
    profile: { riskScores: [2, 2, 2, 2], horizonYears: 8, monthlyContribution: 500000 },
    taxRules,
  });
  assert.ok(disconnectedPlan.limitations.some((item) => /KB증권 계좌 연결/.test(item.message)));
});
