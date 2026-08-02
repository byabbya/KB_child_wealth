import { ASSET_CLASSES, ASSET_LABELS } from "./engine.mjs";
import { InvestmentTaxFeeEngine } from "./rules.mjs";

const GROWTH_ASSETS = [
  "domesticEtf",
  "overseasEtf",
  "domesticStock",
  "overseasStock",
];
const INDIVIDUAL_STOCKS = ["domesticStock", "overseasStock"];
const SAFE_ASSETS = ["cash", "savings", "deposit", "fund"];
const OUTLOOKS = ["positive", "neutral", "cautious"];
const REQUIRED_AGENT_TOOLS = [
  "getUserProfileFacts",
  "getMarketFacts",
  "getPolicyFacts",
  "listEligibleKbProducts",
  "simulateAllocation",
];
const MAX_TOOL_CALLS = 8;
const MAX_TOOL_TURNS = 2;
const AGENT_TIMEOUT_MS = 30_000;

function extractJson(text) {
  const clean = String(text ?? "")
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(clean);
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value ?? 0), 0);
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function daysBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function marketEvidence(snapshot) {
  return [
    ...(snapshot?.indicators ?? []),
    ...(snapshot?.news ?? []),
    ...(snapshot?.kbResearch ?? []),
  ];
}

export function evaluateMarketSnapshot(snapshot, asOf) {
  const evidence = marketEvidence(snapshot);
  const indicatorAge = daysBetween(snapshot?.asOf, asOf);
  const indicatorFresh =
    indicatorAge <= Number(snapshot?.indicatorValidityDays ?? 7) &&
    Array.isArray(snapshot?.indicators) &&
    snapshot.indicators.length > 0;
  const content = [...(snapshot?.news ?? []), ...(snapshot?.kbResearch ?? [])];
  const contentFresh =
    content.length > 0 &&
    content.some((item) => {
      const date = item.publishedAt ?? item.effectiveDate;
      return daysBetween(date, asOf) <= Number(snapshot?.contentValidityDays ?? 30);
    });
  const traceable = evidence.every(
    (item) => item?.id && item?.sourceName && (item?.effectiveDate || item?.publishedAt),
  );
  return {
    fresh: indicatorFresh && contentFresh && traceable,
    status: indicatorFresh && contentFresh && traceable ? "fresh" : "stale",
    asOf: snapshot?.asOf ?? null,
    evidenceIds: evidence.map((item) => item.id).filter(Boolean),
    warning:
      indicatorFresh && contentFresh && traceable
        ? null
        : "시장자료가 오래됐거나 근거가 불완전해 시장 전망에 따른 비중 조정을 적용하지 않습니다.",
  };
}

const allocationProperties = Object.fromEntries(
  ASSET_CLASSES.map((key) => [key, { type: "number", minimum: 0, maximum: 100 }]),
);

export const ALLOCATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    allocations: {
      type: "object",
      properties: allocationProperties,
      required: ASSET_CLASSES,
    },
    allocationRationales: {
      type: "array",
      items: {
        type: "object",
        properties: {
          assetClass: { type: "string", enum: ASSET_CLASSES },
          rationale: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["assetClass", "rationale", "evidenceIds"],
      },
    },
    consideredFactors: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "allocations",
    "allocationRationales",
    "consideredFactors",
    "assumptions",
    "summary",
  ],
};

const ALLOCATION_ARGUMENT_SCHEMA = {
  type: "object",
  properties: allocationProperties,
  required: ASSET_CLASSES,
};

export const PORTFOLIO_AGENT_TOOL_DECLARATIONS = [
  {
    name: "getUserProfileFacts",
    description: "사용자의 선호 순위, 목표 차이, 투자기간, 월 저축액과 현재 자산 집중도를 조회합니다.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "getMarketFacts",
    description: "기준일과 출처가 확인된 국내·미국시장, 환율, 금리, 뉴스와 KB 리서치 샘플을 조회합니다.",
    parameters: {
      type: "object",
      properties: {
        scopes: {
          type: "array",
          items: { type: "string", enum: ["domestic", "us", "rates", "global"] },
        },
      },
    },
  },
  {
    name: "getPolicyFacts",
    description: "투자기간별 자산 비중 제한, 기준 비중, 안전자산 조건과 증여 정책 사실을 조회합니다.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "listEligibleKbProducts",
    description: "가입·거래 가능성과 데이터 유효성 검증을 통과한 KB 상품 후보를 자산군별로 조회합니다.",
    parameters: {
      type: "object",
      properties: {
        assetClasses: {
          type: "array",
          items: { type: "string", enum: ASSET_CLASSES },
        },
      },
    },
  },
  {
    name: "simulateAllocation",
    description: "8개 자산군 비중의 합계, 기준안 대비 변동, 투자기간 제한과 목표금액을 검증합니다.",
    parameters: {
      type: "object",
      properties: { allocations: ALLOCATION_ARGUMENT_SCHEMA },
      required: ["allocations"],
    },
  },
  {
    name: "estimateNetCost",
    description: "제안 비중을 실행할 때의 세금, 수수료, 환전비용과 보수 추정치를 규칙 엔진으로 계산합니다.",
    parameters: {
      type: "object",
      properties: { allocations: ALLOCATION_ARGUMENT_SCHEMA },
      required: ["allocations"],
    },
  },
];

function growthCap(profile) {
  if (profile.horizonYears < 3) return 20;
  if (profile.horizonYears <= 5) return 45;
  return 100;
}

function addWithinBounds(values, amount, keys, upper) {
  let remaining = amount;
  for (let pass = 0; pass < 4 && remaining > 0.0001; pass += 1) {
    const candidates = keys.filter((key) => upper[key] - values[key] > 0.0001);
    const capacity = sum(candidates.map((key) => upper[key] - values[key]));
    if (!candidates.length || capacity <= 0) break;
    for (const key of candidates) {
      const available = upper[key] - values[key];
      const addition = Math.min(available, remaining * (available / capacity));
      values[key] += addition;
    }
    remaining = amount - (sum(ASSET_CLASSES.map((key) => values[key])) - (100 - amount));
  }
}

function normalizeWithinBounds(values, lower, upper) {
  for (let pass = 0; pass < 8; pass += 1) {
    const delta = 100 - sum(ASSET_CLASSES.map((key) => values[key]));
    if (Math.abs(delta) < 0.0001) break;
    const candidates = ASSET_CLASSES.filter((key) =>
      delta > 0 ? upper[key] - values[key] > 0.0001 : values[key] - lower[key] > 0.0001,
    );
    const capacity = sum(
      candidates.map((key) =>
        delta > 0 ? upper[key] - values[key] : values[key] - lower[key],
      ),
    );
    if (!candidates.length || capacity <= 0) break;
    for (const key of candidates) {
      const available = delta > 0 ? upper[key] - values[key] : values[key] - lower[key];
      const change = Math.min(Math.abs(delta) * (available / capacity), available);
      values[key] += delta > 0 ? change : -change;
    }
  }
}

function reduceGroup(values, keys, maximum, lower, upper) {
  const total = sum(keys.map((key) => values[key]));
  if (total <= maximum + 0.0001) return;
  let excess = total - maximum;
  const reducible = sum(keys.map((key) => Math.max(0, values[key] - lower[key])));
  if (reducible <= 0) return;
  for (const key of keys) {
    const available = Math.max(0, values[key] - lower[key]);
    const reduction = Math.min(available, excess * (available / reducible));
    values[key] -= reduction;
  }
  excess = 100 - sum(ASSET_CLASSES.map((key) => values[key]));
  addWithinBounds(values, excess, SAFE_ASSETS, upper);
}

function repairAllocations(raw, baseline, profile) {
  const lower = {};
  const upper = {};
  const values = {};
  for (const key of ASSET_CLASSES) {
    const base = Number(baseline[key] ?? 0);
    lower[key] = Math.max(0, base - 5);
    upper[key] = Math.min(100, base + 5);
    const proposed = Number(raw?.[key]);
    values[key] = Math.min(
      upper[key],
      Math.max(lower[key], Number.isFinite(proposed) ? proposed : base),
    );
  }
  normalizeWithinBounds(values, lower, upper);
  reduceGroup(values, GROWTH_ASSETS, growthCap(profile), lower, upper);
  if (profile.horizonYears >= 3 && profile.horizonYears <= 5) {
    reduceGroup(values, INDIVIDUAL_STOCKS, 10, lower, upper);
  }
  normalizeWithinBounds(values, lower, upper);
  const rounded = Object.fromEntries(
    ASSET_CLASSES.map((key) => [key, Number(values[key].toFixed(1))]),
  );
  const residual = Number((100 - sum(ASSET_CLASSES.map((key) => rounded[key]))).toFixed(1));
  if (Math.abs(residual) > 0) {
    const key = ASSET_CLASSES.find((candidate) =>
      residual > 0
        ? rounded[candidate] + residual <= upper[candidate] + 0.01
        : rounded[candidate] + residual >= lower[candidate] - 0.01,
    );
    if (key) rounded[key] = Number((rounded[key] + residual).toFixed(1));
  }
  return rounded;
}

export class PortfolioPolicyValidator {
  validate(proposal, input) {
    const violations = [];
    const baseline = input.deterministicProposal?.allocations ?? {};
    const allowedEvidence = new Set(input.marketFreshness?.evidenceIds ?? []);
    if (!proposal || typeof proposal !== "object") {
      return { valid: false, violations: ["응답이 객체가 아닙니다."] };
    }
    if (
      proposal.recommendations ||
      proposal.products ||
      proposal.taxFacts ||
      proposal.giftTax ||
      proposal.fees ||
      proposal.amounts
    ) {
      violations.push("AI가 상품·금액·세금·수수료를 직접 생성했습니다.");
    }
    const allocations = proposal.allocations;
    if (!allocations || typeof allocations !== "object") {
      violations.push("자산군별 allocations가 없습니다.");
    } else {
      for (const key of ASSET_CLASSES) {
        const value = Number(allocations[key]);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          violations.push(`${key} 비중이 0~100 범위의 숫자가 아닙니다.`);
        }
        if (Number.isFinite(value) && Math.abs(value - Number(baseline[key] ?? 0)) > 5.01) {
          violations.push(`${key} 비중이 기준안 대비 ±5%p 범위를 벗어났습니다.`);
        }
      }
      const total = sum(ASSET_CLASSES.map((key) => allocations[key]));
      if (Math.abs(total - 100) > 0.2) {
        violations.push(`비중 합계가 ${total.toFixed(1)}%로 100%가 아닙니다.`);
      }
      const growth = sum(GROWTH_ASSETS.map((key) => allocations[key]));
      if (growth > growthCap(input.profile) + 0.01) {
        violations.push("투자기간에 허용된 ETF·개별주식 비중을 초과했습니다.");
      }
      const individual = sum(INDIVIDUAL_STOCKS.map((key) => allocations[key]));
      if (
        input.profile.horizonYears >= 3 &&
        input.profile.horizonYears <= 5 &&
        individual > 10.01
      ) {
        violations.push("3~5년 투자기간의 개별주식 합계가 10%를 초과했습니다.");
      }
    }
    if (!Array.isArray(proposal.allocationRationales)) {
      violations.push("자산군별 추천 근거가 없습니다.");
    } else {
      for (const rationale of proposal.allocationRationales) {
        if (!ASSET_CLASSES.includes(rationale.assetClass)) {
          violations.push("추천 근거에 알 수 없는 자산군이 포함되었습니다.");
        }
        for (const evidenceId of arrayOfStrings(rationale.evidenceIds)) {
          if (!input.marketFreshness?.fresh || !allowedEvidence.has(evidenceId)) {
            violations.push(`확인되지 않은 시장 근거 ${evidenceId}가 사용되었습니다.`);
          }
        }
      }
    }
    return { valid: violations.length === 0, violations };
  }

  repair(proposal, input) {
    const allowedEvidence = new Set(input.marketFreshness?.evidenceIds ?? []);
    const allocations = repairAllocations(
      proposal?.allocations,
      input.deterministicProposal.allocations,
      input.profile,
    );
    const rationaleByClass = new Map(
      Array.isArray(proposal?.allocationRationales)
        ? proposal.allocationRationales.map((item) => [item.assetClass, item])
        : [],
    );
    return {
      allocations,
      allocationRationales: ASSET_CLASSES.filter((key) => allocations[key] > 0).map((key) => {
        const item = rationaleByClass.get(key);
        return {
          assetClass: key,
          rationale:
            String(item?.rationale ?? "").trim() ||
            `${ASSET_LABELS[key]}은 입력한 선호와 투자기간을 반영한 기준안입니다.`,
          evidenceIds: input.marketFreshness?.fresh
            ? arrayOfStrings(item?.evidenceIds).filter((id) => allowedEvidence.has(id))
            : [],
        };
      }),
      consideredFactors: arrayOfStrings(proposal?.consideredFactors),
      assumptions: arrayOfStrings(proposal?.assumptions),
      summary:
        String(proposal?.summary ?? "").trim() ||
        "사용자 조건과 시장자료를 결합한 자산배분을 금융 기준에 맞게 조정했습니다.",
    };
  }
}

function requireAllocations(args) {
  const allocations = args?.allocations;
  if (!allocations || typeof allocations !== "object") {
    throw new Error("8개 자산군 비중이 필요합니다.");
  }
  const normalized = {};
  for (const key of ASSET_CLASSES) {
    const value = Number(allocations[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${key} 비중은 0~100 범위의 숫자여야 합니다.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function inferOutlook(items, market) {
  const signals = items
    .filter((item) => item.market === market || item.market === "global")
    .map((item) => item.signal)
    .filter((signal) => OUTLOOKS.includes(signal));
  if (signals.includes("cautious")) return "cautious";
  if (signals.includes("positive")) return "positive";
  return "neutral";
}

/** 읽기 전용 금융 도구만 등록하고, 허용되지 않은 이름과 인자를 차단합니다. */
export class PortfolioAgentToolRegistry {
  constructor(input, validator = new PortfolioPolicyValidator()) {
    this.input = input;
    this.validator = validator;
    this.declarationByName = new Map(
      PORTFOLIO_AGENT_TOOL_DECLARATIONS.map((tool) => [tool.name, tool]),
    );
  }

  declarations() {
    return PORTFOLIO_AGENT_TOOL_DECLARATIONS;
  }

  async execute(name, args = {}) {
    if (!this.declarationByName.has(name)) {
      throw new Error(`허용되지 않은 에이전트 도구입니다: ${name}`);
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error(`${name} 도구 인자가 객체가 아닙니다.`);
    }

    if (name === "getUserProfileFacts") return this.getUserProfileFacts();
    if (name === "getMarketFacts") return this.getMarketFacts(args);
    if (name === "getPolicyFacts") return this.getPolicyFacts();
    if (name === "listEligibleKbProducts") return this.listEligibleKbProducts(args);
    if (name === "simulateAllocation") return this.simulateAllocation(args);
    if (name === "estimateNetCost") return this.estimateNetCost(args);
    throw new Error(`실행할 수 없는 에이전트 도구입니다: ${name}`);
  }

  getUserProfileFacts() {
    const total = Number(this.input.currentPortfolio?.total ?? 0);
    const goalAmount = Number(this.input.child?.goalAmount ?? 0);
    const weights = this.input.currentPortfolio?.weights ?? {};
    const concentration = ASSET_CLASSES
      .map((assetClass) => ({ assetClass, weight: Number(weights[assetClass] ?? 0) }))
      .sort((a, b) => b.weight - a.weight)[0] ?? null;
    return {
      assetRanking: this.input.profile.assetRanking,
      strategyRanking: this.input.profile.strategyRanking,
      horizonYears: this.input.profile.horizonYears,
      monthlyContribution: this.input.profile.monthlyContribution,
      currentTotal: total,
      goalAmount,
      goalGap: Math.max(0, goalAmount - total),
      concentration,
    };
  }

  getMarketFacts(args) {
    if (!this.input.marketFreshness?.fresh) {
      return {
        status: "stale",
        asOf: this.input.marketFreshness?.asOf ?? null,
        warning: this.input.marketFreshness?.warning,
        outlook: { domestic: "neutral", us: "neutral" },
        evidence: [],
      };
    }
    const requested = Array.isArray(args.scopes) ? args.scopes : [];
    const evidence = marketEvidence(this.input.marketSnapshot).filter((item) => {
      if (requested.length === 0) return true;
      if (requested.includes(item.market)) return true;
      if (requested.includes("rates") && /rate|금리/i.test(`${item.id} ${item.title ?? item.name ?? ""}`)) {
        return true;
      }
      return requested.includes("global") && item.market === "global";
    });
    return {
      status: "fresh",
      asOf: this.input.marketFreshness.asOf,
      outlook: {
        domestic: inferOutlook(evidence, "domestic"),
        us: inferOutlook(evidence, "us"),
      },
      evidence: evidence.map((item) => ({
        id: item.id,
        market: item.market,
        signal: item.signal,
        summary: item.summary,
        sourceName: item.sourceName,
        date: item.publishedAt ?? item.effectiveDate,
      })),
    };
  }

  getPolicyFacts() {
    return {
      asOf: this.input.policyFacts.asOf,
      baselineAllocation: this.input.deterministicProposal.allocations,
      maximumDriftPercentagePoints: 5,
      growthAssetMaximum: growthCap(this.input.profile),
      individualStockMaximum:
        this.input.profile.horizonYears >= 3 && this.input.profile.horizonYears <= 5 ? 10 : null,
      safetyGuardrail: this.input.policyFacts.safetyGuardrail,
      giftTax: this.input.policyFacts.giftTax,
    };
  }

  listEligibleKbProducts(args) {
    const requested = Array.isArray(args.assetClasses)
      ? args.assetClasses.filter((key) => ASSET_CLASSES.includes(key))
      : ASSET_CLASSES;
    return (this.input.toolContext?.eligibleProducts ?? [])
      .filter((item) => requested.includes(item.assetClass))
      .map((item) => ({
        assetClass: item.assetClass,
        id: item.id,
        name: item.name,
        provider: item.provider,
        riskGrade: item.riskGrade,
        held: Boolean(item.held),
        channel: item.channel,
      }));
  }

  simulateAllocation(args) {
    const allocations = requireAllocations(args);
    const proposal = {
      allocations,
      allocationRationales: [],
      consideredFactors: [],
      assumptions: [],
      summary: "에이전트 도구 검증용 비중",
    };
    const validation = this.validator.validate(proposal, this.input);
    const repairedAllocations = validation.valid
      ? allocations
      : this.validator.repair(proposal, this.input).allocations;
    const total = sum(ASSET_CLASSES.map((key) => allocations[key]));
    const growthWeight = sum(GROWTH_ASSETS.map((key) => allocations[key]));
    const individualStockWeight = sum(INDIVIDUAL_STOCKS.map((key) => allocations[key]));
    const contributionProjection =
      Number(this.input.currentPortfolio.total ?? 0) +
      Number(this.input.profile.monthlyContribution ?? 0) * 12 * Number(this.input.profile.horizonYears ?? 0);
    return {
      valid: validation.valid,
      violations: validation.violations,
      totalWeight: Number(total.toFixed(1)),
      growthWeight: Number(growthWeight.toFixed(1)),
      individualStockWeight: Number(individualStockWeight.toFixed(1)),
      targetAmounts: Object.fromEntries(
        ASSET_CLASSES.map((key) => [
          key,
          Math.round((Number(this.input.currentPortfolio.total ?? 0) * allocations[key]) / 100),
        ]),
      ),
      contributionProjection,
      goalAmount: Number(this.input.child.goalAmount ?? 0),
      repairedAllocations,
    };
  }

  estimateNetCost(args) {
    const allocations = requireAllocations(args);
    const engine = new InvestmentTaxFeeEngine(
      this.input.toolContext?.investmentTaxRules ?? {},
      this.input.toolContext?.feeAssumptions ?? { schedules: {} },
    );
    const currentAmounts = this.input.currentPortfolio.amounts ?? {};
    const currentTotal = Number(this.input.currentPortfolio.total ?? 0);
    const estimates = (this.input.toolContext?.eligibleProducts ?? []).map((candidate) => {
      const targetAmount = Math.round(currentTotal * Number(allocations[candidate.assetClass] ?? 0) / 100);
      const actionAmount = Math.abs(targetAmount - Number(currentAmounts[candidate.assetClass] ?? 0));
      const action = targetAmount >= Number(currentAmounts[candidate.assetClass] ?? 0) ? "buy" : "sell";
      const expectedReturnRate = candidate.rateQuote?.expectedRate ?? candidate.expectedReturn ?? 0;
      const estimate = engine.estimate(
        {
          tax_category: candidate.taxCategory,
          fee_schedule_id: candidate.feeScheduleId,
          expense_ratio: candidate.expenseRatio,
          provider: candidate.provider,
          market: candidate.market,
          vehicle_type: candidate.vehicleType,
        },
        { amount: actionAmount, expectedReturnRate, holdingYears: 1, action },
      );
      return {
        assetClass: candidate.assetClass,
        action,
        actionAmount,
        estimatedTax: estimate.estimatedTax,
        transactionTax: estimate.transactionTax,
        commission: estimate.commission,
        fxCost: estimate.fxCost,
        productExpense: estimate.productExpense,
        totalCost: estimate.totalCost,
      };
    });
    return {
      estimates,
      totalEstimatedCost: estimates.reduce((total, item) => total + item.totalCost, 0),
      earlyTerminationWarnings: this.input.toolContext?.earlyTerminationWarnings ?? [],
      disclaimer: "세금과 비용은 기준일이 있는 규칙 데이터로 계산한 추정치입니다.",
    };
  }
}

export class GeminiLlmProvider {
  constructor({
    apiKey,
    model = "gemini-3.5-flash",
    timeoutMs = 25_000,
  } = /** @type {{ apiKey?: string; model?: string; timeoutMs?: number }} */ ({})) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.name = "gemini";
  }

  async complete(messages, responseSchema = ALLOCATION_RESPONSE_SCHEMA) {
    if (!this.apiKey) throw new Error("Gemini API 키가 설정되지 않았습니다.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const system = messages.find((message) => message.role === "system")?.content ?? "";
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              maxOutputTokens: 1_536,
              thinkingConfig: { thinkingLevel: "minimal" },
              responseMimeType: "application/json",
              responseSchema,
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`Gemini 호출 실패 (${response.status})`);
      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("");
      if (!content) throw new Error("Gemini가 구조화 JSON을 반환하지 않았습니다.");
      return { model: this.model, content };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Gemini 응답 시간이 초과되었습니다.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async nextToolTurn({ system, contents, tools, timeoutMs = this.timeoutMs }) {
    if (!this.apiKey) throw new Error("Gemini API 키가 설정되지 않았습니다.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            tools: [{ functionDeclarations: tools }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
            generationConfig: {
              maxOutputTokens: 512,
              thinkingConfig: { thinkingLevel: "minimal" },
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`Gemini 도구 호출 실패 (${response.status})`);
      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error("Gemini가 도구 호출 응답을 반환하지 않았습니다.");
      }
      return {
        model: this.model,
        parts,
        functionCalls: parts
          .filter((part) => part?.functionCall?.name)
          .map((part) => ({
            id: part.functionCall.id,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          })),
        text: parts.map((part) => part.text ?? "").join(""),
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Gemini 도구 호출 응답 시간이 초과되었습니다.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function baseSystemPrompt() {
  return [
    "당신은 KB스타뱅킹 자녀 자산관리 서비스의 단일 PortfolioAdvisorAgent입니다.",
    "사용자·시장·정책·KB 상품 사실은 추측하지 말고 반드시 제공된 읽기 전용 도구로 조회하세요.",
    "먼저 독립적인 사실 조회 도구를 병렬로 호출한 뒤, 자산배분 초안을 simulateAllocation으로 검증하세요.",
    "비용이 의사결정에 영향을 주면 estimateNetCost를 호출하세요.",
    "상품 가입, 거래, 계좌 변경을 실행하지 마세요.",
    "세금, 수수료, 상품조건과 시장 근거를 새로 만들거나 수정하지 마세요.",
    "내부 추론 과정은 노출하지 말고 도구 호출 또는 짧은 상태 응답만 반환하세요.",
  ].join("\n");
}

function agentOpeningPrompt(input) {
  return JSON.stringify(
    {
      profile: input.profile,
      task: "읽기 전용 금융 도구를 사용해 자녀의 목표 포트폴리오를 설계하세요.",
      requiredTools: REQUIRED_AGENT_TOOLS,
      instructions: [
        "getUserProfileFacts, getMarketFacts, getPolicyFacts, listEligibleKbProducts를 먼저 조회",
        "조회한 사실로 초안 비중을 만든 뒤 simulateAllocation을 호출",
        "도구가 위반을 반환하면 repairedAllocations를 참고",
        "현재 단계에서는 최종 상품이나 세금값을 직접 작성하지 말 것",
      ],
    },
    null,
    2,
  );
}

function finalProposalPrompt(input, toolResults) {
  return JSON.stringify(
    {
      task: "도구 결과만 사용해 최종 자산배분 JSON을 작성하세요.",
      toolResults: Object.fromEntries(toolResults),
      validMarketEvidenceIds: input.marketFreshness.fresh
        ? input.marketFreshness.evidenceIds
        : [],
      outputRules: [
        "8개 자산군 비중을 모두 작성하고 합계는 100으로 맞출 것",
        "기준안 대비 자산군별 ±5%p 범위를 지킬 것",
        "simulateAllocation이 반환한 제한을 지킬 것",
        "상품 ID, 상품명, 금액, 금리, 세금, 수수료를 작성하지 말 것",
        "시장 근거는 validMarketEvidenceIds에 있는 값만 사용할 것",
        "추천 이유는 보호자가 이해하기 쉬운 짧은 문장으로 작성할 것",
      ],
    },
    null,
    2,
  );
}

function deterministicUserAnalysis(input, status = "fallback") {
  const total = Number(input.currentPortfolio?.total ?? 0);
  const goal = Number(input.child?.goalAmount ?? 0);
  const gap = Math.max(0, goal - total);
  const weights = input.currentPortfolio?.weights ?? {};
  const concentrated = ASSET_CLASSES
    .map((key) => ({ key, weight: Number(weights[key] ?? 0) }))
    .sort((a, b) => b.weight - a.weight)[0];
  return {
    status,
    summary: `${input.profile.horizonYears}년 투자기간과 두 개의 선호 순위를 중심으로 사용자 조건을 정리했습니다.`,
    preferenceInsights: [
      `${input.profile.assetRanking[0]} 자산을 가장 선호합니다.`,
      `${input.profile.strategyRanking[0]} 방식을 가장 선호합니다.`,
    ],
    goalGapInsight: `현재 자산과 목표금액의 차이는 약 ${Math.round(gap / 10_000).toLocaleString("ko-KR")}만원입니다.`,
    concentrationRisks: concentrated
      ? [`현재 가장 큰 비중은 ${ASSET_LABELS[concentrated.key]} ${concentrated.weight.toFixed(1)}%입니다.`]
      : [],
    liquidityNeeds: [`월 ${Math.round(Number(input.profile.monthlyContribution) / 10_000).toLocaleString("ko-KR")}만원의 신규 납입 계획을 반영합니다.`],
  };
}

function neutralMarketAnalysis(input, status = "stale") {
  return {
    status,
    summary: input.marketFreshness.warning ?? "시장 분석을 중립으로 처리했습니다.",
    domesticOutlook: "neutral",
    usOutlook: "neutral",
    etfOutlook: "neutral",
    individualOutlook: "neutral",
    confidence: "low",
    riskFactors: ["시장자료가 충분하지 않아 방향성 판단을 비중에 반영하지 않았습니다."],
    evidenceIds: [],
  };
}

function fallbackResult(input, error, analysis = null, adjustments = [], agentRun = null) {
  return {
    status: "fallback",
    provider: "deterministic",
    model: null,
    originalProposal: null,
    proposal: input.deterministicProposal,
    adjustments,
    consideredFactors: [
      "두 개의 선호 순위",
      "남은 투자기간 안전장치",
      "검증된 KB 상품 후보",
      "증여세·세금·수수료 규칙",
    ],
    analysis: analysis ?? {
      user: deterministicUserAnalysis(input),
      market: neutralMarketAnalysis(input),
    },
    marketDataStatus: input.marketFreshness,
    agentRun: agentRun ?? {
      mode: "deterministic",
      usedTools: [],
      toolCallCount: 0,
      turns: 0,
      validation: "fallback",
    },
    message: `Gemini 연결 실패 · 규칙 기반 추천 (${error?.message ?? "원인 미확인"})`,
  };
}

function buildToolAnalysis(input, toolResults) {
  const userFacts = toolResults.get("getUserProfileFacts");
  const marketFacts = toolResults.get("getMarketFacts");
  const concentration = userFacts?.concentration;
  return {
    user: userFacts
      ? {
          status: "agent-tool",
          summary: `${userFacts.horizonYears}년 투자기간과 두 개의 선호 순위를 금융 도구로 확인했습니다.`,
          preferenceInsights: [
            `${userFacts.assetRanking?.[0]} 자산 우선`,
            `${userFacts.strategyRanking?.[0]} 방식 우선`,
          ],
          goalGapInsight: `목표까지 ${Math.round(Number(userFacts.goalGap ?? 0) / 10_000).toLocaleString("ko-KR")}만원이 필요합니다.`,
          concentrationRisks: concentration
            ? [`현재 가장 큰 비중은 ${ASSET_LABELS[concentration.assetClass]} ${Number(concentration.weight).toFixed(1)}%입니다.`]
            : [],
          liquidityNeeds: [`월 ${Math.round(Number(userFacts.monthlyContribution ?? 0) / 10_000).toLocaleString("ko-KR")}만원 납입 계획을 반영합니다.`],
        }
      : deterministicUserAnalysis(input),
    market: marketFacts
      ? {
          status: marketFacts.status === "fresh" ? "agent-tool" : "stale",
          summary:
            marketFacts.status === "fresh"
              ? (marketFacts.evidence ?? []).slice(0, 2).map((item) => item.summary).join(" ")
              : marketFacts.warning,
          domesticOutlook: marketFacts.outlook?.domestic ?? "neutral",
          usOutlook: marketFacts.outlook?.us ?? "neutral",
          etfOutlook: "neutral",
          individualOutlook: "neutral",
          confidence: marketFacts.status === "fresh" ? "medium" : "low",
          riskFactors: [],
          evidenceIds: (marketFacts.evidence ?? []).map((item) => item.id),
        }
      : neutralMarketAnalysis(input),
  };
}

function promiseWithinDeadline(promise, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new Error("AI 에이전트 실행 시간이 초과되었습니다."));
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("AI 에이전트 실행 시간이 초과되었습니다.")), remaining);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class PortfolioAdvisorAgent {
  constructor({
    provider,
    maxToolCalls = MAX_TOOL_CALLS,
    maxToolTurns = MAX_TOOL_TURNS,
    timeoutMs = AGENT_TIMEOUT_MS,
  } = {}) {
    this.provider = provider;
    this.maxToolCalls = maxToolCalls;
    this.maxToolTurns = maxToolTurns;
    this.timeoutMs = timeoutMs;
  }

  async run(input) {
    const marketFreshness = evaluateMarketSnapshot(input.marketSnapshot, input.policyFacts?.asOf);
    const enrichedInput = { ...input, marketFreshness };
    if (!this.provider) {
      return fallbackResult(enrichedInput, new Error("Gemini API 키가 설정되지 않았습니다."));
    }
    if (typeof this.provider.nextToolTurn !== "function") {
      return fallbackResult(enrichedInput, new Error("Gemini 도구 호출 기능을 사용할 수 없습니다."));
    }

    const validator = new PortfolioPolicyValidator();
    const registry = new PortfolioAgentToolRegistry(enrichedInput, validator);
    const deadline = Date.now() + this.timeoutMs;
    const toolResults = new Map();
    const usedTools = [];
    const callSignatures = new Set();
    let toolCallCount = 0;
    let turns = 0;
    const contents = [{ role: "user", parts: [{ text: agentOpeningPrompt(enrichedInput) }] }];

    try {
      for (let index = 0; index < this.maxToolTurns; index += 1) {
        turns += 1;
        const turn = await promiseWithinDeadline(
          this.provider.nextToolTurn({
            system: baseSystemPrompt(),
            contents,
            tools: registry.declarations(),
            timeoutMs: Math.max(1, deadline - Date.now()),
          }),
          deadline,
        );
        contents.push({ role: "model", parts: turn.parts });
        if (!turn.functionCalls?.length) {
          const missing = REQUIRED_AGENT_TOOLS.filter((name) => !toolResults.has(name));
          contents.push({
            role: "user",
            parts: [{ text: `최종 답변 전에 다음 필수 도구를 호출하세요: ${missing.join(", ")}` }],
          });
          continue;
        }
        if (toolCallCount + turn.functionCalls.length > this.maxToolCalls) {
          throw new Error("에이전트 도구 호출 한도를 초과했습니다.");
        }
        const executed = await Promise.all(
          turn.functionCalls.map(async (call) => {
            const signature = `${call.name}:${JSON.stringify(call.args ?? {})}`;
            if (callSignatures.has(signature)) {
              throw new Error(`같은 도구 호출이 반복되었습니다: ${call.name}`);
            }
            callSignatures.add(signature);
            const result = await registry.execute(call.name, call.args ?? {});
            toolCallCount += 1;
            if (!usedTools.includes(call.name)) usedTools.push(call.name);
            toolResults.set(call.name, result);
            return { id: call.id, name: call.name, result };
          }),
        );
        contents.push({
          role: "user",
          parts: executed.map(({ id, name, result }) => ({
            functionResponse: {
              ...(id ? { id } : {}),
              name,
              response: { result },
            },
          })),
        });
        if (REQUIRED_AGENT_TOOLS.every((name) => toolResults.has(name))) break;
      }

      const missingTools = REQUIRED_AGENT_TOOLS.filter((name) => !toolResults.has(name));
      if (missingTools.length > 0) {
        throw new Error(`필수 금융 도구가 호출되지 않았습니다: ${missingTools.join(", ")}`);
      }

      const marketToolEvidenceIds = (toolResults.get("getMarketFacts")?.evidence ?? [])
        .map((item) => item.id)
        .filter(Boolean);
      const verifiedInput = {
        ...enrichedInput,
        marketFreshness: {
          ...enrichedInput.marketFreshness,
          evidenceIds: enrichedInput.marketFreshness.fresh ? marketToolEvidenceIds : [],
        },
      };

      const final = await promiseWithinDeadline(
        this.provider.complete(
          [
            {
              role: "system",
              content: [
                "당신은 KB스타뱅킹 자녀 자산관리 서비스의 PortfolioAdvisorAgent입니다.",
                "제공된 도구 결과만 사용하고 요청된 JSON 객체만 반환하세요.",
                "상품·금액·세금·수수료를 직접 생성하지 마세요.",
              ].join("\n"),
            },
            { role: "user", content: finalProposalPrompt(verifiedInput, toolResults) },
          ],
          ALLOCATION_RESPONSE_SCHEMA,
        ),
        deadline,
      );
      const originalProposal = extractJson(final.content);
      const validation = validator.validate(originalProposal, verifiedInput);
      const analysis = buildToolAnalysis(verifiedInput, toolResults);
      const baseAgentRun = {
        mode: "gemini_tools",
        usedTools,
        toolCallCount,
        turns,
      };
      if (validation.valid) {
        return {
          status: "validated",
          provider: "gemini",
          model: final.model,
          originalProposal,
          proposal: originalProposal,
          adjustments: [],
          consideredFactors: arrayOfStrings(originalProposal.consideredFactors).slice(0, 3),
          analysis,
          marketDataStatus: marketFreshness,
          agentRun: { ...baseAgentRun, validation: "passed" },
          message: "AI 에이전트가 금융 도구 확인과 정책 검증을 완료했습니다.",
        };
      }

      const repairedProposal = validator.repair(originalProposal, verifiedInput);
      const repairedValidation = validator.validate(repairedProposal, verifiedInput);
      if (repairedValidation.valid) {
        return {
          status: "adjusted",
          provider: "gemini",
          model: final.model,
          originalProposal,
          proposal: repairedProposal,
          adjustments: validation.violations,
          consideredFactors: arrayOfStrings(repairedProposal.consideredFactors).slice(0, 3),
          analysis,
          marketDataStatus: marketFreshness,
          agentRun: { ...baseAgentRun, validation: "adjusted" },
          message: "AI 에이전트 추천을 금융 기준에 맞게 보정해 반영했습니다.",
        };
      }
      return fallbackResult(
        enrichedInput,
        new Error("AI 에이전트 추천을 안전한 범위로 보정하지 못했습니다."),
        analysis,
        repairedValidation.violations,
        { ...baseAgentRun, validation: "fallback" },
      );
    } catch (error) {
      return fallbackResult(enrichedInput, error, null, [], {
        mode: "deterministic",
        usedTools,
        toolCallCount,
        turns,
        validation: "fallback",
      });
    }
  }
}

export async function runPortfolioAdvisor({ provider, input, ...options }) {
  return new PortfolioAdvisorAgent({ provider, ...options }).run(input);
}
