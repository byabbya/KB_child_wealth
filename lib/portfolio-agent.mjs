import { ASSET_CLASSES } from "./engine.mjs";

const GROWTH_ASSETS = [
  "domesticEtf",
  "overseasEtf",
  "domesticStock",
  "overseasStock",
];
const INDIVIDUAL_STOCKS = ["domesticStock", "overseasStock"];

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

export const PORTFOLIO_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    allocations: {
      type: "object",
      properties: Object.fromEntries(
        ASSET_CLASSES.map((key) => [key, { type: "number", minimum: 0, maximum: 100 }]),
      ),
      required: ASSET_CLASSES,
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          assetClass: { type: "string", enum: ASSET_CLASSES },
          productId: { type: "string" },
          weight: { type: "number", minimum: 0, maximum: 100 },
          amount: { type: "number", minimum: 0 },
          action: {
            type: "string",
            enum: ["유지", "추가입금", "만기재배분", "매도검토"],
          },
          rationale: { type: "string" },
        },
        required: ["assetClass", "productId", "weight", "amount", "action", "rationale"],
      },
    },
    consideredFactors: { type: "array", items: { type: "string" } },
    alternatives: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "allocations",
    "recommendations",
    "consideredFactors",
    "alternatives",
    "assumptions",
    "summary",
  ],
};

export class PortfolioPolicyValidator {
  validate(proposal, input) {
    const violations = [];
    if (!proposal || typeof proposal !== "object") {
      return { valid: false, violations: ["응답이 객체가 아닙니다."] };
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
      }
      const total = sum(ASSET_CLASSES.map((key) => allocations[key]));
      if (Math.abs(total - 100) > 0.2) {
        violations.push(`비중 합계가 ${total.toFixed(1)}%로 100%가 아닙니다.`);
      }
      const growth = sum(GROWTH_ASSETS.map((key) => allocations[key]));
      const individual = sum(INDIVIDUAL_STOCKS.map((key) => allocations[key]));
      if (input.profile.horizonYears < 3 && growth > 20.01) {
        violations.push("3년 미만 투자기간의 ETF·개별주식 합계가 20%를 초과합니다.");
      }
      if (input.profile.horizonYears >= 3 && input.profile.horizonYears <= 5) {
        if (growth > 45.01) violations.push("3~5년 투자기간의 성장자산 합계가 45%를 초과합니다.");
        if (individual > 10.01) violations.push("3~5년 투자기간의 개별주식 합계가 10%를 초과합니다.");
      }
    }

    const allowedIds = new Set(input.allowedCandidates.map((item) => item.id));
    if (!Array.isArray(proposal.recommendations)) {
      violations.push("recommendations 배열이 없습니다.");
    } else {
      const seenClasses = new Set();
      const seenProducts = new Set();
      for (const recommendation of proposal.recommendations) {
        if (seenClasses.has(recommendation.assetClass)) {
          violations.push(`${recommendation.assetClass} 자산군 추천이 중복되었습니다.`);
        }
        if (seenProducts.has(recommendation.productId)) {
          violations.push(`${recommendation.productId} 상품이 중복 추천되었습니다.`);
        }
        seenClasses.add(recommendation.assetClass);
        seenProducts.add(recommendation.productId);
        if (!allowedIds.has(recommendation.productId)) {
          violations.push(`허용되지 않은 상품 ${recommendation.productId}이 포함되었습니다.`);
        }
        const candidate = input.allowedCandidates.find(
          (item) => item.id === recommendation.productId,
        );
        if (candidate && candidate.assetClass !== recommendation.assetClass) {
          violations.push(
            `${recommendation.productId}의 자산군이 ${recommendation.assetClass}로 잘못 지정되었습니다.`,
          );
        }
        const allocationWeight = Number(allocations?.[recommendation.assetClass]);
        if (
          Number.isFinite(allocationWeight) &&
          Math.abs(Number(recommendation.weight) - allocationWeight) > 0.2
        ) {
          violations.push(
            `${recommendation.assetClass} 추천 비중이 자산군 비중과 일치하지 않습니다.`,
          );
        }
        if (!["유지", "추가입금", "만기재배분", "매도검토"].includes(recommendation.action)) {
          violations.push(`${recommendation.assetClass}의 조치 값이 허용 범위를 벗어났습니다.`);
        }
      }
      if (allocations && typeof allocations === "object") {
        for (const key of ASSET_CLASSES) {
          if (Number(allocations[key]) > 0 && !seenClasses.has(key)) {
            violations.push(`${key} 양수 비중에 대응하는 상품 추천이 없습니다.`);
          }
          if (Number(allocations[key]) <= 0 && seenClasses.has(key)) {
            violations.push(`${key} 비중이 0인데 상품이 추천되었습니다.`);
          }
        }
      }
    }

    if (proposal.taxFacts || proposal.giftTax || proposal.fees) {
      violations.push("AI가 규칙 엔진의 세금·수수료 사실을 덮어쓰려 했습니다.");
    }
    return { valid: violations.length === 0, violations };
  }
}

export class OllamaLlmProvider {
  constructor({
    baseUrl = "http://127.0.0.1:11434",
    model = null,
    timeoutMs = 12_000,
  } = /** @type {{ baseUrl?: string; model?: string | null; timeoutMs?: number }} */ ({})) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async resolveModel(signal) {
    if (this.model) return this.model;
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal });
    if (!response.ok) throw new Error(`Ollama 모델 조회 실패 (${response.status})`);
    const data = await response.json();
    const model = data.models?.[0]?.name;
    if (!model) throw new Error("Ollama에 설치된 모델이 없습니다.");
    return model;
  }

  async complete(messages, responseSchema = PORTFOLIO_RESPONSE_SCHEMA) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const model = await this.resolveModel(controller.signal);
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          format: responseSchema,
          options: { temperature: 0.2 },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Ollama 호출 실패 (${response.status})`);
      const data = await response.json();
      return {
        model,
        content: data.message?.content ?? "",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class GeminiLlmProvider {
  constructor({
    apiKey,
    model = "gemini-3.6-flash",
    timeoutMs = 15_000,
  } = /** @type {{ apiKey?: string; model?: string; timeoutMs?: number }} */ ({})) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.name = "gemini";
  }

  async complete(messages, responseSchema = PORTFOLIO_RESPONSE_SCHEMA) {
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
      if (!content) throw new Error("Gemini가 포트폴리오 JSON을 반환하지 않았습니다.");
      return { model: this.model, content };
    } finally {
      clearTimeout(timer);
    }
  }
}

function systemPrompt() {
  return [
    "당신은 KB스타뱅킹 자녀 자산관리 프로토타입의 PortfolioAdvisorAgent입니다.",
    "제공된 규칙 엔진 사실과 허용된 KB 상품만 사용해 자산 비중과 상품 조합을 제안합니다.",
    "세금, 수수료, 가입 가능 여부를 새로 계산하거나 수정하지 마세요.",
    "반드시 JSON 객체만 반환하세요.",
    "형식:",
    JSON.stringify({
      allocations: Object.fromEntries(ASSET_CLASSES.map((key) => [key, 0])),
      recommendations: [
        {
          assetClass: "savings",
          productId: "허용된 상품 ID",
          weight: 0,
          amount: 0,
          action: "유지|추가입금|만기재배분|매도검토",
          rationale: "근거",
        },
      ],
      consideredFactors: ["선호", "기간", "세금·비용 사실"],
      alternatives: ["대안"],
      assumptions: ["가정"],
      summary: "보호자에게 보여줄 짧은 설명",
    }),
  ].join("\n");
}

function userPrompt(input) {
  return JSON.stringify(
    {
      fixedSampleChild: input.child,
      preferenceProfile: input.profile,
      policyFacts: input.policyFacts,
      allowedKbCandidates: input.allowedCandidates,
      deterministicBaseline: input.deterministicProposal,
      instructions: [
        "비중 합계는 100%로 작성",
        "선호 순위는 반영하되 투자기간 안전장치를 지킬 것",
        "보유 중인 적합 상품과 신규자금을 우선 활용",
        "중도해지 손실이 큰 예·적금은 유지",
        "상품 ID는 allowedKbCandidates에 있는 값만 사용",
      ],
    },
    null,
    2,
  );
}

function fallbackResult(input, error, violations = []) {
  return {
    status: "fallback",
    provider: "deterministic",
    model: null,
    originalProposal: null,
    proposal: input.deterministicProposal,
    adjustments: violations,
    consideredFactors: [
      "두 개의 선호 순위",
      "남은 투자기간 안전장치",
      "검증된 KB 상품 후보",
      "증여세·세금·수수료 규칙",
    ],
    message: `AI 연결 실패 · 규칙 기반 대체 결과 (${error?.message ?? "원인 미확인"})`,
  };
}

export async function runPortfolioAdvisor({ provider, input }) {
  if (!provider) {
    return fallbackResult(input, new Error("배포 환경의 외부 LLM이 설정되지 않았습니다."));
  }
  const validator = new PortfolioPolicyValidator();
  try {
    const first = await provider.complete(
      [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userPrompt(input) },
      ],
      PORTFOLIO_RESPONSE_SCHEMA,
    );
    const originalProposal = extractJson(first.content);
    let validation = validator.validate(originalProposal, input);
    if (validation.valid) {
      return {
        status: "validated",
        provider: provider.name ?? "ollama",
        model: first.model,
        originalProposal,
        proposal: originalProposal,
        adjustments: [],
        consideredFactors: originalProposal.consideredFactors ?? [],
        message: "AI 제안이 모든 금융 규칙을 통과했습니다.",
      };
    }

    const repair = await provider.complete(
      [
        { role: "system", content: systemPrompt() },
        { role: "user", content: userPrompt(input) },
        { role: "assistant", content: JSON.stringify(originalProposal) },
        {
          role: "user",
          content: `다음 위반을 모두 수정해 JSON만 다시 반환하세요: ${validation.violations.join(" / ")}`,
        },
      ],
      PORTFOLIO_RESPONSE_SCHEMA,
    );
    const repairedProposal = extractJson(repair.content);
    validation = validator.validate(repairedProposal, input);
    if (validation.valid) {
      return {
        status: "adjusted",
        provider: provider.name ?? "ollama",
        model: repair.model,
        originalProposal,
        proposal: repairedProposal,
        adjustments: validator.validate(originalProposal, input).violations,
        consideredFactors: repairedProposal.consideredFactors ?? [],
        message: "AI 원안의 정책 위반을 한 번 보정해 최종 제안으로 사용했습니다.",
      };
    }
    return fallbackResult(
      input,
      new Error("AI 수정안도 정책 검증을 통과하지 못했습니다."),
      validation.violations,
    );
  } catch (error) {
    return fallbackResult(input, error);
  }
}
