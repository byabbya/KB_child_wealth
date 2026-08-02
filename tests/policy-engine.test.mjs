import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateHoldings,
  applyAdvisorProposal,
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
  ALLOCATION_RESPONSE_SCHEMA,
  COMBINED_ADVICE_SCHEMA,
  GeminiLlmProvider,
  PortfolioPolicyValidator,
  evaluateMarketSnapshot,
  runPortfolioAdvisor,
} from "../lib/portfolio-agent.mjs";
import { buildRecommendationRationale } from "../lib/recommendation-rationale.mjs";

const root = new URL("../", import.meta.url);
const [
  bankCsv,
  securitiesCsv,
  scenarioText,
  giftTaxText,
  investmentTaxText,
  feeText,
  productPolicyText,
  marketSnapshotText,
] = await Promise.all([
  readFile(new URL("data/kb_bank_products.csv", root), "utf8"),
  readFile(new URL("data/kb_securities_assets.csv", root), "utf8"),
  readFile(new URL("data/sample_scenario.json", root), "utf8"),
  readFile(new URL("data/gift_tax_rules.yaml", root), "utf8"),
  readFile(new URL("data/investment_tax_rules.yaml", root), "utf8"),
  readFile(new URL("data/fee_assumptions.yaml", root), "utf8"),
  readFile(new URL("data/kb_product_policies.yaml", root), "utf8"),
  readFile(new URL("data/market_snapshot.json", root), "utf8"),
]);

const banks = parseCsv(bankCsv);
const securities = parseCsv(securitiesCsv);
const data = JSON.parse(scenarioText);
const giftTaxRules = parsePolicyDocument(giftTaxText);
const investmentTaxRules = parsePolicyDocument(investmentTaxText);
const feeAssumptions = parsePolicyDocument(feeText);
const productPolicies = parsePolicyDocument(productPolicyText);
const marketSnapshot = JSON.parse(marketSnapshotText);
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

function buildAgentInput(plan = buildPlan()) {
  return {
    child: data.children[0],
    profile: defaultProfile,
    policyFacts: plan.policyFacts,
    currentPortfolio: plan.current,
    marketSnapshot,
    deterministicProposal: {
      allocations: plan.target,
      allocationRationales: plan.recommendations.map((item) => ({
        assetClass: item.assetClass,
        rationale: item.reason,
        evidenceIds: [],
      })),
      consideredFactors: ["선호 순위", "투자기간"],
      assumptions: ["샘플 데이터"],
      summary: "규칙 기반 기준안",
    },
  };
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
  assert.equal(aggregated.total, 10_000_000);
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

test("portfolio validator rejects product generation, unsafe drift and tax overrides", () => {
  const plan = buildPlan();
  const input = buildAgentInput(plan);
  input.marketFreshness = evaluateMarketSnapshot(marketSnapshot, plan.policyFacts.asOf);
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
    allocationRationales: [],
    recommendations: [{ productId: "OTHER-BANK-STOCK" }],
    taxFacts: { giftTax: 0 },
  };
  const result = new PortfolioPolicyValidator().validate(invalid, input);
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((item) => /상품·금액·세금·수수료/.test(item)));
  assert.ok(result.violations.some((item) => /±5%p/.test(item)));
});

test("portfolio validator rejects untraceable market evidence", () => {
  const plan = buildPlan();
  const input = buildAgentInput(plan);
  input.marketFreshness = evaluateMarketSnapshot(marketSnapshot, plan.policyFacts.asOf);
  const result = new PortfolioPolicyValidator().validate(
    {
      allocations: plan.target,
      allocationRationales: [{
        assetClass: "overseasEtf",
        rationale: "확인되지 않은 전망",
        evidenceIds: ["invented-news"],
      }],
    },
    input,
  );
  assert.equal(result.valid, false);
  assert.ok(result.violations.some((item) => /확인되지 않은 시장 근거/.test(item)));
});

test("validated AI allocation is matched to KB products and amounts are recalculated", () => {
  const plan = buildPlan();
  const allocations = {
    ...plan.target,
    cash: plan.target.cash + 5,
    savings: plan.target.savings - 5,
  };
  const allocationRationales = plan.recommendations.map((item) => ({
    assetClass: item.assetClass,
    rationale: `AI 근거 ${item.assetClass}`,
    evidenceIds: [],
  }));
  const effective = applyAdvisorProposal({
    basePlan: plan,
    proposal: { allocations, allocationRationales },
    data,
    bankProducts: banks,
    investmentTaxRules,
    feeAssumptions,
  });
  const cash = effective.recommendations.find((item) => item.assetClass === "cash");
  assert.equal(effective.target.cash, 15);
  assert.equal(cash.targetAmount, Math.round((plan.current.total * 15) / 100));
  assert.equal(cash.reason, "AI 근거 cash");
  assert.equal(cash.advisorAction, "매도검토");
  assert.equal(cash.provider, "KB국민은행");
  assert.ok(effective.rebalancing);
});

test("Gemini provider requests structured JSON without exposing the key in the URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"summary":"ok"}' }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new GeminiLlmProvider({ apiKey: "server-secret", model: "gemini-test" });
    const result = await provider.complete([
      { role: "system", content: "system" },
      { role: "user", content: "user" },
    ]);
    assert.equal(result.model, "gemini-test");
    assert.equal(result.content, '{"summary":"ok"}');
    assert.doesNotMatch(requestUrl, /server-secret/);
    assert.equal(requestOptions.headers["x-goog-api-key"], "server-secret");
    const body = JSON.parse(requestOptions.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseSchema, ALLOCATION_RESPONSE_SCHEMA);
    assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal(body.generationConfig.maxOutputTokens, 2048);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("agent uses deterministic fallback when Gemini is unavailable", async () => {
  const plan = buildPlan();
  const result = await runPortfolioAdvisor({
    provider: {
      async complete() {
        throw new Error("Gemini unavailable");
      },
    },
    input: buildAgentInput(plan),
  });
  assert.equal(result.status, "fallback");
  assert.deepEqual(result.proposal.allocations, plan.target);
  assert.match(result.message, /Gemini 연결 실패/);
});

test("missing Gemini key returns an explicit deterministic fallback", async () => {
  const plan = buildPlan();
  const result = await runPortfolioAdvisor({
    provider: null,
    input: buildAgentInput(plan),
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.provider, "deterministic");
  assert.match(result.message, /API 키가 설정되지 않았습니다/);
});

test("stale market snapshots are neutralized and excluded from allocation evidence", () => {
  const stale = evaluateMarketSnapshot(marketSnapshot, "2027-01-01");
  assert.equal(stale.fresh, false);
  assert.equal(stale.status, "stale");
  assert.match(stale.warning, /시장자료가 오래됐거나/);
});

test("agent combines user, market, and allocation analysis in one Gemini call", async () => {
  const plan = buildPlan();
  const schemas = [];
  const provider = {
    name: "gemini",
    async complete(_messages, schema) {
      schemas.push(schema);
      return {
        model: "gemini-test",
        content: JSON.stringify({
          userAnalysis: {
            summary: "적금 우선과 장기 투자 선호를 확인했습니다.",
            preferenceInsights: ["적금 우선", "ETF 중심"],
            goalGapInsight: "목표까지 추가 적립이 필요합니다.",
            concentrationRisks: ["안전자산 비중 점검"],
            liquidityNeeds: ["월 납입 계획 반영"],
          },
          marketAnalysis: {
            summary: "미국시장은 긍정, 국내시장은 주의로 분석했습니다.",
            domesticOutlook: "cautious",
            usOutlook: "positive",
            etfOutlook: "positive",
            individualOutlook: "cautious",
            confidence: "medium",
            riskFactors: ["환율 변동"],
            evidenceIds: ["indicator-us-equity-trend", "indicator-krw-usd-risk"],
          },
          proposal: {
            allocations: plan.target,
            allocationRationales: plan.recommendations.map((item) => ({
              assetClass: item.assetClass,
              rationale: `${item.label} 배분 근거`,
              evidenceIds: item.assetClass === "overseasEtf"
                ? ["indicator-us-equity-trend"]
                : [],
            })),
            consideredFactors: ["사용자 선호", "시장 분석"],
            assumptions: ["샘플 시장자료"],
            summary: "사용자 조건과 시장 분석을 결합했습니다.",
          },
        }),
      };
    },
  };
  const result = await runPortfolioAdvisor({ provider, input: buildAgentInput(plan) });
  assert.equal(result.status, "validated");
  assert.equal(result.provider, "gemini");
  assert.equal(result.analysis.user.status, "ai");
  assert.equal(result.analysis.market.status, "ai");
  assert.equal(schemas.length, 1);
  assert.deepEqual(schemas[0], COMBINED_ADVICE_SCHEMA);
  assert.deepEqual(result.proposal.allocations, plan.target);
});

test("validator deterministically repairs allocation drift beyond five percentage points", () => {
  const plan = buildPlan();
  const input = buildAgentInput(plan);
  input.marketFreshness = evaluateMarketSnapshot(marketSnapshot, plan.policyFacts.asOf);
  const original = {
    allocations: { ...plan.target, cash: 30, savings: 16 },
    allocationRationales: [],
    consideredFactors: ["시장 분석"],
    assumptions: [],
    summary: "과도한 변경",
  };
  const validator = new PortfolioPolicyValidator();
  assert.equal(validator.validate(original, input).valid, false);
  const repaired = validator.repair(original, input);
  assert.equal(validator.validate(repaired, input).valid, true);
  for (const key of Object.keys(plan.target)) {
    assert.ok(Math.abs(repaired.allocations[key] - plan.target[key]) <= 5.01);
  }
});

test("recommendation rationale distinguishes baseline, AI, adjustment, fallback, and stale states", () => {
  const rationaleContext = {
    primaryAssetLabel: "적금",
    equityStyle: "ETF 중심",
    marketPreference: "미국시장",
    horizonYears: 8,
    heldProductCount: 3,
  };
  const baseline = buildRecommendationRationale({ advice: null, context: rationaleContext });
  assert.equal(baseline.state, "baseline");
  assert.equal(baseline.reasons.length, 3);
  assert.match(baseline.reasons[0], /^1순위인/);
  assert.match(baseline.reasons[1], /ETF 중심과 미국시장/);
  assert.match(baseline.reasons.join(" "), /적금.*8년/);
  assert.match(baseline.reasons.join(" "), /ETF 중심.*미국시장/);
  assert.match(baseline.reasons.join(" "), /보유.*3개/);

  const validated = buildRecommendationRationale({
    context: rationaleContext,
    advice: {
      status: "validated",
      proposal: { summary: "적금 선호를 중심으로 장기 포트폴리오를 구성했어요." },
      consideredFactors: ["선호 순위", "8년 투자기간", "세금·수수료 규칙", "KB 상품 적합성"],
      adjustments: [],
    },
  });
  assert.equal(validated.state, "validated");
  assert.equal(validated.reasons.length, 3);
  assert.match(validated.reasons[0], /적금 선호/);
  assert.equal(new Set(validated.reasons).size, validated.reasons.length);

  const adjusted = buildRecommendationRationale({
    context: rationaleContext,
    advice: {
      status: "adjusted",
      proposal: { summary: "AI 원안을 안전 기준에 맞게 조정했어요." },
      consideredFactors: ["투자기간"],
      adjustments: ["3~5년 투자기간의 성장자산 합계가 45%를 초과합니다."],
    },
  });
  assert.match(adjusted.adjustment, /ETF·주식 비중.*안전 범위/);

  const fallback = buildRecommendationRationale({
    context: rationaleContext,
    advice: {
      status: "fallback",
      proposal: { summary: "AI가 작성한 것처럼 보이면 안 되는 문장" },
      consideredFactors: ["AI 요소"],
      adjustments: [],
    },
  });
  assert.match(fallback.intro, /AI 연결 실패/);
  assert.doesNotMatch(fallback.reasons.join(" "), /AI가 작성/);

  const stale = buildRecommendationRationale({
    advice: null,
    stale: true,
    context: rationaleContext,
  });
  assert.equal(stale.state, "stale");
  assert.match(stale.intro, /다시 분석/);
});
