import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateHoldings,
  calculatePreferenceAllocation,
  eligibleBankProducts,
  eligibleSecuritiesAssets,
  generatePlan,
  getRateQuote,
  parseCsv,
  shouldKeepDeposit,
} from "../lib/engine.mjs";
import {
  GiftTaxPolicyEngine,
  InvestmentTaxFeeEngine,
  KbProductPolicyEngine,
  parsePolicyDocument,
} from "../lib/rules.mjs";
import {
  PortfolioPolicyValidator,
  runPortfolioAdvisor,
} from "../lib/portfolio-agent.mjs";

const root = new URL("../", import.meta.url);
const [
  bankCsv,
  securitiesCsv,
  scenarioText,
  giftTaxText,
  investmentTaxText,
  feeText,
  productPolicyText,
] = await Promise.all([
  readFile(new URL("data/kb_bank_products.csv", root), "utf8"),
  readFile(new URL("data/kb_securities_assets.csv", root), "utf8"),
  readFile(new URL("data/sample_scenario.json", root), "utf8"),
  readFile(new URL("data/gift_tax_rules.yaml", root), "utf8"),
  readFile(new URL("data/investment_tax_rules.yaml", root), "utf8"),
  readFile(new URL("data/fee_assumptions.yaml", root), "utf8"),
  readFile(new URL("data/kb_product_policies.yaml", root), "utf8"),
]);

const banks = parseCsv(bankCsv);
const securities = parseCsv(securitiesCsv);
const data = JSON.parse(scenarioText);
const giftTaxRules = parsePolicyDocument(giftTaxText);
const investmentTaxRules = parsePolicyDocument(investmentTaxText);
const feeAssumptions = parsePolicyDocument(feeText);
const productPolicies = parsePolicyDocument(productPolicyText);
const proposedGift = {
  date: "2026-07-30",
  amount: 5_000_000,
  donorId: "parent-father",
  donorGroupId: "parent-couple",
  donorRelationship: "부",
};
const context = {
  age: 12,
  asOf: "2026-07-30",
  horizonYears: 8,
  monthlyContribution: 500000,
};
const defaultProfile = {
  assetRanking: ["savings", "deposit", "stock", "bond"],
  strategyRanking: ["etf", "individual", "us", "domestic"],
  horizonYears: 8,
  monthlyContribution: 500000,
};

function buildPlan(overrides = {}) {
  return generatePlan({
    bankProducts: banks,
    securitiesAssets: securities,
    data,
    profile: defaultProfile,
    proposedGift,
    giftTaxRules,
    investmentTaxRules,
    feeAssumptions,
    productPolicies,
    ...overrides,
  });
}

test("preference rankings produce deterministic allocations", () => {
  const preference = calculatePreferenceAllocation(defaultProfile);
  assert.equal(preference.label, "적금 우선 · ETF 중심 · 미주 중심");
  assert.deepEqual(preference.target, {
    cash: 10,
    savings: 36,
    deposit: 27,
    fund: 9,
    domesticEtf: 5,
    overseasEtf: 7.6,
    domesticStock: 2.2,
    overseasStock: 3.2,
  });
});

test("investment horizon guardrails cap growth and individual-stock exposure", () => {
  const short = calculatePreferenceAllocation({
    ...defaultProfile,
    assetRanking: ["stock", "savings", "deposit", "bond"],
    horizonYears: 2,
  }).target;
  assert.ok(
    short.domesticEtf + short.overseasEtf + short.domesticStock + short.overseasStock <=
      20.1,
  );
  const medium = calculatePreferenceAllocation({
    ...defaultProfile,
    assetRanking: ["stock", "savings", "deposit", "bond"],
    strategyRanking: ["individual", "etf", "domestic", "us"],
    horizonYears: 4,
  }).target;
  assert.ok(medium.domesticStock + medium.overseasStock <= 10.1);
});

test("KB product policy excludes external, adult-only, discontinued and unsafe assets", () => {
  const external = {
    ...banks[0],
    product_id: "OTHER-BANK",
    provider: "다른은행",
  };
  const bankCandidates = eligibleBankProducts(
    [...banks, external],
    context,
    productPolicies,
  );
  assert.ok(bankCandidates.every((item) => item.provider === "KB국민은행"));
  assert.ok(!bankCandidates.some((item) => item.product_id === "KB-ADULT-ONLY"));
  assert.ok(!bankCandidates.some((item) => item.product_id === "KB-YOUTH-LEGACY"));

  const securityCandidates = eligibleSecuritiesAssets(
    securities,
    context,
    productPolicies,
  );
  assert.ok(securityCandidates.every((item) => item.provider === "KB증권"));
  assert.ok(!securityCandidates.some((item) => item.asset_id.startsWith("KBSEC-FILTER")));
});

test("KB Young Youth policy is data-driven and applies age and one-account facts", () => {
  const policyEngine = new KbProductPolicyEngine(productPolicies);
  const product = banks.find((item) => item.product_id === "KB-YOUNG-SAVINGS");
  const result = policyEngine.evaluateBankProduct(product, context);
  assert.equal(result.eligible, true);
  assert.equal(result.productPolicy.accounts_per_person, 1);
  assert.equal(result.productPolicy.maximum_monthly_amount, 3_000_000);
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
  assert.ok(quote.expectedRate < quote.maximumRate);
});

test("fixed scenario always includes bank and securities holdings without connection state", () => {
  const aggregated = aggregateHoldings(data, banks, securities);
  assert.equal(aggregated.total, 36_100_000);
  const plan = buildPlan();
  assert.ok(plan.recommendations.some((item) => item.provider === "KB증권"));
  assert.ok(!plan.limitations.some((item) => /연결/.test(item.message)));
  assert.ok(!plan.recommendations.some((item) => item.id === "KB-YOUTH-LEGACY"));
});

test("gift tax engine calculates the 18m plus 5m fixed scenario", () => {
  const result = new GiftTaxPolicyEngine(giftTaxRules).evaluate(
    data.giftHistory,
    proposedGift,
    data.children[0],
    data.asOf,
  );
  assert.equal(result.previousTotal, 18_000_000);
  assert.equal(result.remainingDeductionBefore, 2_000_000);
  assert.equal(result.combinedTotal, 23_000_000);
  assert.equal(result.taxableBase, 3_000_000);
  assert.equal(result.calculatedTax, 300_000);
  assert.equal(result.timelyFilingCredit, 9_000);
  assert.equal(result.estimatedTaxAfterCredit, 291_000);
  assert.equal(result.filingDueDate, "2026-10-31");
  assert.equal(result.aggregationApplies, true);
});

test("gift tax engine drops gifts outside the rolling ten-year window", () => {
  const history = [
    ...data.giftHistory,
    {
      giftId: "old",
      date: "2015-07-29",
      amount: 99_000_000,
      donorId: "parent-father",
      donorGroupId: "parent-couple",
      donorRelationship: "부",
    },
  ];
  const result = new GiftTaxPolicyEngine(giftTaxRules).evaluate(
    history,
    proposedGift,
    data.children[0],
    data.asOf,
  );
  assert.equal(result.previousTotal, 18_000_000);
});

test("investment tax and fee engine keeps legal tax and prototype fees separate", () => {
  const engine = new InvestmentTaxFeeEngine(investmentTaxRules, feeAssumptions);
  const overseas = securities.find((item) => item.asset_id === "KBSEC-US-STOCK-AAPL");
  const estimate = engine.estimate(overseas, {
    amount: 10_000_000,
    expectedReturnRate: 30,
    holdingYears: 1,
  });
  assert.equal(estimate.expectedGain, 3_000_000);
  assert.equal(estimate.estimatedTax, 110_000);
  assert.equal(estimate.commission, 25_000);
  assert.equal(estimate.fxCost, 10_000);
  assert.ok(estimate.totalCost >= 145_000);
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

test("portfolio validator rejects unknown products, unsafe weights and AI tax overrides", () => {
  const plan = buildPlan();
  const input = {
    profile: defaultProfile,
    allowedCandidates: plan.recommendations.map((item) => ({
      id: item.id,
      assetClass: item.assetClass,
    })),
  };
  const invalid = {
    allocations: {
      cash: 0,
      savings: 0,
      deposit: 0,
      fund: 0,
      domesticEtf: 60,
      overseasEtf: 40,
      domesticStock: 0,
      overseasStock: 0,
    },
    recommendations: [
      { assetClass: "overseasStock", productId: "OTHER-BANK-STOCK" },
    ],
    taxFacts: { giftTax: 0 },
  };
  const result = new PortfolioPolicyValidator().validate(invalid, input);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((item) => /허용되지 않은 상품/.test(item)));
  assert.ok(result.violations.some((item) => /세금·수수료/.test(item)));
});

test("agent uses deterministic fallback when Ollama is unavailable", async () => {
  const plan = buildPlan();
  const deterministicProposal = {
    allocations: plan.target,
    recommendations: plan.recommendations.map((item) => ({
      assetClass: item.assetClass,
      productId: item.id,
      weight: item.targetWeight,
      amount: item.targetAmount,
      action: item.held ? "유지" : "추가입금",
      rationale: item.reason,
    })),
  };
  const result = await runPortfolioAdvisor({
    provider: {
      async complete() {
        throw new Error("Ollama offline");
      },
    },
    input: {
      child: data.children[0],
      profile: defaultProfile,
      policyFacts: plan.policyFacts,
      allowedCandidates: plan.recommendations.map((item) => ({
        id: item.id,
        assetClass: item.assetClass,
      })),
      deterministicProposal,
    },
  });
  assert.equal(result.status, "fallback");
  assert.deepEqual(result.proposal.allocations, plan.target);
  assert.match(result.message, /규칙 기반 대체/);
});
