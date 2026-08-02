"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { prototypeCatalog } from "@/lib/catalog";
import {
  ASSET_CLASSES,
  ASSET_LABELS,
  applyAdvisorProposal,
  generatePlan,
} from "@/lib/engine.mjs";
import { StaticProductLinkProvider } from "@/lib/providers";
import { buildRecommendationRationale } from "@/lib/recommendation-rationale.mjs";

const STORAGE_KEY = "kb-child-portfolio-prototype:v5";
const PREVIOUS_STORAGE_KEY = "kb-child-portfolio-prototype:v4";
const OLDER_STORAGE_KEY = "kb-child-portfolio-prototype:v3";
const LEGACY_STORAGE_KEY = "kb-child-portfolio-demo:v1";
const COLORS: Record<string, string> = {
  cash: "#8c8c8c",
  savings: "#f0b90b",
  deposit: "#ffcf33",
  fund: "#685b4d",
  domesticEtf: "#3a6ea5",
  overseasEtf: "#5b8def",
  domesticStock: "#7459b8",
  overseasStock: "#9a73d9",
};
const LABELS = ASSET_LABELS as Record<string, string>;

type AssetPreference = "savings" | "deposit" | "stock" | "bond";
type StrategyPreference = "etf" | "individual" | "us" | "domestic";
type ProductFilter = "all" | "bank" | "etf" | "fund" | "stock";
type ResultTab = "portfolio" | "products" | "rebalance";
type PortfolioPlan = ReturnType<typeof generatePlan>;
type PortfolioRecommendation = PortfolioPlan["recommendations"][number];

type PreferenceProfile = {
  horizonYears: number;
  monthlyContribution: number;
  assetRanking: AssetPreference[];
  strategyRanking: StrategyPreference[];
};

const ASSET_PREFERENCE_LABELS: Record<AssetPreference, string> = {
  savings: "적금",
  deposit: "예금",
  stock: "주식",
  bond: "채권",
};
const STRATEGY_PREFERENCE_LABELS: Record<StrategyPreference, string> = {
  etf: "ETF 중심",
  individual: "개별종목 중심",
  us: "미주 중심",
  domestic: "국내종목 중심",
};

type PrototypeState = {
  activeTab: ResultTab;
  horizonYears: number;
  monthlyContribution: number;
  assetRanking: AssetPreference[];
  strategyRanking: StrategyPreference[];
  previousProfile: PreferenceProfile;
  proposedGift: {
    date: string;
    amount: number;
    donorId: string;
    donorGroupId: string;
    donorRelationship: string;
    memo: string;
  };
};

type AiAdvice = {
  status: "validated" | "adjusted" | "fallback";
  provider: string;
  model: string | null;
  message: string;
  consideredFactors: string[];
  adjustments: string[];
  originalProposal: {
    summary?: string;
    allocations?: Record<string, number>;
  } | null;
  proposal: {
    summary?: string;
    allocations: Record<string, number>;
    allocationRationales?: Array<{
      assetClass: string;
      rationale: string;
      evidenceIds: string[];
    }>;
    assumptions?: string[];
  };
  analysis?: {
    user: {
      status: string;
      summary: string;
      preferenceInsights: string[];
      goalGapInsight: string;
      concentrationRisks: string[];
      liquidityNeeds: string[];
    };
    market: {
      status: string;
      summary: string;
      domesticOutlook: "positive" | "neutral" | "cautious";
      usOutlook: "positive" | "neutral" | "cautious";
      etfOutlook: "positive" | "neutral" | "cautious";
      individualOutlook: "positive" | "neutral" | "cautious";
      confidence: "low" | "medium" | "high";
      riskFactors: string[];
      evidenceIds: string[];
    };
  };
  marketDataStatus?: {
    fresh: boolean;
    status: "fresh" | "stale";
    asOf: string | null;
    evidenceIds: string[];
    warning: string | null;
  };
};

type MockLink = ReturnType<StaticProductLinkProvider["getLink"]>;
type SelectedItem = Record<string, unknown> & {
  name?: string;
  mockLink: MockLink;
};

const initialState: PrototypeState = {
  activeTab: "portfolio",
  horizonYears: 8,
  monthlyContribution: 500000,
  assetRanking: ["savings", "deposit", "stock", "bond"],
  strategyRanking: ["etf", "individual", "us", "domestic"],
  previousProfile: {
    horizonYears: 4,
    monthlyContribution: 400000,
    assetRanking: ["deposit", "savings", "bond", "stock"],
    strategyRanking: ["etf", "domestic", "us", "individual"],
  },
  proposedGift: {
    date: "2026-07-30",
    amount: 5000000,
    donorId: "parent-father",
    donorGroupId: "parent-couple",
    donorRelationship: "부",
    memo: "추가 현금 증여",
  },
};

function isRanking<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return (
    Array.isArray(value) &&
    value.length === allowed.length &&
    value.every((item) => allowed.includes(item)) &&
    new Set(value).size === allowed.length
  );
}

function migrateStoredState(value: unknown): PrototypeState {
  if (!value || typeof value !== "object") return initialState;
  const stored = value as Partial<PrototypeState>;
  const assetKeys: AssetPreference[] = ["savings", "deposit", "stock", "bond"];
  const strategyKeys: StrategyPreference[] = ["etf", "individual", "us", "domestic"];
  return {
    activeTab:
      stored.activeTab === "products" || stored.activeTab === "rebalance"
        ? stored.activeTab
        : "portfolio",
    horizonYears:
      typeof stored.horizonYears === "number" ? stored.horizonYears : initialState.horizonYears,
    monthlyContribution:
      typeof stored.monthlyContribution === "number"
        ? stored.monthlyContribution
        : initialState.monthlyContribution,
    assetRanking: isRanking(stored.assetRanking, assetKeys)
      ? stored.assetRanking
      : initialState.assetRanking,
    strategyRanking: isRanking(stored.strategyRanking, strategyKeys)
      ? stored.strategyRanking
      : initialState.strategyRanking,
    previousProfile:
      stored.previousProfile &&
      typeof stored.previousProfile.horizonYears === "number" &&
      typeof stored.previousProfile.monthlyContribution === "number" &&
      isRanking(stored.previousProfile.assetRanking, assetKeys) &&
      isRanking(stored.previousProfile.strategyRanking, strategyKeys)
        ? stored.previousProfile
        : initialState.previousProfile,
    proposedGift:
      stored.proposedGift &&
      typeof stored.proposedGift === "object" &&
      Number(stored.proposedGift.amount) > 0
        ? stored.proposedGift
        : initialState.proposedGift,
  };
}

function currency(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactCurrency(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억원`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString("ko-KR")}만원`;
  return currency(value);
}

function providerClass(provider: string) {
  return provider === "KB증권" ? "provider provider-securities" : "provider provider-bank";
}

export default function Dashboard() {
  const [state, setState] = useState<PrototypeState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [modal, setModal] = useState<null | "goal" | "assets" | "mock">(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [aiAdvice, setAiAdvice] = useState<AiAdvice | null>(null);
  const [aiAdviceSignature, setAiAdviceSignature] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedAssetClass, setExpandedAssetClass] = useState<string | null>(null);
  const [focusedAssetClass, setFocusedAssetClass] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const linkProvider = useMemo(() => new StaticProductLinkProvider(), []);

  useEffect(() => {
    let storedState: PrototypeState | null = null;
    try {
      const stored =
        window.localStorage.getItem(STORAGE_KEY) ??
        window.localStorage.getItem(PREVIOUS_STORAGE_KEY) ??
        window.localStorage.getItem(OLDER_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (stored) storedState = migrateStoredState(JSON.parse(stored));
    } catch {
      // 손상된 로컬 상태는 안전하게 샘플값으로 대체합니다.
    }
    const timer = window.setTimeout(() => {
      if (storedState) setState(storedState);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const data = prototypeCatalog.data;
  const plan = useMemo(
    () =>
      generatePlan({
        bankProducts: prototypeCatalog.bankProducts,
        securitiesAssets: prototypeCatalog.securitiesAssets,
        data,
        profile: {
          assetRanking: state.assetRanking,
          strategyRanking: state.strategyRanking,
          horizonYears: state.horizonYears,
          monthlyContribution: state.monthlyContribution,
        },
        proposedGift: state.proposedGift,
        giftTaxRules: prototypeCatalog.giftTaxRules,
        investmentTaxRules: prototypeCatalog.investmentTaxRules,
        feeAssumptions: prototypeCatalog.feeAssumptions,
        productPolicies: prototypeCatalog.productPolicies,
      }),
    [
      data,
      state.assetRanking,
      state.horizonYears,
      state.monthlyContribution,
      state.proposedGift,
      state.strategyRanking,
    ],
  );

  const previousPlan = useMemo(
    () =>
      generatePlan({
        bankProducts: prototypeCatalog.bankProducts,
        securitiesAssets: prototypeCatalog.securitiesAssets,
        data,
        profile: state.previousProfile,
        proposedGift: state.proposedGift,
        giftTaxRules: prototypeCatalog.giftTaxRules,
        investmentTaxRules: prototypeCatalog.investmentTaxRules,
        feeAssumptions: prototypeCatalog.feeAssumptions,
        productPolicies: prototypeCatalog.productPolicies,
      }),
    [data, state.previousProfile, state.proposedGift],
  );

  const child = data.children[0];
  const aiInputSignature = JSON.stringify({
    assetRanking: state.assetRanking,
    strategyRanking: state.strategyRanking,
    horizonYears: state.horizonYears,
    monthlyContribution: state.monthlyContribution,
    proposedGift: state.proposedGift,
    marketSnapshotId: prototypeCatalog.marketSnapshot.snapshotId,
  });

  const currentAdvice = aiAdviceSignature === aiInputSignature ? aiAdvice : null;
  const hasStaleAdvice = Boolean(
    aiAdvice && aiAdviceSignature && aiAdviceSignature !== aiInputSignature,
  );

  const effectivePlan = useMemo(
    () =>
      currentAdvice && currentAdvice.status !== "fallback"
        ? applyAdvisorProposal({
            basePlan: plan,
            proposal: currentAdvice.proposal,
            data,
            bankProducts: prototypeCatalog.bankProducts,
            investmentTaxRules: prototypeCatalog.investmentTaxRules,
            feeAssumptions: prototypeCatalog.feeAssumptions,
          })
        : plan,
    [currentAdvice, data, plan],
  );
  const sampleAdvice = useMemo<AiAdvice>(() => ({
    status: "validated",
    provider: "sample",
    model: null,
    message: "AI 실행 전 화면 확인용 샘플 분석입니다.",
    consideredFactors: ["적금 우선 선호", `${state.horizonYears}년 투자기간`, "ETF·미국시장 선호"],
    adjustments: [],
    originalProposal: null,
    proposal: {
      allocations: plan.target,
      allocationRationales: plan.recommendations.map((item) => ({
        assetClass: item.assetClass,
        rationale: item.reason,
        evidenceIds: item.assetClass === "overseasEtf"
          ? ["indicator-us-equity-trend", "indicator-krw-usd-risk"]
          : [],
      })),
      assumptions: ["화면 확인용 샘플 시장자료"],
      summary: "적금 비중을 중심으로 안전자산을 확보하고 ETF로 국내외 시장을 나눈 샘플 구성입니다.",
    },
    analysis: {
      user: {
        status: "sample",
        summary: `${plan.preference.label}과 ${state.horizonYears}년 투자기간을 반영한 샘플 사용자 분석입니다.`,
        preferenceInsights: ["적금 우선", "ETF 중심", "미국시장 선호"],
        goalGapInsight: `현재 자산에서 목표금액까지 약 ${compactCurrency(Math.max(0, child.goalAmount - plan.current.total))}이 더 필요합니다.`,
        concentrationRisks: ["예·적금과 투자자산의 비중을 함께 점검했습니다."],
        liquidityNeeds: [`월 ${compactCurrency(state.monthlyContribution)} 적립 계획을 반영했습니다.`],
      },
      market: {
        status: "sample",
        summary: "미국 주식의 장기 성장 기대와 환율 변동 위험을 함께 고려한 샘플 시장 분석입니다.",
        domesticOutlook: "cautious",
        usOutlook: "positive",
        etfOutlook: "positive",
        individualOutlook: "cautious",
        confidence: "medium",
        riskFactors: ["국내시장 변동성", "원·달러 환율 변화"],
        evidenceIds: [
          "indicator-kr-equity-volatility",
          "indicator-us-equity-trend",
          "indicator-krw-usd-risk",
        ],
      },
    },
    marketDataStatus: {
      fresh: true,
      status: "fresh",
      asOf: prototypeCatalog.marketSnapshot.asOf,
      evidenceIds: [
        "indicator-kr-equity-volatility",
        "indicator-us-equity-trend",
        "indicator-krw-usd-risk",
      ],
      warning: null,
    },
  }), [child.goalAmount, plan, state.horizonYears, state.monthlyContribution]);
  const targetProgress = Math.min(100, (plan.current.total / child.goalAmount) * 100);

  function openMock(
    item: Record<string, unknown> | null,
    action: "detail" | "subscribe" | "trade",
  ) {
    const link = linkProvider.getLink(String(item?.id ?? "KB-PRODUCT"), action);
    setSelectedItem({ ...item, mockLink: link });
    setModal("mock");
  }

  async function requestAiAdvice() {
    const requestSignature = aiInputSignature;
    setAiLoading(true);
    setAiAdvice(null);
    setAiAdviceSignature(null);
    try {
      const deterministicProposal = {
        allocations: plan.target,
        allocationRationales: plan.recommendations.map((item) => ({
          assetClass: item.assetClass,
          rationale: item.reason,
          evidenceIds: [],
        })),
        consideredFactors: [
          plan.preference.label,
          `${state.horizonYears}년 투자기간`,
          "KB 상품 적합성",
          "세금·수수료 규칙",
        ],
        assumptions: ["샘플 데이터"],
        summary: "선호 순위와 금융 기준을 적용한 기본 포트폴리오입니다.",
      };
      const response = await fetch("/api/portfolio-advice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          child: {
            name: child.name,
            age: plan.age,
            goal: child.goal,
            goalAmount: child.goalAmount,
          },
          profile: {
            assetRanking: state.assetRanking,
            strategyRanking: state.strategyRanking,
            horizonYears: state.horizonYears,
            monthlyContribution: state.monthlyContribution,
          },
          policyFacts: plan.policyFacts,
          currentPortfolio: plan.current,
          marketSnapshot: prototypeCatalog.marketSnapshot,
          deterministicProposal,
        }),
      });
      if (!response.ok) throw new Error("AI 분석 요청에 실패했습니다.");
      setAiAdvice(await response.json());
      setAiAdviceSignature(requestSignature);
    } catch (error) {
      setAiAdvice({
        status: "fallback",
        provider: "deterministic",
        model: null,
        message: `AI 연결 실패 · 기본 추천 표시 (${error instanceof Error ? error.message : "원인 미확인"})`,
        consideredFactors: ["선호 순위", "투자기간", "KB 상품 적합성", "세금·수수료 규칙"],
        adjustments: [],
        originalProposal: null,
        proposal: {
          allocations: plan.target,
          allocationRationales: [],
          summary: "금융 기준을 적용한 안전한 기본 추천입니다.",
        },
      });
      setAiAdviceSignature(requestSignature);
    } finally {
      setAiLoading(false);
    }
  }

  function resetPrototype() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(PREVIOUS_STORAGE_KEY);
    window.localStorage.removeItem(OLDER_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    setState(initialState);
    setAiAdvice(null);
    setAiAdviceSignature(null);
    setModal(null);
  }

  function saveGoalProfile(nextProfile: PreferenceProfile) {
    const currentProfile: PreferenceProfile = {
      horizonYears: state.horizonYears,
      monthlyContribution: state.monthlyContribution,
      assetRanking: state.assetRanking,
      strategyRanking: state.strategyRanking,
    };
    if (JSON.stringify(currentProfile) === JSON.stringify(nextProfile)) {
      setModal(null);
      return;
    }
    setState((current) => ({
      ...current,
      ...nextProfile,
      previousProfile: {
        horizonYears: current.horizonYears,
        monthlyContribution: current.monthlyContribution,
        assetRanking: [...current.assetRanking],
        strategyRanking: [...current.strategyRanking],
      },
      activeTab: "portfolio",
    }));
    setAiAdvice(null);
    setAiAdviceSignature(null);
    setExpandedAssetClass(null);
    setModal(null);
  }

  const aiResultLabel = aiLoading
    ? "AI가 사용자 조건과 시장자료를 분석하고 있습니다."
    : hasStaleAdvice
      ? "입력 내용이 변경되어 AI 재분석이 필요합니다."
      : currentAdvice?.status === "validated"
        ? "AI 추천·규칙 검증 통과"
        : currentAdvice?.status === "adjusted"
          ? "AI 추천·일부 비중 보정"
          : currentAdvice?.status === "fallback"
            ? "AI 연결 실패·규칙 기반 추천"
            : "샘플 AI 분석 결과 · 실제 AI 분석 전";
  const recommendationRationale = buildRecommendationRationale({
    advice: currentAdvice,
    loading: aiLoading,
    stale: hasStaleAdvice,
    context: {
      primaryAssetLabel: ASSET_PREFERENCE_LABELS[state.assetRanking[0]],
      equityStyle:
        state.strategyRanking.indexOf("etf") < state.strategyRanking.indexOf("individual")
          ? "ETF 중심"
          : "개별종목 중심",
      marketPreference:
        state.strategyRanking.indexOf("us") < state.strategyRanking.indexOf("domestic")
          ? "미국시장"
          : "국내시장",
      horizonYears: state.horizonYears,
      heldProductCount: plan.recommendations.filter((item) => item.held).length,
    },
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="KB스타뱅킹 우리 아이 자산관리">
          <span className="brand-mark">KB</span>
          <div>
            <strong>KB스타뱅킹</strong>
            <span>우리 아이 자산관리</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={resetPrototype} aria-label="샘플 데이터 초기화">
            ↻
          </button>
        </div>
      </header>

      <div className="content">
        <section className="product-notice" aria-label="상품 추천 안내">
          <span className="notice-icon">i</span>
          <p>
            현재 가입 가능한 KB국민은행 및 KB증권 상품 중 입력한 투자 성향과 목표에 적합한
            후보를 우선 제시합니다. 상품의 금리, 판매 여부와 가입 조건은 변경될 수 있으므로
            가입 전에 최신 상품설명서와 약관을 확인해야 합니다.
          </p>
        </section>

        <section className="hero">
          <div className="hero-topline">
            <div className="child-selector" aria-label="고정 샘플 자녀">
              <span className="avatar">민</span>
              <span>
                <small>고정 샘플 시나리오</small>
                <strong>{child.name}</strong>
              </span>
            </div>
            <span className="as-of">2026.07.30 기준</span>
          </div>

          <div className="hero-grid">
            <div>
              <span className="eyebrow">우리 아이 전체 자산</span>
              <h1>{compactCurrency(plan.current.total)}</h1>
              <div className="goal-progress">
                <div className="progress-track">
                  <span style={{ width: `${targetProgress}%` }} />
                </div>
                <p>
                  {child.goal} 목표의 <strong>{targetProgress.toFixed(0)}%</strong>
                </p>
              </div>
            </div>
            <div className="hero-metrics">
              <div>
                <span>목표 금액</span>
                <strong>{compactCurrency(child.goalAmount)}</strong>
              </div>
              <div>
                <span>월 저축 계획</span>
                <strong>{compactCurrency(state.monthlyContribution)}</strong>
              </div>
              <div>
                <span>선호 성향</span>
                <strong>{plan.preference.label}</strong>
              </div>
            </div>
          </div>

        </section>

        <section className="quick-actions" aria-label="자녀 자산관리 바로가기">
          <button onClick={() => setModal("assets")}>
            <span className="action-icon">₩</span>
            <span>우리 아이<br />전체 자산 보기</span>
          </button>
          <button onClick={() => setModal("goal")}>
            <span className="action-icon">◎</span>
            <span>목표·성향<br />다시 설정</span>
          </button>
          <button onClick={() => setState((current) => ({ ...current, activeTab: "rebalance" }))}>
            <span className="action-icon">⇄</span>
            <span>리밸런싱<br />제안 확인</span>
          </button>
        </section>

        <nav className="section-tabs" aria-label="자산관리 결과 메뉴">
          <button
            className={state.activeTab === "portfolio" ? "active" : ""}
            onClick={() => setState((current) => ({ ...current, activeTab: "portfolio" }))}
          >
            목표 포트폴리오
          </button>
          <button
            className={state.activeTab === "products" ? "active" : ""}
            onClick={() => setState((current) => ({ ...current, activeTab: "products" }))}
          >
            추천 상품
          </button>
          <button
            className={state.activeTab === "rebalance" ? "active" : ""}
            onClick={() => setState((current) => ({ ...current, activeTab: "rebalance" }))}
          >
            리밸런싱 제안
          </button>
        </nav>

        {state.activeTab === "portfolio" ? (
          <>
            <section className="panel allocation-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">현재 vs AI 추천</span>
                  <h2>한눈에 보는 자산 배분</h2>
                </div>
                <div className="allocation-heading-actions">
                  <span className="preference-pill">
                    {plan.preference.label} · {state.horizonYears}년
                  </span>
                  <button className="ai-run-button" onClick={requestAiAdvice} disabled={aiLoading}>
                    {aiLoading ? "AI 분석 중…" : currentAdvice ? "AI 다시 분석" : "AI 포트폴리오 분석"}
                  </button>
                </div>
              </div>
              <p className={`ai-inline-status ${hasStaleAdvice ? "stale" : currentAdvice?.status ?? "idle"}`}>{aiResultLabel}</p>
              <div className="donut-comparison">
                <PortfolioDonut
                  title="현재 포트폴리오"
                  weights={plan.current.weights}
                  centerTop="현재 총자산"
                  centerValue={compactCurrency(plan.current.total)}
                  focusedAssetClass={focusedAssetClass}
                />
                <div className="donut-arrow" aria-hidden="true">→</div>
                <div className="recommended-portfolio-column">
                  <PortfolioDonut
                    title={currentAdvice && currentAdvice.status !== "fallback" ? "AI 추천 포트폴리오" : "AI 추천 포트폴리오 · 샘플"}
                    weights={effectivePlan.target}
                    centerTop={currentAdvice && currentAdvice.status !== "fallback" ? "AI 추천" : "샘플 추천"}
                    centerValue="100%"
                    focusedAssetClass={focusedAssetClass}
                  />
                </div>
              </div>
              <div className="recommendation-rationale-slot">
                <RecommendationRationale
                  rationale={recommendationRationale}
                  advice={currentAdvice ?? sampleAdvice}
                  plan={effectivePlan}
                  sample={!currentAdvice}
                />
              </div>
              <PortfolioAllocationComparison
                plan={effectivePlan}
                focusedAssetClass={focusedAssetClass}
                setFocusedAssetClass={setFocusedAssetClass}
              />
            </section>

            <section className="panel specification-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">자산군별 추천 상품과 실행 조치</span>
                  <h2>포트폴리오 명세서</h2>
                </div>
                <span className="count-badge">{effectivePlan.recommendations.length}개 KB 후보</span>
              </div>
              <PortfolioSpecification
                plan={effectivePlan}
                expandedAssetClass={expandedAssetClass}
                setExpandedAssetClass={setExpandedAssetClass}
                focusedAssetClass={focusedAssetClass}
                setFocusedAssetClass={setFocusedAssetClass}
                openMock={openMock}
              />
              {effectivePlan.limitations.length > 0 ? (
                <div className="limitations">
                  <strong>KB 상품만으로 충족하지 못한 항목</strong>
                  {effectivePlan.limitations.map((item: { assetClass: string; message: string }) => (
                    <p key={item.assetClass}>{item.message}</p>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {state.activeTab === "products" ? (
          <RecommendedProducts
            plan={effectivePlan}
            filter={productFilter}
            setFilter={setProductFilter}
            openMock={openMock}
          />
        ) : null}

        {state.activeTab === "rebalance" ? (
          <RebalanceView
            plan={effectivePlan}
            previousPlan={previousPlan}
            previousProfile={state.previousProfile}
            currentProfile={{
              horizonYears: state.horizonYears,
              monthlyContribution: state.monthlyContribution,
              assetRanking: state.assetRanking,
              strategyRanking: state.strategyRanking,
            }}
          />
        ) : null}

        <footer>
          <strong>KB 우리 아이 자산관리</strong>
          <p>샘플 데이터 · 실제 금융자문, 계좌 개설 또는 주문 서비스가 아닙니다.</p>
        </footer>
      </div>

      {modal ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="자산관리 상세 패널"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setModal(null)} aria-label="닫기">×</button>
            {modal === "goal" ? (
              <GoalForm state={state} onSave={saveGoalProfile} />
            ) : null}
            {modal === "assets" ? <AssetsList plan={plan} data={data} /> : null}
            {modal === "mock" ? (
              <div className="mock-modal">
                <span className="mock-badge">MOCK LINK</span>
                <h2>{selectedItem?.mockLink?.label}</h2>
                <p>{selectedItem?.name ? `${selectedItem.name}의 ` : ""}{selectedItem?.mockLink?.notice}</p>
                <div className="mock-channel">
                  <span>이동 예정 채널</span>
                  <strong>{selectedItem?.mockLink?.channel}</strong>
                </div>
                <p className="form-note">
                  실제 KB 내부 딥링크가 확인되면 ProductLinkProvider 구현체만 교체하도록 설계되어 있습니다.
                </p>
                <button className="primary-button full-button" onClick={() => setModal(null)}>확인</button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function shortAssetLabel(assetClass: string) {
  return LABELS[assetClass].replace("KB국민은행 ", "").replace("KB증권 ", "");
}

function donutGradient(weights: Record<string, number>) {
  let start = 0;
  const stops = ASSET_CLASSES.flatMap((key: string) => {
    const weight = Math.max(0, Number(weights[key] ?? 0));
    if (weight === 0) return [];
    const end = start + weight;
    const stop = `${COLORS[key]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function PortfolioDonut({
  title,
  weights,
  centerTop,
  centerValue,
  focusedAssetClass,
}: {
  title: string;
  weights: Record<string, number>;
  centerTop: string;
  centerValue: string;
  focusedAssetClass: string | null;
}) {
  const description = ASSET_CLASSES.filter((key: string) => Number(weights[key]) > 0)
    .map((key: string) => `${shortAssetLabel(key)} ${Number(weights[key]).toFixed(1)}%`)
    .join(", ");
  const focusedWeight = focusedAssetClass ? Number(weights[focusedAssetClass] ?? 0) : null;
  return (
    <figure className="portfolio-donut-card">
      <figcaption>{title}</figcaption>
      <div
        className={`portfolio-donut ${focusedAssetClass ? "focused" : ""}`}
        style={{ "--donut-gradient": donutGradient(weights) } as CSSProperties}
        role="img"
        aria-label={`${title}: ${description}`}
      >
        <div className="donut-center">
          <span>{focusedAssetClass ? shortAssetLabel(focusedAssetClass) : centerTop}</span>
          <strong>{focusedWeight != null ? `${focusedWeight.toFixed(1)}%` : centerValue}</strong>
        </div>
      </div>
    </figure>
  );
}

function RecommendationRationale({
  rationale,
  advice,
  plan,
  sample,
}: {
  rationale: ReturnType<typeof buildRecommendationRationale>;
  advice: AiAdvice | null;
  plan: PortfolioPlan;
  sample: boolean;
}) {
  const outlookLabels = {
    positive: "긍정",
    neutral: "중립",
    cautious: "주의",
  } as const;
  const evidence = [
    ...prototypeCatalog.marketSnapshot.indicators,
    ...prototypeCatalog.marketSnapshot.news,
    ...prototypeCatalog.marketSnapshot.kbResearch,
  ];
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const usedSources = (advice?.analysis?.market.evidenceIds ?? [])
    .map((id) => evidenceById.get(id))
    .filter(Boolean)
    .map((item) => `${item?.sourceName} · ${"publishedAt" in item! ? item?.publishedAt : item?.effectiveDate}`)
    .filter((value, index, values) => values.indexOf(value) === index);
  const market = advice?.analysis?.market;
  const user = advice?.analysis?.user;
  const success = advice && advice.status !== "fallback";
  const ruleMessage =
    advice?.status === "adjusted"
      ? rationale.adjustment ?? "허용 범위를 벗어난 비중을 금융 기준에 맞게 조정했습니다."
      : success
        ? "비중 합계, 투자기간별 성장자산 한도와 시장 근거를 확인했습니다."
        : "투자기간별 안전장치와 KB 상품 적합성 기준을 적용한 기준안입니다.";
  const sections = [
    {
      label: "사용자 분석",
      body: user?.summary ?? rationale.reasons[0] ?? rationale.intro,
      meta: user?.goalGapInsight || null,
    },
    {
      label: "시장 분석",
      body:
        market?.summary ??
        (advice?.status === "fallback"
          ? "AI가 연결되지 않아 시장 판단을 비중에 반영하지 않았습니다."
          : "AI 분석 전에는 시장 판단을 비중에 반영하지 않습니다."),
      meta: market
        ? `국내 ${outlookLabels[market.domesticOutlook]} · 미국 ${outlookLabels[market.usOutlook]} · 신뢰도 ${market.confidence}`
        : null,
    },
    {
      label: "최종 추천",
      body: success
        ? advice.proposal.summary ?? rationale.intro
        : "입력한 선호와 투자기간을 바탕으로 구성한 규칙 기반 추천입니다.",
      meta: null,
    },
    {
      label: "규칙 확인",
      body: ruleMessage,
      meta: null,
    },
    {
      label: "KB 상품 연결",
      body: `검증된 최종 비중에 맞춰 KB국민은행·KB증권 상품 ${plan.recommendations.length}개를 연결했습니다.`,
      meta: "상품 금액·세금·수수료는 금융 기준에서 다시 계산합니다.",
    },
  ];
  return (
    <section
      className={`recommendation-rationale ${rationale.state}`}
      aria-labelledby="recommendation-rationale-title"
      aria-live="polite"
    >
      <div className="recommendation-rationale-heading">
        <span className="rationale-spark" aria-hidden="true">AI</span>
        <h3 id="recommendation-rationale-title">AI 추천 근거</h3>
        {sample ? <span className="sample-analysis-badge">샘플</span> : null}
      </div>
      <p>{sample ? "AI 실행 전 화면 확인용 샘플 분석입니다. 분석 버튼을 누르면 실제 AI 결과로 교체됩니다." : rationale.intro}</p>
      <ol className="ai-evidence-flow">
        {sections.map((section, index) => (
          <li key={section.label}>
            <span className="ai-evidence-step">{index + 1}</span>
            <div>
              <strong>{section.label}</strong>
              <p>{section.body}</p>
              {section.meta ? <small>{section.meta}</small> : null}
            </div>
          </li>
        ))}
      </ol>
      {usedSources.length > 0 ? (
        <div className="ai-market-sources">
          <strong>사용한 시장자료</strong>
          <span>{usedSources.slice(0, 3).join(" · ")}</span>
        </div>
      ) : null}
    </section>
  );
}

function PortfolioAllocationComparison({
  plan,
  focusedAssetClass,
  setFocusedAssetClass,
}: {
  plan: ReturnType<typeof generatePlan>;
  focusedAssetClass: string | null;
  setFocusedAssetClass: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const rows = ASSET_CLASSES.filter(
    (key: string) => Number(plan.current.weights[key]) > 0 || Number(plan.target[key]) > 0,
  );
  return (
    <div className="allocation-comparison" aria-label="현재 포트폴리오와 추천 포트폴리오 비교">
      <div className="allocation-comparison-head" aria-hidden="true">
        <span>자산군</span><span>현재</span><span>추천</span><span>차이</span>
      </div>
      {rows.map((assetClass: string) => {
        const currentWeight = Number(plan.current.weights[assetClass] ?? 0);
        const targetWeight = Number(plan.target[assetClass] ?? 0);
        const delta = targetWeight - currentWeight;
        return (
          <button
            key={assetClass}
            className={focusedAssetClass === assetClass ? "active" : ""}
            onClick={() => setFocusedAssetClass((current) => current === assetClass ? null : assetClass)}
            aria-label={`${shortAssetLabel(assetClass)} 현재 ${currentWeight.toFixed(1)}%, 추천 ${targetWeight.toFixed(1)}%`}
          >
            <span className="allocation-name">
              <i className="legend-dot" style={{ background: COLORS[assetClass] }} />
              {shortAssetLabel(assetClass)}
            </span>
            <span>{currentWeight.toFixed(1)}%</span>
            <strong>{targetWeight.toFixed(1)}%</strong>
            <b className={delta > 1 ? "up" : delta < -1 ? "down" : "same"}>
              {delta > 0 ? "+" : ""}{delta.toFixed(1)}%p
            </b>
          </button>
        );
      })}
    </div>
  );
}

function productFilterFor(assetClass: string): ProductFilter {
  if (["cash", "savings", "deposit"].includes(assetClass)) return "bank";
  if (assetClass === "fund") return "fund";
  if (assetClass.includes("Etf")) return "etf";
  return "stock";
}

function RecommendedProducts({
  plan,
  filter,
  setFilter,
  openMock,
}: {
  plan: ReturnType<typeof generatePlan>;
  filter: ProductFilter;
  setFilter: React.Dispatch<React.SetStateAction<ProductFilter>>;
  openMock: (item: Record<string, unknown> | null, action: "detail" | "subscribe" | "trade") => void;
}) {
  const filterLabels: Array<[ProductFilter, string]> = [
    ["all", "전체"],
    ["bank", "예·적금"],
    ["etf", "ETF"],
    ["fund", "펀드"],
    ["stock", "주식"],
  ];
  const filtered = [...plan.recommendations]
    .filter((item) => filter === "all" || productFilterFor(item.assetClass) === filter)
    .sort((a, b) => b.targetWeight - a.targetWeight);
  const visible = filter === "all" ? filtered.slice(0, 4) : filtered;

  return (
    <section className="panel recommended-products-section">
      <div className="section-heading recommended-products-heading">
        <div>
          <span className="eyebrow">목표 비중을 실행 가능한 상품으로 연결</span>
          <h2>추천 상품</h2>
        </div>
        <span className="count-badge">{filter === "all" ? `상위 ${visible.length}개` : `${visible.length}개`}</span>
      </div>
      <div className="product-filter-tabs" role="tablist" aria-label="추천 상품 유형">
        {filterLabels.map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
            role="tab"
            aria-selected={filter === key}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="recommended-product-list">
        {visible.map((item) => {
          const currentWeight = Number(plan.current.weights[item.assetClass] ?? 0);
          const advisorAction = "advisorAction" in item ? String(item.advisorAction) : undefined;
          const action = displayAction(currentWeight, item.targetWeight, advisorAction);
          const assumption = item.rateQuote?.baseRate != null
            ? `기본 연 ${item.rateQuote.baseRate}%`
            : item.expectedReturn
              ? `연 ${item.expectedReturn}% 가정`
              : "시장 수익률 연동";
          return (
            <article className="recommended-product-card" key={item.assetClass}>
              <div className="recommended-product-topline">
                <span className={providerClass(item.provider)}>{item.provider}</span>
                <span className="product-risk">위험 {item.riskGrade}등급</span>
              </div>
              <span className="recommended-product-class">{shortAssetLabel(item.assetClass)}</span>
              <h3>{item.name}</h3>
              <div className="recommended-product-numbers">
                <div><span>추천 비중</span><strong>{item.targetWeight.toFixed(1)}%</strong></div>
                <div><span>추천 금액</span><strong>{compactCurrency(item.targetAmount)}</strong></div>
              </div>
              <div className="recommended-product-summary">
                <span>{assumption}</span>
                <b className={`action-badge action-${action.replace(/\s/g, "-")}`}>{action}</b>
              </div>
              <p>{item.reason}</p>
              <div className="card-actions">
                <button className="secondary-button" onClick={() => openMock(item, "detail")}>상세보기</button>
                <button className="primary-button" onClick={() => openMock(item, item.kind === "bank" ? "subscribe" : "trade")}>
                  {item.kind === "bank" ? "가입하기" : "M-able 확인"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {filter === "all" && filtered.length > visible.length ? (
        <p className="recommended-products-note">자산별 전체 후보와 세부 조건은 목표 포트폴리오 아래 명세서에서 확인할 수 있어요.</p>
      ) : null}
    </section>
  );
}

function displayAction(currentWeight: number, targetWeight: number, advisorAction?: string) {
  if (advisorAction === "추가입금") return "추가";
  if (advisorAction === "매도검토") return "축소 검토";
  if (advisorAction === "만기재배분") return "만기 재배분";
  if (advisorAction === "유지") return "유지";
  const gap = targetWeight - currentWeight;
  if (gap > 1) return "추가";
  if (gap < -1) return "축소 검토";
  return "유지";
}

function preferenceProfileLabel(profile: PreferenceProfile) {
  const equityStyle = profile.strategyRanking.indexOf("etf") < profile.strategyRanking.indexOf("individual")
    ? "ETF 중심"
    : "개별종목 중심";
  const market = profile.strategyRanking.indexOf("us") < profile.strategyRanking.indexOf("domestic")
    ? "미주 중심"
    : "국내 중심";
  return `${ASSET_PREFERENCE_LABELS[profile.assetRanking[0]]} 우선 · ${equityStyle} · ${market}`;
}

function PreviousGoalComparison({
  previousPlan,
  currentPlan,
  previousProfile,
  currentProfile,
}: {
  previousPlan: PortfolioPlan;
  currentPlan: PortfolioPlan;
  previousProfile: PreferenceProfile;
  currentProfile: PreferenceProfile;
}) {
  const changes = ASSET_CLASSES.map((assetClass: string) => {
    const previousWeight = Number(previousPlan.target[assetClass] ?? 0);
    const currentWeight = Number(currentPlan.target[assetClass] ?? 0);
    return { assetClass, previousWeight, currentWeight, delta: currentWeight - previousWeight };
  })
    .filter((item) => Math.abs(item.delta) >= 0.05)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 4);

  const reasons: string[] = [];
  if (previousProfile.assetRanking[0] !== currentProfile.assetRanking[0]) {
    reasons.push(`${ASSET_PREFERENCE_LABELS[previousProfile.assetRanking[0]]} 우선에서 ${ASSET_PREFERENCE_LABELS[currentProfile.assetRanking[0]]} 우선으로 변경`);
  }
  if (previousProfile.horizonYears !== currentProfile.horizonYears) {
    reasons.push(`투자기간 ${previousProfile.horizonYears}년에서 ${currentProfile.horizonYears}년으로 변경`);
  }
  if (previousProfile.monthlyContribution !== currentProfile.monthlyContribution) {
    reasons.push(`월 저축 계획 ${compactCurrency(previousProfile.monthlyContribution)}에서 ${compactCurrency(currentProfile.monthlyContribution)}으로 변경`);
  }
  if (JSON.stringify(previousProfile.strategyRanking) !== JSON.stringify(currentProfile.strategyRanking)) {
    reasons.push("투자 방식과 선호 시장 순위 변경");
  }

  return (
    <section className="panel previous-goal-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">목표를 바꾼 뒤 달라진 자산 배분</span>
          <h2>지난 목표 대비 변화</h2>
        </div>
        <span className="count-badge">상위 {changes.length}개 변화</span>
      </div>

      <div className="goal-history-summary">
        <div>
          <span>이전 목표</span>
          <strong>{preferenceProfileLabel(previousProfile)}</strong>
          <small>{previousProfile.horizonYears}년 · 월 {compactCurrency(previousProfile.monthlyContribution)}</small>
        </div>
        <span className="goal-history-arrow" aria-hidden="true">→</span>
        <div>
          <span>현재 목표</span>
          <strong>{preferenceProfileLabel(currentProfile)}</strong>
          <small>{currentProfile.horizonYears}년 · 월 {compactCurrency(currentProfile.monthlyContribution)}</small>
        </div>
      </div>

      {reasons.length > 0 ? (
        <p className="goal-change-reasons"><b>변경한 조건</b>{reasons.join(" · ")}</p>
      ) : (
        <p className="goal-change-reasons">입력 조건은 같지만 AI 분석 또는 상품 적합성 검증 결과에 따라 비중이 조정되었습니다.</p>
      )}

      <div className="goal-change-list" aria-label="이전 목표와 현재 목표의 주요 비중 변화">
        {changes.length > 0 ? changes.map((change) => (
          <div key={change.assetClass}>
            <span className="legend-dot" style={{ background: COLORS[change.assetClass] }} />
            <strong>{shortAssetLabel(change.assetClass)}</strong>
            <span>{change.previousWeight.toFixed(1)}%</span>
            <b aria-hidden="true">→</b>
            <span>{change.currentWeight.toFixed(1)}%</span>
            <em className={change.delta > 0 ? "up" : "down"}>
              {change.delta > 0 ? "+" : ""}{change.delta.toFixed(1)}%p
            </em>
          </div>
        )) : <p>이전 목표와 비교해 달라진 자산군 비중이 없습니다.</p>}
      </div>
    </section>
  );
}

function PortfolioSpecification({
  plan,
  expandedAssetClass,
  setExpandedAssetClass,
  focusedAssetClass,
  setFocusedAssetClass,
  openMock,
}: {
  plan: ReturnType<typeof generatePlan>;
  expandedAssetClass: string | null;
  setExpandedAssetClass: React.Dispatch<React.SetStateAction<string | null>>;
  focusedAssetClass: string | null;
  setFocusedAssetClass: React.Dispatch<React.SetStateAction<string | null>>;
  openMock: (item: Record<string, unknown> | null, action: "detail" | "subscribe" | "trade") => void;
}) {
  const itemByClass = new Map(plan.recommendations.map((item) => [item.assetClass, item]));
  const rows = ASSET_CLASSES.filter(
    (key: string) => Number(plan.current.weights[key]) > 0 || Number(plan.target[key]) > 0,
  ).map((assetClass: string) => {
    const item = itemByClass.get(assetClass);
    const currentWeight = Number(plan.current.weights[assetClass] ?? 0);
    const targetWeight = Number(plan.target[assetClass] ?? 0);
    const currentAmount = Number(plan.current.amounts[assetClass] ?? 0);
    const targetAmount = Math.round((plan.current.total * targetWeight) / 100);
    const deltaWeight = targetWeight - currentWeight;
    const deltaAmount = targetAmount - currentAmount;
    const advisorAction = item && "advisorAction" in item ? String(item.advisorAction) : undefined;
    return {
      assetClass,
      item,
      currentWeight,
      targetWeight,
      currentAmount,
      targetAmount,
      deltaWeight,
      deltaAmount,
      action: displayAction(currentWeight, targetWeight, advisorAction),
    };
  });

  return (
    <>
      <div className="specification-table-wrap desktop-specification">
        <table className="portfolio-specification">
          <thead>
            <tr>
              <th>자산군</th>
              <th>현재</th>
              <th>추천</th>
              <th>차이</th>
              <th>KB 상품</th>
              <th>조치</th>
              <th>위험</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const expanded = expandedAssetClass === row.assetClass;
              return (
                <Fragment key={row.assetClass}>
                  <tr
                    className={`${focusedAssetClass === row.assetClass ? "focused" : ""} ${expanded ? "expanded" : ""}`}
                    onMouseEnter={() => setFocusedAssetClass(row.assetClass)}
                    onMouseLeave={() => setFocusedAssetClass(null)}
                  >
                    <td data-label="자산군">
                      <button
                        className="asset-toggle"
                        onClick={() => setExpandedAssetClass(expanded ? null : row.assetClass)}
                        aria-expanded={expanded}
                      >
                        <span className="legend-dot" style={{ background: COLORS[row.assetClass] }} />
                        <span>{shortAssetLabel(row.assetClass)}</span>
                        <b aria-hidden="true">{expanded ? "−" : "+"}</b>
                      </button>
                    </td>
                    <td data-label="현재"><strong>{row.currentWeight.toFixed(1)}%</strong><small>{compactCurrency(row.currentAmount)}</small></td>
                    <td data-label="추천"><strong>{row.targetWeight.toFixed(1)}%</strong><small>{compactCurrency(row.targetAmount)}</small></td>
                    <td data-label="차이" className={row.deltaWeight > 1 ? "positive" : row.deltaWeight < -1 ? "negative" : "neutral"}>
                      <strong>{row.deltaWeight > 0 ? "+" : ""}{row.deltaWeight.toFixed(1)}%p</strong>
                      <small>{row.deltaAmount > 0 ? "+" : ""}{compactCurrency(row.deltaAmount)}</small>
                    </td>
                    <td data-label="KB 상품">
                      {row.item ? <><span className={providerClass(row.item.provider)}>{row.item.provider}</span><strong className="product-name-cell">{row.item.name}</strong></> : <span>적합 후보 없음</span>}
                    </td>
                    <td data-label="조치"><span className={`action-badge action-${row.action.replace(/\s/g, "-")}`}>{row.action}</span></td>
                    <td data-label="위험">{row.item ? `${row.item.riskGrade}등급` : "-"}</td>
                  </tr>
                  {expanded ? (
                    <tr className="specification-detail-row">
                      <td colSpan={7}>
                        {row.item ? (
                          <SpecificationDetail item={row.item} plan={plan} openMock={openMock} />
                        ) : <p>현재 조건에서 검증된 KB 상품 후보가 없습니다.</p>}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mobile-specification-list" aria-label="모바일 포트폴리오 명세서">
        {rows.map((row) => {
          const expanded = expandedAssetClass === row.assetClass;
          const deltaClass = row.deltaWeight > 1 ? "positive" : row.deltaWeight < -1 ? "negative" : "neutral";
          return (
            <article className={`mobile-specification-card ${expanded ? "expanded" : ""}`} key={row.assetClass}>
              <div className="mobile-specification-head">
                <div>
                  <span className="legend-dot" style={{ background: COLORS[row.assetClass] }} />
                  <strong>{shortAssetLabel(row.assetClass)}</strong>
                </div>
                <span className={`action-badge action-${row.action.replace(/\s/g, "-")}`}>{row.action}</span>
              </div>

              <div className="mobile-specification-highlight">
                <div className="mobile-target-value">
                  <span>추천 포트폴리오</span>
                  <strong>{row.targetWeight.toFixed(1)}%</strong>
                  <b>{compactCurrency(row.targetAmount)}</b>
                </div>
                <div className={`mobile-delta-value ${deltaClass}`}>
                  <span>현재 대비</span>
                  <strong>{row.deltaWeight > 0 ? "+" : ""}{row.deltaWeight.toFixed(1)}%p</strong>
                  <small>{row.deltaAmount > 0 ? "+" : ""}{compactCurrency(row.deltaAmount)}</small>
                </div>
              </div>

              <div className="mobile-current-value">
                <span>현재 보유</span>
                <strong>{row.currentWeight.toFixed(1)}%</strong>
                <small>{compactCurrency(row.currentAmount)}</small>
              </div>

              <div className="mobile-product-line">
                {row.item ? (
                  <>
                    <div>
                      <span className={providerClass(row.item.provider)}>{row.item.provider}</span>
                      <span className="mobile-risk-badge">위험 {row.item.riskGrade}등급</span>
                    </div>
                    <strong>{row.item.name}</strong>
                  </>
                ) : <strong>현재 조건에서 적합한 KB 상품 후보가 없습니다.</strong>}
              </div>

              <button
                className="mobile-specification-toggle"
                onClick={() => setExpandedAssetClass(expanded ? null : row.assetClass)}
                aria-expanded={expanded}
              >
                <span>{expanded ? "세부 정보 닫기" : "세부 정보 보기"}</span>
                <b aria-hidden="true">{expanded ? "−" : "+"}</b>
              </button>

              {expanded ? (
                <div className="mobile-specification-detail">
                  {row.item ? (
                    <SpecificationDetail item={row.item} plan={plan} openMock={openMock} />
                  ) : <p>현재 조건에서 검증된 KB 상품 후보가 없습니다.</p>}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}

function SpecificationDetail({
  item,
  plan,
  openMock,
}: {
  item: PortfolioRecommendation;
  plan: PortfolioPlan;
  openMock: (item: Record<string, unknown> | null, action: "detail" | "subscribe" | "trade") => void;
}) {
  return (
    <div className="specification-detail">
      <div className="detail-reason">
        <span>AI 추천 근거</span>
        <strong>{item.reason}</strong>
        <p>{plan.preference.label} · 투자기간 {plan.policyFacts.horizonYears}년 · {plan.policyFacts.safetyGuardrail}</p>
      </div>
      <dl>
        <div><dt>금리·수익 가정</dt><dd>{item.rateQuote?.baseRate != null ? `기본 ${item.rateQuote.baseRate}%` : item.expectedReturn ? `연 ${item.expectedReturn}% 가정` : "시장 수익률 연동"}</dd></div>
        <div><dt>우대금리 판정</dt><dd>{item.rateQuote ? item.rateQuote.confirmedBonus > 0 ? `충족 확인 +${item.rateQuote.confirmedBonus.toFixed(2)}%p` : "확인된 우대 없음" : "해당 없음"}</dd></div>
        <div><dt>1년 세금·비용 추정</dt><dd>{compactCurrency(item.costEstimate.totalCost)}</dd></div>
        <div><dt>만기·권장기간</dt><dd>{item.maturity}</dd></div>
        <div><dt>예금자보호</dt><dd>{item.depositProtection ? "보호" : "비보호"}</dd></div>
        <div><dt>정보 기준일</dt><dd>{item.effectiveDate}</dd></div>
      </dl>
      <div className="detail-notes">
        <p><b>세금·비용:</b> {item.costEstimate.taxNote}</p>
        <p><b>주의사항:</b> {item.warning}</p>
        <p><b>출처:</b> {item.sourceName}</p>
      </div>
      <div className="card-actions">
        <button className="secondary-button" onClick={() => openMock(item, "detail")}>상품 자세히 보기</button>
        <button className="primary-button" onClick={() => openMock(item, item.kind === "bank" ? "subscribe" : "trade")}>
          {item.kind === "bank" ? "가입 화면으로 이동" : "M-able에서 확인"}
        </button>
      </div>
    </div>
  );
}

function GoalForm({
  state,
  onSave,
}: {
  state: PrototypeState;
  onSave: (profile: PreferenceProfile) => void;
}) {
  const [draft, setDraft] = useState<PreferenceProfile>({
    horizonYears: state.horizonYears,
    monthlyContribution: state.monthlyContribution,
    assetRanking: [...state.assetRanking],
    strategyRanking: [...state.strategyRanking],
  });

  return (
    <div>
      <span className="eyebrow">두 가지 선호 순위</span>
      <h2>목표·투자 성향 설정</h2>
      <label>
        남은 투자기간
        <select
          value={draft.horizonYears}
          onChange={(event) => setDraft((current) => ({ ...current, horizonYears: Number(event.target.value) }))}
        >
          <option value="2">2년</option>
          <option value="4">4년</option>
          <option value="8">8년</option>
          <option value="12">12년</option>
        </select>
      </label>
      <label>
        월 신규 입금 예정액
        <input
          type="number"
          step="10000"
          value={draft.monthlyContribution}
          onChange={(event) => setDraft((current) => ({ ...current, monthlyContribution: Number(event.target.value) }))}
        />
      </label>
      <RankingList
        title="자산 선호 순위"
        description="목표 포트폴리오의 적금·예금·주식·채권 비중에 반영합니다."
        ranking={draft.assetRanking}
        labels={ASSET_PREFERENCE_LABELS}
        onChange={(assetRanking) => setDraft((current) => ({ ...current, assetRanking }))}
      />
      <RankingList
        title="투자 방식 순위"
        description="주식 비중 안에서 ETF·개별종목과 미주·국내 배분에 반영합니다."
        ranking={draft.strategyRanking}
        labels={STRATEGY_PREFERENCE_LABELS}
        onChange={(strategyRanking) =>
          setDraft((current) => ({ ...current, strategyRanking }))
        }
      />
      <p className="form-note">
        이 순위는 목표 배분을 위한 참고 기준이며 공식 투자성향 진단이 아닙니다.
      </p>
      <button className="primary-button full-button" onClick={() => onSave(draft)}>추천 다시 계산</button>
    </div>
  );
}

function RankingList<T extends string>({
  title,
  description,
  ranking,
  labels,
  onChange,
}: {
  title: string;
  description: string;
  ranking: T[];
  labels: Record<T, string>;
  onChange: (ranking: T[]) => void;
}) {
  function move(index: number, offset: -1 | 1) {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= ranking.length) return;
    const next = [...ranking];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  }

  return (
    <section className="ranking-section" aria-label={title}>
      <div className="ranking-heading">
        <strong>{title}</strong>
        <span>1순위가 가장 높은 선호입니다.</span>
      </div>
      <p>{description}</p>
      <ol className="ranking-list">
        {ranking.map((item, index) => (
          <li key={item}>
            <span className="rank-number">{index + 1}</span>
            <strong>{labels[item]}</strong>
            <div className="rank-controls">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`${labels[item]} 순위 올리기`}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === ranking.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`${labels[item]} 순위 내리기`}
              >
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AssetsList({
  plan,
  data,
}: {
  plan: ReturnType<typeof generatePlan>;
  data: typeof prototypeCatalog.data;
}) {
  return (
    <div>
      <span className="eyebrow">고정 샘플 시나리오</span>
      <h2>민서의 샘플 보유자산</h2>
      <div className="asset-list">
        {data.bankAccounts.map((account) => (
          <div key={account.accountId}>
            <span className="provider provider-bank">KB국민은행</span>
            <div><strong>{account.accountName}</strong><small>{account.maturityDate ? `${account.maturityDate} 만기` : "입출금 가능"}</small></div>
            <b>{compactCurrency(account.balance)}</b>
          </div>
        ))}
        {data.securitiesHoldings.map((holding) => {
          const asset = prototypeCatalog.securitiesAssets.find(
            (item) => item.asset_id === holding.assetId,
          );
          return (
            <div key={holding.holdingId}>
              <span className="provider provider-securities">KB증권</span>
              <div><strong>{asset?.name}</strong><small>{asset?.symbol} · M-able</small></div>
              <b>{compactCurrency(holding.marketValue)}</b>
            </div>
          );
        })}
      </div>
      <div className="asset-total"><span>통합 자산</span><strong>{currency(plan.current.total)}</strong></div>
      <p className="form-note">
        실제 계좌를 조회하지 않습니다. 판매 중지 상품도 기존 샘플 보유자산에는 계속 표시됩니다.
      </p>
    </div>
  );
}

function RebalanceView({
  plan,
  previousPlan,
  previousProfile,
  currentProfile,
}: {
  plan: PortfolioPlan;
  previousPlan: PortfolioPlan;
  previousProfile: PreferenceProfile;
  currentProfile: PreferenceProfile;
}) {
  return (
    <>
      <PreviousGoalComparison
        previousPlan={previousPlan}
        currentPlan={plan}
        previousProfile={previousProfile}
        currentProfile={currentProfile}
      />
      <section className="rebalance-layout">
        <div className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">매도보다 새 자금 우선</span>
            <h2>이번 달 리밸런싱 제안</h2>
          </div>
          <span className="available-pill">{compactCurrency(plan.rebalancing.available)} 활용</span>
        </div>
        <ol className="sequence-list">
          {plan.rebalancing.sequence.map((item: string, index: number) => (
            <li key={item}><span>{index + 1}</span><p>{item}</p></li>
          ))}
        </ol>
        <div className="allocation-suggestions">
          {plan.rebalancing.allocations.map((item: {
            assetClass: string;
            label: string;
            amount: number;
          }) => (
            <div key={item.assetClass}>
              <span className="legend-dot" style={{ background: COLORS[item.assetClass] }} />
              <p><strong>{item.label}</strong><small>목표 부족 비중 보충</small></p>
              <b>+{compactCurrency(item.amount)}</b>
            </div>
          ))}
        </div>
        </div>
        <div className="panel maturity-panel">
        <span className="eyebrow">해지 대신 만기 예약</span>
        <h2>예·적금 유지 판단</h2>
        {plan.rebalancing.holds.map((item: {
          accountName: string;
          productName: string;
          maturityDate: string;
          keep: boolean;
          reason: string;
          reservation: string;
        }) => (
          <article key={item.accountName}>
            <div><strong>{item.productName}</strong><span>{item.maturityDate} 만기</span></div>
            <span className={item.keep ? "keep-badge" : "review-badge"}>{item.keep ? "유지 우선" : "검토 가능"}</span>
            <p>{item.reason}</p>
            <div className="reservation">↳ {item.reservation}</div>
          </article>
        ))}
        </div>
      </section>
    </>
  );
}
