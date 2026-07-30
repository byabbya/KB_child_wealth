"use client";

import { useEffect, useMemo, useState } from "react";
import { demoCatalog } from "@/lib/catalog";
import { ASSET_CLASSES, ASSET_LABELS, generatePlan } from "@/lib/engine.mjs";
import { StaticProductLinkProvider } from "@/lib/providers";

const STORAGE_KEY = "kb-child-portfolio-demo:v1";
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
const TAX_RULES = demoCatalog.taxRules as Record<string, string | number>;

type DemoState = {
  connected: boolean;
  approved: boolean;
  activeTab: "portfolio" | "rebalance";
  horizonYears: number;
  monthlyContribution: number;
  riskScores: number[];
  giftHistory: Array<{ giftId: string; date: string; amount: number; memo: string }>;
};

type MockLink = ReturnType<StaticProductLinkProvider["getLink"]>;
type SelectedItem = Record<string, unknown> & {
  name?: string;
  mockLink: MockLink;
};

const initialState: DemoState = {
  connected: true,
  approved: false,
  activeTab: "portfolio",
  horizonYears: 8,
  monthlyContribution: 500000,
  riskScores: [2, 2, 2, 2],
  giftHistory: demoCatalog.data.giftHistory,
};

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
  const [state, setState] = useState<DemoState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [modal, setModal] = useState<null | "goal" | "gift" | "assets" | "mock">(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [giftForm, setGiftForm] = useState({
    date: "2026-07-30",
    amount: "1000000",
    memo: "추가 증여",
  });
  const linkProvider = useMemo(() => new StaticProductLinkProvider(), []);

  useEffect(() => {
    let storedState: DemoState | null = null;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) storedState = { ...initialState, ...JSON.parse(stored) };
    } catch {
      // 손상된 로컬 데모 상태는 안전하게 샘플값으로 대체합니다.
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

  const data = useMemo(
    () => ({ ...demoCatalog.data, giftHistory: state.giftHistory }),
    [state.giftHistory],
  );
  const plan = useMemo(
    () =>
      generatePlan({
        bankProducts: demoCatalog.bankProducts,
        securitiesAssets: demoCatalog.securitiesAssets,
        data,
        profile: {
          riskScores: state.riskScores,
          horizonYears: state.horizonYears,
          monthlyContribution: state.monthlyContribution,
        },
        connected: state.connected,
        taxRules: demoCatalog.taxRules,
      }),
    [data, state.connected, state.horizonYears, state.monthlyContribution, state.riskScores],
  );

  const child = data.children[0];
  const giftTotal = state.giftHistory.reduce((sum, item) => sum + item.amount, 0);
  const targetProgress = Math.min(100, (plan.current.total / child.goalAmount) * 100);

  function openMock(
    item: Record<string, unknown> | null,
    action: "detail" | "subscribe" | "trade" | "connect",
  ) {
    const link = linkProvider.getLink(String(item?.id ?? "KBSEC-CONNECT"), action);
    setSelectedItem({ ...item, mockLink: link });
    setModal("mock");
  }

  function addGift(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(giftForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setState((current) => ({
      ...current,
      giftHistory: [
        ...current.giftHistory,
        {
          giftId: `gift-${Date.now()}`,
          date: giftForm.date,
          amount,
          memo: giftForm.memo || "증여 내역",
        },
      ],
    }));
    setModal(null);
  }

  function resetDemo() {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(initialState);
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
          <span className="demo-chip">공모전 DEMO</span>
          <button className="icon-button" onClick={resetDemo} aria-label="샘플 데이터 초기화">
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
            <button className="child-selector" aria-label="자녀 프로필 선택">
              <span className="avatar">민</span>
              <span>
                <small>자녀 프로필</small>
                <strong>{child.name}</strong>
              </span>
              <span aria-hidden="true">⌄</span>
            </button>
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
                <span>보호자 위험등급</span>
                <strong>{plan.risk.label}</strong>
              </div>
            </div>
          </div>

          <div className="connection-row">
            <div className="connection-copy">
              <span className={state.connected ? "status-dot connected" : "status-dot"} />
              <div>
                <strong>KB증권 자녀 계좌</strong>
                <span>{state.connected ? "동의 완료 · 자산 조회 중" : "연결 동의가 필요합니다"}</span>
              </div>
            </div>
            <button
              className="text-button"
              onClick={() => {
                if (state.connected) setState((current) => ({ ...current, connected: false }));
                else openMock(null, "connect");
              }}
            >
              {state.connected ? "연결 해제" : "KB증권 계좌 연결"}
            </button>
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
            <span>증여 내역<br />등록</span>
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
                  <span className="eyebrow">현재 vs 목표</span>
                  <h2>민서에게 맞는 자산 배분</h2>
                </div>
                <span className="risk-pill">{plan.risk.label} · {state.horizonYears}년</span>
              </div>

              <div className="bar-block">
                <div className="bar-label"><span>현재</span><strong>{compactCurrency(plan.current.total)}</strong></div>
                <div className="stacked-bar" aria-label="현재 자산 배분">
                  {ASSET_CLASSES.map((key: string) =>
                    plan.current.weights[key] > 0 ? (
                      <span
                        key={key}
                        title={`${LABELS[key]} ${plan.current.weights[key].toFixed(1)}%`}
                        style={{ width: `${plan.current.weights[key]}%`, background: COLORS[key] }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
              <div className="bar-block">
                <div className="bar-label"><span>목표</span><strong>장기 포트폴리오</strong></div>
                <div className="stacked-bar" aria-label="목표 자산 배분">
                  {ASSET_CLASSES.map((key: string) =>
                    plan.target[key] > 0 ? (
                      <span
                        key={key}
                        title={`${LABELS[key]} ${plan.target[key]}%`}
                        style={{ width: `${plan.target[key]}%`, background: COLORS[key] }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
              <div className="allocation-legend">
                {ASSET_CLASSES.filter((key: string) => plan.target[key] > 0).map((key: string) => (
                  <div key={key}>
                    <span className="legend-dot" style={{ background: COLORS[key] }} />
                    <span>{LABELS[key].replace("KB국민은행 ", "").replace("KB증권 ", "")}</span>
                    <strong>{plan.target[key]}%</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="recommendation-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">KB 상품 우선 매칭</span>
                  <h2>추천 포트폴리오</h2>
                </div>
                <span className="count-badge">{plan.recommendations.length}개 후보</span>
              </div>
              <div className="recommendation-grid">
                {plan.recommendations.map((item) => (
                  <article className="product-card" key={item.assetClass}>
                    <div className="card-top">
                      <span className={providerClass(item.provider)}>{item.provider}</span>
                      <span className="eligibility">가입·거래 가능</span>
                    </div>
                    <span className="asset-class">{item.label}</span>
                    <h3>{item.name}</h3>
                    {item.symbol ? <span className="symbol">{item.symbol}</span> : null}
                    <div className="recommendation-amount">
                      <div><span>추천 비중</span><strong>{item.targetWeight}%</strong></div>
                      <div><span>목표 금액</span><strong>{compactCurrency(item.targetAmount)}</strong></div>
                    </div>
                    <p className="reason">{item.reason}</p>
                    <dl className="product-meta">
                      <div><dt>위험등급</dt><dd>{item.riskGrade}등급</dd></div>
                      <div>
                        <dt>금리·수익 가정</dt>
                        <dd>
                          {item.rateQuote?.baseRate != null
                            ? `기본 ${item.rateQuote.baseRate}%`
                            : item.expectedReturn
                              ? `연 ${item.expectedReturn}% 가정`
                              : "시장 수익률 연동"}
                        </dd>
                      </div>
                      <div>
                        <dt>우대금리 가능성</dt>
                        <dd>
                          {item.rateQuote
                            ? item.rateQuote.confirmedBonus > 0
                              ? `확인 +${item.rateQuote.confirmedBonus.toFixed(2)}%p`
                              : "확인된 우대 없음"
                            : "해당 없음"}
                        </dd>
                      </div>
                      <div><dt>만기·권장기간</dt><dd>{item.maturity}</dd></div>
                      <div><dt>예금자보호</dt><dd>{item.depositProtection ? "보호" : "비보호"}</dd></div>
                      <div><dt>정보 기준일</dt><dd>{item.effectiveDate}</dd></div>
                    </dl>
                    <div className="warning-line"><span>!</span>{item.warning}</div>
                    <div className="source-line">출처 · {item.sourceName}</div>
                    <div className="card-actions">
                      <button className="secondary-button" onClick={() => openMock(item, "detail")}>
                        상품 자세히 보기
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => openMock(item, item.kind === "bank" ? "subscribe" : "trade")}
                      >
                        {item.kind === "bank" ? "가입 화면으로 이동" : "M-able에서 확인"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {plan.limitations.length > 0 ? (
                <div className="limitations">
                  <strong>KB 상품만으로 충족하지 못한 항목</strong>
                  {plan.limitations.map((item) => <p key={item.assetClass}>{item.message}</p>)}
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <RebalanceView plan={plan} />
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
            {TAX_RULES.disclaimer} 본 계산은 {TAX_RULES.demo_label}입니다.
          </p>
        </section>

        <section className={`approval-panel ${state.approved ? "approved" : ""}`}>
          <div>
            <span className="eyebrow">{state.approved ? "승인 기록 완료" : "보호자 최종 확인"}</span>
            <h2>{state.approved ? "제안이 승인되었습니다" : "이 포트폴리오 제안을 확인했나요?"}</h2>
            <p>
              {state.approved
                ? "실제 가입이나 주문은 실행되지 않았습니다. 각 KB 채널에서 최종 조건을 확인해 주세요."
                : "승인은 데모 상태만 저장하며 실제 금융거래를 실행하지 않습니다."}
            </p>
          </div>
          <button
            className="approval-button"
            onClick={() => setState((current) => ({ ...current, approved: !current.approved }))}
          >
            {state.approved ? "승인 취소" : "보호자 승인"}
          </button>
        </section>

        <footer>
          <strong>KB 우리 아이 자산관리</strong>
          <p>공모전 데모용 샘플 데이터 · 실제 금융자문, 계좌 개설 또는 주문 서비스가 아닙니다.</p>
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
              <form onSubmit={addGift}>
                <span className="eyebrow">최근 10년 내역에 추가</span>
                <h2>증여 내역 등록</h2>
                <label>증여일<input type="date" value={giftForm.date} onChange={(event) => setGiftForm({ ...giftForm, date: event.target.value })} /></label>
                <label>금액<input type="number" min="1" value={giftForm.amount} onChange={(event) => setGiftForm({ ...giftForm, amount: event.target.value })} /></label>
                <label>메모<input value={giftForm.memo} onChange={(event) => setGiftForm({ ...giftForm, memo: event.target.value })} /></label>
                <p className="form-note">세무 신고 여부는 별도로 확인해야 합니다.</p>
                <button className="primary-button full-button" type="submit">내역 저장</button>
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
                {selectedItem?.mockLink?.channel === "KB증권 M-able" && !state.connected ? (
                  <button
                    className="primary-button full-button"
                    onClick={() => {
                      setState((current) => ({ ...current, connected: true }));
                      setModal(null);
                    }}
                  >
                    데모 계좌 연결 동의
                  </button>
                ) : (
                  <button className="primary-button full-button" onClick={() => setModal(null)}>확인</button>
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}

function GoalForm({
  state,
  setState,
  close,
}: {
  state: DemoState;
  setState: React.Dispatch<React.SetStateAction<DemoState>>;
  close: () => void;
}) {
  const questions = [
    "시장 하락 시 손실을 감내할 수 있어요",
    "장기 투자 경험이 있어요",
    "중간 인출 없이 목표까지 유지할 수 있어요",
    "가격 변동이 있어도 계획을 유지할 수 있어요",
  ];
  return (
    <div>
      <span className="eyebrow">보호자 기준 4문항</span>
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
      <div className="risk-questions">
        {questions.map((question, index) => (
          <label key={question}>
            <span>{question}</span>
            <input
              type="range"
              min="0"
              max="4"
              value={state.riskScores[index]}
              onChange={(event) => {
                const scores = [...state.riskScores];
                scores[index] = Number(event.target.value);
                setState((current) => ({ ...current, riskScores: scores }));
              }}
            />
            <b>{state.riskScores[index]}점</b>
          </label>
        ))}
      </div>
      <button className="primary-button full-button" onClick={close}>추천 다시 계산</button>
    </div>
  );
}

function AssetsList({
  plan,
  data,
}: {
  plan: ReturnType<typeof generatePlan>;
  data: typeof demoCatalog.data;
}) {
  return (
    <div>
      <span className="eyebrow">KB금융그룹 통합 조회</span>
      <h2>우리 아이 전체 자산</h2>
      <div className="asset-list">
        {data.bankAccounts.map((account) => (
          <div key={account.accountId}>
            <span className="provider provider-bank">KB국민은행</span>
            <div><strong>{account.accountName}</strong><small>{account.maturityDate ? `${account.maturityDate} 만기` : "입출금 가능"}</small></div>
            <b>{compactCurrency(account.balance)}</b>
          </div>
        ))}
        {data.securitiesHoldings.map((holding) => {
          const asset = demoCatalog.securitiesAssets.find((item) => item.asset_id === holding.assetId);
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
      <p className="form-note">판매 중지 상품도 기존 보유자산으로 계속 표시됩니다.</p>
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
