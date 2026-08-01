const MAX_REASONS = 3;
const MAX_REASON_LENGTH = 88;

function cleanText(value) {
  return String(value ?? "")
    .replace(/^(?:[-*•]\s+|\d+[.)]\s*)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(value, maximum = MAX_REASON_LENGTH) {
  const text = cleanText(value);
  if (text.length <= maximum) return text;
  const candidate = text.slice(0, maximum - 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(maximum * 0.6) ? lastSpace : maximum - 1;
  return `${candidate.slice(0, cutAt).trim()}…`;
}

function asSentence(value) {
  const text = shorten(value);
  if (!text) return "";
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function friendlyFactor(value, context) {
  const factor = cleanText(value);
  if (!factor) return "";
  if (/[.!?…]$/.test(factor) || factor.length >= 28) return asSentence(factor);
  if (/세금|수수료|비용|보수/.test(factor)) {
    return "세금과 수수료를 차감한 순효과를 함께 고려했어요.";
  }
  if (/기간|만기|안전장치/.test(factor)) {
    return `${context.horizonYears}년 투자기간과 기간별 안전장치를 반영했어요.`;
  }
  if (/KB|상품|적합|가입/.test(factor)) {
    return "가입 가능한 KB 상품과 현재 보유상품을 우선 검토했어요.";
  }
  if (/선호|순위|성향/.test(factor)) {
    return "입력한 자산과 투자 방식의 선호 순위를 반영했어요.";
  }
  return asSentence(`${factor}을 고려했어요`);
}

function uniqueReasons(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const sentence = asSentence(value);
    const key = sentence.replace(/[\s.!?…]/g, "").toLowerCase();
    if (!sentence || seen.has(key)) continue;
    seen.add(key);
    result.push(sentence);
    if (result.length === MAX_REASONS) break;
  }
  return result;
}

function baselineReasons(context) {
  const holdingReason = context.heldProductCount > 0
    ? `현재 보유 중인 적합한 KB 상품 ${context.heldProductCount}개를 우선 유지하고 부족한 비중을 채워요.`
    : "가입 가능한 KB 상품 안에서 부족한 자산군을 우선 채워요.";
  return [
    `1순위인 ${context.primaryAssetLabel} 선호와 ${context.horizonYears}년 투자기간을 함께 반영했어요.`,
    `${context.equityStyle}과 ${context.marketPreference} 선호를 주식 자산 구성에 반영했어요.`,
    holdingReason,
  ];
}

function adjustmentMessage(adjustments) {
  const combined = adjustments.map(cleanText).filter(Boolean).join(" ");
  if (!combined) return "금융상품 적합성 기준에 맞춰 AI 원안을 조정했어요.";
  if (/3년|5년|기간|ETF|주식|성장자산|비중|100%/.test(combined)) {
    return "투자기간에 맞춰 ETF·주식 비중을 안전 범위로 조정했어요.";
  }
  if (/상품|후보|허용|자산군|중복|가입/.test(combined)) {
    return "가입 가능한 KB 상품만 남도록 추천 상품을 조정했어요.";
  }
  return "금융상품 적합성 기준에 맞춰 AI 원안을 조정했어요.";
}

/**
 * @param {{
 *   advice: null | {
 *     status: "validated" | "adjusted" | "fallback";
 *     consideredFactors?: string[];
 *     adjustments?: string[];
 *     proposal?: { summary?: string };
 *   };
 *   loading?: boolean;
 *   stale?: boolean;
 *   context: {
 *     primaryAssetLabel: string;
 *     equityStyle: string;
 *     marketPreference: string;
 *     horizonYears: number;
 *     heldProductCount: number;
 *   };
 * }} input
 */
export function buildRecommendationRationale({ advice, loading = false, stale = false, context }) {
  const baseline = uniqueReasons(baselineReasons(context));

  if (stale) {
    return {
      state: "stale",
      intro: "입력 내용이 변경되어 AI 추천 근거를 다시 분석해야 합니다.",
      reasons: baseline,
      adjustment: null,
    };
  }
  if (loading) {
    return {
      state: "loading",
      intro: "AI가 입력한 선호와 투자기간을 바탕으로 추천 근거를 분석하고 있습니다.",
      reasons: baseline,
      adjustment: null,
    };
  }
  if (!advice) {
    return {
      state: "baseline",
      intro: "현재 입력을 바탕으로 구성한 기본 추천의 근거입니다.",
      reasons: baseline,
      adjustment: null,
    };
  }
  if (advice.status === "fallback") {
    return {
      state: "fallback",
      intro: "AI 연결 실패로, 입력한 선호와 투자기간을 바탕으로 구성한 기준안입니다.",
      reasons: baseline,
      adjustment: null,
    };
  }

  const aiReasons = uniqueReasons([
    advice.proposal?.summary,
    ...(advice.consideredFactors ?? []).map((factor) => friendlyFactor(factor, context)),
    ...baseline,
  ]);
  return {
    state: advice.status,
    intro: advice.status === "adjusted"
      ? "AI 제안을 금융 기준에 맞게 보정한 최종 추천의 근거입니다."
      : "정책 검증을 통과해 실제 추천 포트폴리오에 반영한 근거입니다.",
    reasons: aiReasons,
    adjustment: advice.status === "adjusted"
      ? adjustmentMessage(advice.adjustments ?? [])
      : null,
  };
}
