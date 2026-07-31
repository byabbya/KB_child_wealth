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
      for (const recommendation of proposal.recommendations) {
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
  } = {}) {
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

  async complete(messages) {
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
          format: "json",
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

export class ExternalLlmProvider {
  constructor() {
    this.name = "external-unconfigured";
  }

  async complete() {
    throw new Error("외부 LLM 제공자와 API 규격이 아직 설정되지 않았습니다.");
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
    const first = await provider.complete([
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(input) },
    ]);
    const originalProposal = extractJson(first.content);
    let validation = validator.validate(originalProposal, input);
    if (validation.valid) {
      return {
        status: "validated",
        provider: "ollama",
        model: first.model,
        originalProposal,
        proposal: originalProposal,
        adjustments: [],
        consideredFactors: originalProposal.consideredFactors ?? [],
        message: "AI 제안이 모든 금융 규칙을 통과했습니다.",
      };
    }

    const repair = await provider.complete([
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(input) },
      { role: "assistant", content: JSON.stringify(originalProposal) },
      {
        role: "user",
        content: `다음 위반을 모두 수정해 JSON만 다시 반환하세요: ${validation.violations.join(" / ")}`,
      },
    ]);
    const repairedProposal = extractJson(repair.content);
    validation = validator.validate(repairedProposal, input);
    if (validation.valid) {
      return {
        status: "adjusted",
        provider: "ollama",
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
