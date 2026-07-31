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

const STORAGE_KEY = "kb-child-portfolio-prototype:v4";
const PREVIOUS_STORAGE_KEY = "kb-child-portfolio-prototype:v3";
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
const INVESTMENT_TAX_RULES = prototypeCatalog.investmentTaxRules as Record<string, unknown>;

type AssetPreference = "savings" | "deposit" | "stock" | "bond";
type StrategyPreference = "etf" | "individual" | "us" | "domestic";

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
  activeTab: "portfolio" | "rebalance";
  horizonYears: number;
  monthlyContribution: number;
  assetRanking: AssetPreference[];
  strategyRanking: StrategyPreference[];
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
    recommendations: Array<{
      assetClass: string;
      productId: string;
      weight: number;
      amount: number;
      action: string;
      rationale: string;
    }>;
    alternatives?: string[];
    assumptions?: string[];
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
      stored.activeTab === "portfolio" || stored.activeTab === "rebalance"
        ? stored.activeTab
        : initialState.activeTab,
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
  const [modal, setModal] = useState<null | "goal" | "gift" | "assets" | "mock">(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [aiAdvice, setAiAdvice] = useState<AiAdvice | null>(null);
  const [aiAdviceSignature, setAiAdviceSignature] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedAssetClass, setExpandedAssetClass] = useState<string | null>(null);
  const [focusedAssetClass, setFocusedAssetClass] = useState<string | null>(null);
  const [giftForm, setGiftForm] = useState({
    date: initialState.proposedGift.date,
    amount: String(initialState.proposedGift.amount),
    donorRelationship: initialState.proposedGift.donorRelationship,
    memo: initialState.proposedGift.memo,
  });
  const linkProvider = useMemo(() => new StaticProductLinkProvider(), []);

  useEffect(() => {
    let storedState: PrototypeState | null = null;
    try {
      const stored =
        window.localStorage.getItem(STORAGE_KEY) ??
        window.localStorage.getItem(PREVIOUS_STORAGE_KEY) ??
        window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (stored) storedState = migrateStoredState(JSON.parse(stored));
    } catch {
      // 손상된 로컬 프로토타입 상태는 안전하게 샘플값으로 대체합니다.
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

  const child = data.children[0];
  const aiInputSignature = JSON.stringify({
    assetRanking: state.assetRanking,
    strategyRanking: state.strategyRanking,
    horizonYears: state.horizonYears,
    monthlyContribution: state.monthlyContribution,
    proposedGift: state.proposedGift,
  });

  const currentAdvice = aiAdviceSignature === aiInputSignature ? aiAdvice : null;

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
  const giftTotal = data.giftHistory.reduce((sum, item) => sum + item.amount, 0);
  const targetProgress = Math.min(100, (plan.current.total / child.goalAmount) * 100);

  function openMock(
    item: Record<string, unknown> | null,
    action: "detail" | "subscribe" | "trade",
  ) {
    const link = linkProvider.getLink(String(item?.id ?? "KB-PRODUCT"), action);
    setSelectedItem({ ...item, mockLink: link });
    setModal("mock");
  }

  function simulateGift(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(giftForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setState((current) => ({
      ...current,
      proposedGift: {
        date: giftForm.date,
        amount,
        donorId: giftForm.donorRelationship === "모" ? "parent-mother" : "parent-father",
        donorGroupId: giftForm.donorRelationship === "조부모" ? "grandparent-couple" : "parent-couple",
        donorRelationship: giftForm.donorRelationship,
        memo: giftForm.memo || "추가 현금 증여",
      },
    }));
    setAiAdvice(null);
    setAiAdviceSignature(null);
    setModal(null);
  }

  async function requestAiAdvice() {
    const requestSignature = aiInputSignature;
    setAiLoading(true);
    setAiAdvice(null);
    setAiAdviceSignature(null);
    try {
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
        consideredFactors: [
          plan.preference.label,
          `${state.horizonYears}년 투자기간`,
          "KB 상품 적합성",
          "세금·수수료 규칙",
        ],
        alternatives: ["신규 입금 배분 조정", "예·적금 만기 후 재배분"],
        assumptions: ["프로토타입용 샘플 데이터"],
        summary: "선호 순위와 금융 규칙을 적용한 결정론적 기준 포트폴리오입니다.",
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
          allowedCandidates: plan.recommendations.map((item) => ({
            id: item.id,
            name: item.name,
            provider: item.provider,
            assetClass: item.assetClass,
            held: item.held,
            riskGrade: item.riskGrade,
            estimatedOneYearCost: item.costEstimate.totalCost,
          })),
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
        message: `AI 연결 실패 · 규칙 기반 대체 결과 (${error instanceof Error ? error.message : "원인 미확인"})`,
        consideredFactors: ["선호 순위", "투자기간", "KB 상품 적합성", "세금·수수료 규칙"],
        adjustments: [],
        originalProposal: null,
        proposal: {
          allocations: plan.target,
          recommendations: [],
          summary: "결정론적 규칙 엔진이 생성한 안전한 대체 결과입니다.",
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
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    setState(initialState);
    setAiAdvice(null);
    setAiAdviceSignature(null);
    setModal(null);
  }

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
          <span className="prototype-chip">프로토타입</span>
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
                <span>10년 증여 합계</span>
                <strong>{compactCurrency(giftTotal)}</strong>
              </div>
              <div>
                <span>선호 성향</span>
                <strong>{plan.preference.label}</strong>
              </div>
            </div>
          </div>

          <div className="connection-row scenario-row">
            <div className="connection-copy">
              <span className="status-dot connected" />
              <div>
                <strong>프로토타입용 샘플 데이터</strong>
                <span>실제 자녀·계좌 정보를 조회하거나 연결하지 않습니다.</span>
              </div>
            </div>
            <span className="sample-badge">고정 시나리오</span>
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
          <button onClick={() => setModal("gift")}>
            <span className="action-icon">＋</span>
            <span>추가 증여<br />시뮬레이션</span>
          </button>
          <button onClick={() => setState((current) => ({ ...current, activeTab: "rebalance" }))}>
            <span className="action-icon">⇄</span>
            <span>리밸런싱<br />제안 확인</span>
          </button>
        </section>

        <GiftTaxSummary
          result={plan.giftTax}
          history={data.giftHistory}
          proposedGift={state.proposedGift}
          openSimulator={() => setModal("gift")}
        />

        <nav className="section-tabs" aria-label="자산관리 결과 메뉴">
          <button
            className={state.activeTab === "portfolio" ? "active" : ""}
            onClick={() => setState((current) => ({ ...current, activeTab: "portfolio" }))}
          >
            목표 포트폴리오
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
                <span className="preference-pill">
                  {plan.preference.label} · {state.horizonYears}년
                </span>
              </div>
              <AiAdvisorStatus
                advice={currentAdvice}
                loading={aiLoading}
                run={requestAiAdvice}
              />
              <div className="donut-comparison">
                <PortfolioDonut
                  title="현재 포트폴리오"
                  weights={plan.current.weights}
                  centerTop="현재 총자산"
                  centerValue={compactCurrency(plan.current.total)}
                  focusedAssetClass={focusedAssetClass}
                />
                <div className="donut-arrow" aria-hidden="true">→</div>
                <PortfolioDonut
                  title={currentAdvice && currentAdvice.status !== "fallback" ? "AI 추천 포트폴리오" : "규칙 기준 포트폴리오"}
                  weights={effectivePlan.target}
                  centerTop={currentAdvice && currentAdvice.status !== "fallback" ? "AI 추천" : "규칙 기준안"}
                  centerValue="100%"
                  focusedAssetClass={focusedAssetClass}
                />
              </div>
              <div className="donut-legend" aria-label="자산군 색상과 추천 비중">
                {ASSET_CLASSES.filter((key: string) => effectivePlan.target[key] > 0).map((key: string) => (
                  <button
                    key={key}
                    className={focusedAssetClass === key ? "active" : ""}
                    onClick={() => setFocusedAssetClass((current) => current === key ? null : key)}
                  >
                    <span className="legend-dot" style={{ background: COLORS[key] }} />
                    <span>{shortAssetLabel(key)}</span>
                    <strong>{Number(effectivePlan.target[key]).toFixed(1)}%</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel specification-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">현재·추천·조치를 한 행에서 비교</span>
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
                  {effectivePlan.limitations.map((item) => <p key={item.assetClass}>{item.message}</p>)}
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <RebalanceView plan={effectivePlan} />
        )}

        <section className="panel performance-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">자동 전환이 아닌 비교정보</span>
              <h2>KB 적금 대비 성과 점검</h2>
            </div>
            <span className="period-pill">최근 12개월</span>
          </div>
          <div className="comparison-grid">
            <div className="benchmark-card">
              <span>비교 대상</span>
              <strong>{plan.performanceComparison.productName}</strong>
              <dl>
                <div><dt>기본금리</dt><dd>{plan.performanceComparison.baseRate}%</dd></div>
                <div><dt>확인 우대 적용</dt><dd>{plan.performanceComparison.expectedRate}%</dd></div>
                <div><dt>세후 기준수익률</dt><dd>{plan.performanceComparison.expectedAfterTax}%</dd></div>
              </dl>
            </div>
            <div className="performance-score">
              <span>동일 기간 포트폴리오 세후 수익률</span>
              <strong>{plan.performanceComparison.portfolioAfterTaxReturn}%</strong>
              <p>
                KB 적금 예상 대비{" "}
                <b>
                  {plan.performanceComparison.difference != null &&
                  plan.performanceComparison.difference > 0
                    ? "+"
                    : ""}
                  {plan.performanceComparison.difference ?? "계산 제외"}%p
                </b>
              </p>
            </div>
            <div className="cause-list">
              <span>주요 원인</span>
              {plan.performanceComparison.causes.map((cause: string) => <p key={cause}>· {cause}</p>)}
            </div>
          </div>
          <div className="choice-row">
            {plan.performanceComparison.options.map((option: string) => <button key={option}>{option}</button>)}
          </div>
          <p className="tax-disclaimer">
            {String(INVESTMENT_TAX_RULES.disclaimer)} 본 계산은{" "}
            {String(INVESTMENT_TAX_RULES.demo_label)}입니다.
          </p>
        </section>

        <footer>
          <strong>KB 우리 아이 자산관리</strong>
          <p>프로토타입용 샘플 데이터 · 실제 금융자문, 계좌 개설 또는 주문 서비스가 아닙니다.</p>
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
              <GoalForm state={state} setState={setState} close={() => setModal(null)} />
            ) : null}
            {modal === "gift" ? (
              <form onSubmit={simulateGift}>
                <span className="eyebrow">원본 샘플은 변경하지 않음</span>
                <h2>추가 증여 시뮬레이션</h2>
                <label>증여일<input type="date" value={giftForm.date} onChange={(event) => setGiftForm({ ...giftForm, date: event.target.value })} /></label>
                <label>금액<input type="number" min="1" value={giftForm.amount} onChange={(event) => setGiftForm({ ...giftForm, amount: event.target.value })} /></label>
                <label>
                  증여자 관계
                  <select
                    value={giftForm.donorRelationship}
                    onChange={(event) =>
                      setGiftForm({ ...giftForm, donorRelationship: event.target.value })
                    }
                  >
                    <option value="부">부</option>
                    <option value="모">모</option>
                    <option value="조부모">조부모</option>
                  </select>
                </label>
                <label>메모<input value={giftForm.memo} onChange={(event) => setGiftForm({ ...giftForm, memo: event.target.value })} /></label>
                <p className="form-note">
                  2천만원은 일률적인 비과세 한도가 아니라 직계존속 증여재산공제입니다.
                  실제 신고 여부와 세액은 별도로 확인해야 합니다.
                </p>
                <button className="primary-button full-button" type="submit">세금 시뮬레이션 적용</button>
              </form>
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

function GiftTaxSummary({
  result,
  history,
  proposedGift,
  openSimulator,
}: {
  result: ReturnType<typeof generatePlan>["giftTax"];
  history: typeof prototypeCatalog.data.giftHistory;
  proposedGift: PrototypeState["proposedGift"];
  openSimulator: () => void;
}) {
  if (!result.applicable) return null;
  return (
    <section className="panel gift-tax-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">결정론적 증여세 규칙 엔진</span>
          <h2>10년 증여재산공제 시뮬레이션</h2>
        </div>
        <button className="secondary-button" onClick={openSimulator}>금액 바꾸기</button>
      </div>
      <div className="gift-scenario-line">
        <strong>기존 {history.length}건 {compactCurrency(result.previousTotal)}</strong>
        <span>+</span>
        <strong>{proposedGift.donorRelationship} 추가 {compactCurrency(result.proposedAmount)}</strong>
        <span>=</span>
        <strong>{compactCurrency(result.combinedTotal)}</strong>
      </div>
      <div className="tax-metric-grid">
        <div>
          <span>추가 전 잔여 공제</span>
          <strong>{compactCurrency(result.remainingDeductionBefore)}</strong>
        </div>
        <div>
          <span>추정 과세표준</span>
          <strong>{compactCurrency(result.taxableBase)}</strong>
        </div>
        <div>
          <span>기본 산출세액</span>
          <strong>{compactCurrency(result.calculatedTax)}</strong>
        </div>
        <div>
          <span>3% 신고공제 가정 후</span>
          <strong>{compactCurrency(result.estimatedTaxAfterCredit)}</strong>
        </div>
        <div>
          <span>신고기한</span>
          <strong>{result.filingDueDate}</strong>
        </div>
      </div>
      <div className="tax-explanation">
        <strong>“2천만원 비과세”가 아니라 증여재산공제를 적용한 추정 결과입니다.</strong>
        <p>
          동일 부모·배우자 그룹의 최근 10년 증여를 합산했습니다. 현재 사례의 선행 증여액은{" "}
          {compactCurrency(result.sameDonorPriorTotal)}이며 합산과세 기준을{" "}
          {result.aggregationApplies ? "충족합니다" : "충족하지 않습니다"}.
        </p>
        <small>{result.disclaimer}</small>
      </div>
    </section>
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

function AiAdvisorStatus({
  advice,
  loading,
  run,
}: {
  advice: AiAdvice | null;
  loading: boolean;
  run: () => void;
}) {
  const providerLabel =
    advice?.provider === "gemini"
      ? "Gemini"
      : advice?.provider === "ollama"
        ? "Ollama"
        : "규칙 엔진";
  const statusLabel =
    advice?.status === "validated"
      ? `${providerLabel} AI 제안 · 정책 검증 통과`
      : advice?.status === "adjusted"
        ? "AI 원안 · 정책 엔진 보정"
        : advice?.status === "fallback"
          ? "AI 연결 실패 · 규칙 기반 대체 결과"
          : "분석 전 · 규칙 기준안";
  return (
    <div className={`advisor-status-card ${advice?.status ?? "idle"}`}>
      <div className="advisor-status-main">
        <div>
          <span className="advisor-kicker">PortfolioAdvisorAgent</span>
          <strong>{statusLabel}</strong>
          <p>
            {advice?.proposal.summary ??
              "선호 순위와 투자기간으로 만든 기준안입니다. AI 분석 후 검증된 제안이 이 화면 전체에 반영됩니다."}
          </p>
        </div>
        <button className="ai-run-button" onClick={run} disabled={loading}>
          {loading ? "AI 분석 중…" : advice ? "AI 다시 분석" : "AI 포트폴리오 분석"}
        </button>
      </div>
      <div className="advisor-facts">
        <span>{advice?.model ? `사용 모델 · ${providerLabel} / ${advice.model}` : "금융 계산 · 규칙 엔진"}</span>
        {(advice?.consideredFactors?.length
          ? advice.consideredFactors
          : ["선호 순위", "투자기간", "KB 상품 적합성", "세금·수수료"]
        ).slice(0, 4).map((item) => <small key={item}>{item}</small>)}
      </div>
      {advice?.adjustments?.length ? (
        <details className="advisor-adjustments">
          <summary>정책 엔진 보정 {advice.adjustments.length}건 보기</summary>
          {advice.adjustments.map((item) => <p key={item}>· {item}</p>)}
        </details>
      ) : null}
    </div>
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
  );
  return (
    <div className="specification-table-wrap">
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
          {rows.map((assetClass: string) => {
            const item = itemByClass.get(assetClass);
            const currentWeight = Number(plan.current.weights[assetClass] ?? 0);
            const targetWeight = Number(plan.target[assetClass] ?? 0);
            const currentAmount = Number(plan.current.amounts[assetClass] ?? 0);
            const targetAmount = Math.round((plan.current.total * targetWeight) / 100);
            const deltaWeight = targetWeight - currentWeight;
            const deltaAmount = targetAmount - currentAmount;
            const advisorAction = item && "advisorAction" in item ? String(item.advisorAction) : undefined;
            const action = displayAction(currentWeight, targetWeight, advisorAction);
            const expanded = expandedAssetClass === assetClass;
            return (
              <Fragment key={assetClass}>
                <tr
                  className={`${focusedAssetClass === assetClass ? "focused" : ""} ${expanded ? "expanded" : ""}`}
                  onMouseEnter={() => setFocusedAssetClass(assetClass)}
                  onMouseLeave={() => setFocusedAssetClass(null)}
                >
                  <td data-label="자산군">
                    <button
                      className="asset-toggle"
                      onClick={() => setExpandedAssetClass(expanded ? null : assetClass)}
                      aria-expanded={expanded}
                    >
                      <span className="legend-dot" style={{ background: COLORS[assetClass] }} />
                      <span>{shortAssetLabel(assetClass)}</span>
                      <b aria-hidden="true">{expanded ? "−" : "+"}</b>
                    </button>
                  </td>
                  <td data-label="현재"><strong>{currentWeight.toFixed(1)}%</strong><small>{compactCurrency(currentAmount)}</small></td>
                  <td data-label="추천"><strong>{targetWeight.toFixed(1)}%</strong><small>{compactCurrency(targetAmount)}</small></td>
                  <td data-label="차이" className={deltaWeight > 1 ? "positive" : deltaWeight < -1 ? "negative" : "neutral"}>
                    <strong>{deltaWeight > 0 ? "+" : ""}{deltaWeight.toFixed(1)}%p</strong>
                    <small>{deltaAmount > 0 ? "+" : ""}{compactCurrency(deltaAmount)}</small>
                  </td>
                  <td data-label="KB 상품">
                    {item ? <><span className={providerClass(item.provider)}>{item.provider}</span><strong className="product-name-cell">{item.name}</strong></> : <span>적합 후보 없음</span>}
                  </td>
                  <td data-label="조치"><span className={`action-badge action-${action.replace(/\s/g, "-")}`}>{action}</span></td>
                  <td data-label="위험">{item ? `${item.riskGrade}등급` : "-"}</td>
                </tr>
                {expanded ? (
                  <tr className="specification-detail-row">
                    <td colSpan={7}>
                      {item ? (
                        <div className="specification-detail">
                          <div className="detail-reason">
                            <span>추천 근거</span>
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
  );
}

function GoalForm({
  state,
  setState,
  close,
}: {
  state: PrototypeState;
  setState: React.Dispatch<React.SetStateAction<PrototypeState>>;
  close: () => void;
}) {
  return (
    <div>
      <span className="eyebrow">두 가지 선호 순위</span>
      <h2>목표·투자 성향 설정</h2>
      <label>
        남은 투자기간
        <select
          value={state.horizonYears}
          onChange={(event) => setState((current) => ({ ...current, horizonYears: Number(event.target.value) }))}
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
          value={state.monthlyContribution}
          onChange={(event) => setState((current) => ({ ...current, monthlyContribution: Number(event.target.value) }))}
        />
      </label>
      <RankingList
        title="자산 선호 순위"
        description="목표 포트폴리오의 적금·예금·주식·채권 비중에 반영합니다."
        ranking={state.assetRanking}
        labels={ASSET_PREFERENCE_LABELS}
        onChange={(assetRanking) => setState((current) => ({ ...current, assetRanking }))}
      />
      <RankingList
        title="투자 방식 순위"
        description="주식 비중 안에서 ETF·개별종목과 미주·국내 배분에 반영합니다."
        ranking={state.strategyRanking}
        labels={STRATEGY_PREFERENCE_LABELS}
        onChange={(strategyRanking) =>
          setState((current) => ({ ...current, strategyRanking }))
        }
      />
      <p className="form-note">
        이 순위는 프로토타입의 목표 배분 기준이며 공식 투자성향 진단이 아닙니다.
      </p>
      <button className="primary-button full-button" onClick={close}>추천 다시 계산</button>
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

function RebalanceView({ plan }: { plan: ReturnType<typeof generatePlan> }) {
  return (
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
  );
}
