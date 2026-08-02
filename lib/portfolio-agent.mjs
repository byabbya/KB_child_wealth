import { ASSET_CLASSES, ASSET_LABELS } from "./engine.mjs";

const GROWTH_ASSETS = [
  "domesticEtf",
  "overseasEtf",
  "domesticStock",
  "overseasStock",
];
const INDIVIDUAL_STOCKS = ["domesticStock", "overseasStock"];
const SAFE_ASSETS = ["cash", "savings", "deposit", "fund"];
const OUTLOOKS = ["positive", "neutral", "cautious"];
const CONFIDENCE_LEVELS = ["low", "medium", "high"];

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

export const USER_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    preferenceInsights: { type: "array", items: { type: "string" } },
    goalGapInsight: { type: "string" },
    concentrationRisks: { type: "array", items: { type: "string" } },
    liquidityNeeds: { type: "array", items: { type: "string" } },
  },
  required: [
    "summary",
    "preferenceInsights",
    "goalGapInsight",
    "concentrationRisks",
    "liquidityNeeds",
  ],
};

export const MARKET_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    domesticOutlook: { type: "string", enum: OUTLOOKS },
    usOutlook: { type: "string", enum: OUTLOOKS },
    etfOutlook: { type: "string", enum: OUTLOOKS },
    individualOutlook: { type: "string", enum: OUTLOOKS },
    confidence: { type: "string", enum: CONFIDENCE_LEVELS },
    riskFactors: { type: "array", items: { type: "string" } },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
  required: [
    "summary",
    "domesticOutlook",
    "usOutlook",
    "etfOutlook",
    "individualOutlook",
    "confidence",
    "riskFactors",
    "evidenceIds",
  ],
};

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

export class GeminiLlmProvider {
  constructor({
    apiKey,
    model = "gemini-2.5-flash",
    timeoutMs = 20_000,
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
              temperature: 0.2,
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
    } finally {
      clearTimeout(timer);
    }
  }
}

function baseSystemPrompt(role) {
  return [
    `당신은 KB스타뱅킹 자녀 자산관리 서비스의 ${role}입니다.`,
    "제공된 사실만 사용하고 금융자문처럼 단정하지 마세요.",
    "세금, 수수료, 상품조건을 새로 계산하거나 수정하지 마세요.",
    "반드시 요청된 JSON 객체만 반환하세요.",
  ].join("\n");
}

function userAnalysisPrompt(input) {
  return JSON.stringify(
    {
      child: input.child,
      profile: input.profile,
      currentPortfolio: input.currentPortfolio,
      policyFacts: input.policyFacts,
      instructions: [
        "자산·투자방식 순위를 해석할 것",
        "목표금액과 현재 자산의 차이를 설명할 것",
        "현재 보유자산 집중도와 유동성 요구를 설명할 것",
        "상품을 추천하거나 세금·수수료를 계산하지 말 것",
      ],
    },
    null,
    2,
  );
}

function marketAnalysisPrompt(input) {
  return JSON.stringify(
    {
      snapshot: input.marketSnapshot,
      validEvidenceIds: input.marketFreshness.evidenceIds,
      instructions: [
        "국내·미국시장과 ETF·개별종목 전망을 positive, neutral, cautious 중 하나로 작성",
        "수익률을 예측하지 말고 방향성과 위험요인만 설명",
        "evidenceIds에는 제공된 ID만 사용",
        "상품을 추천하거나 세금·수수료를 계산하지 말 것",
      ],
    },
    null,
    2,
  );
}

function allocationPrompt(input, userAnalysis, marketAnalysis) {
  return JSON.stringify(
    {
      userAnalysis,
      marketAnalysis,
      baselineAllocation: input.deterministicProposal.allocations,
      profile: input.profile,
      policyFacts: input.policyFacts,
      validMarketEvidenceIds: input.marketFreshness.fresh
        ? input.marketFreshness.evidenceIds
        : [],
      constraints: {
        totalWeight: 100,
        maximumDriftFromBaselinePercentagePoints: 5,
        growthAssetMaximum: growthCap(input.profile),
        individualStockMaximum:
          input.profile.horizonYears >= 3 && input.profile.horizonYears <= 5 ? 10 : null,
      },
      instructions: [
        "8개 자산군 비중과 근거만 작성",
        "상품 ID, 상품명, 금액, 금리, 세금, 수수료를 작성하지 말 것",
        "시장자료가 중립 또는 오래된 경우 사용자 분석과 기준안을 우선할 것",
        "시장 근거는 validMarketEvidenceIds에 있는 값만 사용할 것",
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

function sanitizeUserAnalysis(raw) {
  if (!raw || typeof raw !== "object" || !String(raw.summary ?? "").trim()) {
    throw new Error("Gemini 사용자 분석 형식이 올바르지 않습니다.");
  }
  return {
    status: "ai",
    summary: String(raw.summary).trim(),
    preferenceInsights: arrayOfStrings(raw.preferenceInsights),
    goalGapInsight: String(raw.goalGapInsight ?? "").trim(),
    concentrationRisks: arrayOfStrings(raw.concentrationRisks),
    liquidityNeeds: arrayOfStrings(raw.liquidityNeeds),
  };
}

function sanitizeMarketAnalysis(raw, input) {
  if (!raw || typeof raw !== "object" || !String(raw.summary ?? "").trim()) {
    throw new Error("Gemini 시장 분석 형식이 올바르지 않습니다.");
  }
  const allowed = new Set(input.marketFreshness.evidenceIds);
  const used = arrayOfStrings(raw.evidenceIds);
  if (used.some((id) => !allowed.has(id))) {
    throw new Error("Gemini 시장 분석에 확인되지 않은 근거가 포함되었습니다.");
  }
  return {
    status: "ai",
    summary: String(raw.summary).trim(),
    domesticOutlook: OUTLOOKS.includes(raw.domesticOutlook) ? raw.domesticOutlook : "neutral",
    usOutlook: OUTLOOKS.includes(raw.usOutlook) ? raw.usOutlook : "neutral",
    etfOutlook: OUTLOOKS.includes(raw.etfOutlook) ? raw.etfOutlook : "neutral",
    individualOutlook: OUTLOOKS.includes(raw.individualOutlook)
      ? raw.individualOutlook
      : "neutral",
    confidence: CONFIDENCE_LEVELS.includes(raw.confidence) ? raw.confidence : "low",
    riskFactors: arrayOfStrings(raw.riskFactors),
    evidenceIds: used,
  };
}

function fallbackResult(input, error, analysis = null, adjustments = []) {
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
    message: `Gemini 연결 실패 · 규칙 기반 추천 (${error?.message ?? "원인 미확인"})`,
  };
}

export async function runPortfolioAdvisor({ provider, input }) {
  const marketFreshness = evaluateMarketSnapshot(
    input.marketSnapshot,
    input.policyFacts?.asOf,
  );
  const enrichedInput = { ...input, marketFreshness };
  if (!provider) {
    return fallbackResult(enrichedInput, new Error("Gemini API 키가 설정되지 않았습니다."));
  }

  const userPromise = provider.complete(
    [
      { role: "system", content: baseSystemPrompt("사용자 분석가") },
      { role: "user", content: userAnalysisPrompt(enrichedInput) },
    ],
    USER_ANALYSIS_SCHEMA,
  );
  const marketPromise = marketFreshness.fresh
    ? provider.complete(
        [
          { role: "system", content: baseSystemPrompt("시장 분석가") },
          { role: "user", content: marketAnalysisPrompt(enrichedInput) },
        ],
        MARKET_ANALYSIS_SCHEMA,
      )
    : Promise.resolve(null);

  const [userResult, marketResult] = await Promise.allSettled([
    userPromise,
    marketPromise,
  ]);
  let userAnalysis = deterministicUserAnalysis(enrichedInput);
  let marketAnalysis = neutralMarketAnalysis(enrichedInput);
  try {
    if (userResult.status === "fulfilled") {
      userAnalysis = sanitizeUserAnalysis(extractJson(userResult.value.content));
    }
  } catch {
    userAnalysis = deterministicUserAnalysis(enrichedInput);
  }
  try {
    if (marketResult.status === "fulfilled" && marketResult.value) {
      marketAnalysis = sanitizeMarketAnalysis(
        extractJson(marketResult.value.content),
        enrichedInput,
      );
    }
  } catch {
    marketAnalysis = neutralMarketAnalysis(enrichedInput, "fallback");
  }

  const analysis = { user: userAnalysis, market: marketAnalysis };
  const validator = new PortfolioPolicyValidator();
  try {
    const optimized = await provider.complete(
      [
        { role: "system", content: baseSystemPrompt("자산배분 최적화 담당자") },
        {
          role: "user",
          content: allocationPrompt(enrichedInput, userAnalysis, marketAnalysis),
        },
      ],
      ALLOCATION_RESPONSE_SCHEMA,
    );
    const originalProposal = extractJson(optimized.content);
    const validation = validator.validate(originalProposal, enrichedInput);
    if (validation.valid) {
      return {
        status: "validated",
        provider: "gemini",
        model: optimized.model,
        originalProposal,
        proposal: originalProposal,
        adjustments: [],
        consideredFactors: arrayOfStrings(originalProposal.consideredFactors),
        analysis,
        marketDataStatus: marketFreshness,
        message: "Gemini 추천이 금융 기준 검증을 통과했습니다.",
      };
    }

    const repairedProposal = validator.repair(originalProposal, enrichedInput);
    const repairedValidation = validator.validate(repairedProposal, enrichedInput);
    if (repairedValidation.valid) {
      return {
        status: "adjusted",
        provider: "gemini",
        model: optimized.model,
        originalProposal,
        proposal: repairedProposal,
        adjustments: validation.violations,
        consideredFactors: arrayOfStrings(repairedProposal.consideredFactors),
        analysis,
        marketDataStatus: marketFreshness,
        message: "Gemini 추천을 금융 기준에 맞게 보정해 반영했습니다.",
      };
    }
    return fallbackResult(
      enrichedInput,
      new Error("Gemini 추천을 안전한 범위로 보정하지 못했습니다."),
      analysis,
      repairedValidation.violations,
    );
  } catch (error) {
    return fallbackResult(enrichedInput, error, analysis);
  }
}
