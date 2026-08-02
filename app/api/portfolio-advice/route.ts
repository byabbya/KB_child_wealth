import {
  GeminiLlmProvider,
  PortfolioAdvisorAgent,
} from "@/lib/portfolio-agent.mjs";
import { prototypeCatalog } from "@/lib/catalog";
import { generatePlan } from "@/lib/engine.mjs";

const ASSET_RANKING = ["savings", "deposit", "stock", "bond"] as const;
const STRATEGY_RANKING = ["etf", "individual", "us", "domestic"] as const;

function validRanking(value: unknown, allowed: readonly string[]) {
  return Array.isArray(value) &&
    value.length === allowed.length &&
    new Set(value).size === allowed.length &&
    value.every((item) => allowed.includes(String(item)));
}

function parseRequest(body: Record<string, unknown>) {
  const raw = body.profile as Record<string, unknown> | undefined;
  if (!raw ||
      !validRanking(raw.assetRanking, ASSET_RANKING) ||
      !validRanking(raw.strategyRanking, STRATEGY_RANKING)) {
    throw new Error("선호 순위는 네 항목을 중복 없이 포함해야 합니다.");
  }
  const horizonYears = Number(raw.horizonYears);
  const monthlyContribution = Number(raw.monthlyContribution);
  if (!Number.isFinite(horizonYears) || horizonYears < 1 || horizonYears > 30) {
    throw new Error("투자기간은 1~30년 범위여야 합니다.");
  }
  if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0 || monthlyContribution > 10_000_000) {
    throw new Error("월 저축액이 허용 범위를 벗어났습니다.");
  }
  const rawGift = body.proposedGift as Record<string, unknown> | undefined;
  const proposedGift = rawGift
    ? {
        date: String(rawGift.date ?? ""),
        amount: Number(rawGift.amount ?? 0),
        donorId: String(rawGift.donorId ?? "parent-father"),
        donorGroupId: String(rawGift.donorGroupId ?? "parent-couple"),
        donorRelationship: String(rawGift.donorRelationship ?? "부"),
      }
    : null;
  if (proposedGift &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(proposedGift.date) ||
        !Number.isFinite(proposedGift.amount) || proposedGift.amount < 0)) {
    throw new Error("증여 시뮬레이션 입력값이 올바르지 않습니다.");
  }
  return {
    profile: {
      assetRanking: [...raw.assetRanking as string[]],
      strategyRanking: [...raw.strategyRanking as string[]],
      horizonYears,
      monthlyContribution,
    },
    proposedGift,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 JSON을 읽을 수 없습니다." }, { status: 400 });
  }

  let requestInput: ReturnType<typeof parseRequest>;
  try {
    requestInput = parseRequest(body);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "요청값이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  // 브라우저가 보낸 정책 사실이나 기준 비중은 사용하지 않고 서버의 원본 데이터로 다시 계산합니다.
  const plan = generatePlan({
    bankProducts: prototypeCatalog.bankProducts,
    securitiesAssets: prototypeCatalog.securitiesAssets,
    data: prototypeCatalog.data,
    profile: requestInput.profile,
    proposedGift: requestInput.proposedGift,
    giftTaxRules: prototypeCatalog.giftTaxRules,
    investmentTaxRules: prototypeCatalog.investmentTaxRules,
    feeAssumptions: prototypeCatalog.feeAssumptions,
    productPolicies: prototypeCatalog.productPolicies,
  });
  const child = prototypeCatalog.data.children[0];
  const deterministicProposal = {
    allocations: plan.target,
    allocationRationales: plan.recommendations.map((item: Record<string, unknown>) => ({
      assetClass: item.assetClass,
      rationale: item.reason,
      evidenceIds: [],
    })),
    consideredFactors: [plan.preference.label, `${requestInput.profile.horizonYears}년 투자기간`],
    assumptions: ["고정 샘플 시나리오"],
    summary: "입력한 선호와 투자기간에 금융 기준을 적용한 기준 포트폴리오입니다.",
  };
  const agentInput = {
    child: {
      name: child.name,
      age: plan.age,
      goal: child.goal,
      goalAmount: child.goalAmount,
    },
    profile: requestInput.profile,
    policyFacts: plan.policyFacts,
    currentPortfolio: plan.current,
    marketSnapshot: prototypeCatalog.marketSnapshot,
    deterministicProposal,
    toolContext: {
      eligibleProducts: plan.recommendations,
      investmentTaxRules: prototypeCatalog.investmentTaxRules,
      feeAssumptions: prototypeCatalog.feeAssumptions,
      earlyTerminationWarnings: plan.rebalancing.holds
        .filter((item: Record<string, unknown>) => item.keep)
        .map((item: Record<string, unknown>) => ({
          productName: item.productName,
          reason: item.reason,
          maturityDate: item.maturityDate,
        })),
    },
  };

  const provider = process.env.GEMINI_API_KEY
    ? new GeminiLlmProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        timeoutMs: 9_000,
      })
    : null;

  const result = await new PortfolioAdvisorAgent({ provider }).run(agentInput);
  return Response.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
