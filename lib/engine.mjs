import {
  GiftTaxPolicyEngine,
  InvestmentTaxFeeEngine,
  KbProductPolicyEngine,
} from "./rules.mjs";

export const ASSET_CLASSES = [
  "cash",
  "savings",
  "deposit",
  "fund",
  "domesticEtf",
  "overseasEtf",
  "domesticStock",
  "overseasStock",
];

export const ASSET_LABELS = {
  cash: "KB국민은행 입출금·대기자금",
  savings: "KB국민은행 적금",
  deposit: "KB국민은행 예금",
  fund: "KB국민은행 가입 가능 펀드",
  domesticEtf: "KB증권 국내 ETF",
  overseasEtf: "KB증권 해외 ETF",
  domesticStock: "KB증권 국내 개별주식",
  overseasStock: "KB증권 해외 개별주식",
};

export const ASSET_PREFERENCES = ["savings", "deposit", "stock", "bond"];
export const STRATEGY_PREFERENCES = ["etf", "individual", "us", "domestic"];

export const PREFERENCE_LABELS = {
  savings: "적금",
  deposit: "예금",
  stock: "주식",
  bond: "채권",
  etf: "ETF",
  individual: "개별종목",
  us: "미주",
  domestic: "국내종목",
};

const RANK_WEIGHTS = [40, 30, 20, 10];

const DAY = 86_400_000;

export function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const headers = rows.shift() ?? [];
  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, castCsv(cells[index] ?? "")])),
  );
}

function castCsv(value) {
  const clean = value.trim();
  if (clean === "") return null;
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(clean)) return Number(clean);
  return clean;
}

export function parseTaxYaml(input) {
  const result = {};
  for (const line of input.split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/);
    if (!match) continue;
    let value = match[2].trim().replace(/^"|"$/g, "");
    if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    result[match[1]] = value;
  }
  return result;
}

export function calculateAge(birthDate, asOf) {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const date = new Date(`${asOf}T00:00:00Z`);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

export function getFreshness(lastVerifiedAt, asOf) {
  if (!lastVerifiedAt) return { status: "expired", days: Infinity };
  const days = Math.floor(
    (new Date(`${asOf}T00:00:00Z`) - new Date(`${lastVerifiedAt}T00:00:00Z`)) / DAY,
  );
  if (days <= 30) return { status: "fresh", days };
  if (days <= 90) return { status: "warning", days };
  return { status: "expired", days };
}

function scaleGrowthAssets(allocation, cap, stockCap = Infinity) {
  const result = { ...allocation };
  const stockTotal = result.domesticStock + result.overseasStock;
  if (stockTotal > stockCap) {
    const ratio = stockCap / stockTotal;
    result.domesticStock *= ratio;
    result.overseasStock *= ratio;
  }
  const riskyKeys = ["domesticEtf", "overseasEtf", "domesticStock", "overseasStock"];
  const riskyTotal = riskyKeys.reduce((sum, key) => sum + result[key], 0);
  if (riskyTotal > cap) {
    const ratio = cap / riskyTotal;
    for (const key of riskyKeys) result[key] *= ratio;
  }
  const total = ASSET_CLASSES.reduce((sum, key) => sum + result[key], 0);
  const shortfall = 100 - total;
  const safeKeys = ["cash", "savings", "deposit", "fund"];
  const safeTotal = safeKeys.reduce((sum, key) => sum + result[key], 0);
  for (const key of safeKeys) {
    result[key] += shortfall * (result[key] / safeTotal);
  }
  return Object.fromEntries(
    ASSET_CLASSES.map((key) => [key, Number(result[key].toFixed(1))]),
  );
}

function normalizeRanking(ranking, allowed) {
  if (
    Array.isArray(ranking) &&
    ranking.length === allowed.length &&
    ranking.every((item) => allowed.includes(item)) &&
    new Set(ranking).size === allowed.length
  ) {
    return [...ranking];
  }
  return [...allowed];
}

export function calculatePreferenceAllocation({
  assetRanking,
  strategyRanking,
  horizonYears,
}) {
  const normalizedAssets = normalizeRanking(assetRanking, ASSET_PREFERENCES);
  const normalizedStrategies = normalizeRanking(strategyRanking, STRATEGY_PREFERENCES);
  const familyAllocation = Object.fromEntries(
    normalizedAssets.map((key, index) => [key, (90 * RANK_WEIGHTS[index]) / 100]),
  );
  const etfPreferred =
    normalizedStrategies.indexOf("etf") < normalizedStrategies.indexOf("individual");
  const usPreferred =
    normalizedStrategies.indexOf("us") < normalizedStrategies.indexOf("domestic");
  const etfShare = etfPreferred ? 0.7 : 0.3;
  const individualShare = 1 - etfShare;
  const usShare = usPreferred ? 0.6 : 0.4;
  const domesticShare = 1 - usShare;
  const stockAllocation = familyAllocation.stock;
  const base = {
    cash: 10,
    savings: familyAllocation.savings,
    deposit: familyAllocation.deposit,
    fund: familyAllocation.bond,
    domesticEtf: stockAllocation * etfShare * domesticShare,
    overseasEtf: stockAllocation * etfShare * usShare,
    domesticStock: stockAllocation * individualShare * domesticShare,
    overseasStock: stockAllocation * individualShare * usShare,
  };
  const rounded = Object.fromEntries(
    ASSET_CLASSES.map((key) => [key, Number(base[key].toFixed(1))]),
  );
  const target =
    horizonYears < 3
      ? scaleGrowthAssets(rounded, 20)
      : horizonYears <= 5
        ? scaleGrowthAssets(rounded, 45, 10)
        : rounded;

  return {
    label: `${PREFERENCE_LABELS[normalizedAssets[0]]} 우선 · ${
      etfPreferred ? "ETF" : "개별종목"
    } 중심 · ${usPreferred ? "미주" : "국내종목"} 중심`,
    assetRanking: normalizedAssets,
    strategyRanking: normalizedStrategies,
    target,
  };
}

export function eligibleBankProducts(products, context, productPolicies = { rules: {} }) {
  const engine = new KbProductPolicyEngine(productPolicies);
  return products.filter((product) => engine.evaluateBankProduct(product, context).eligible);
}

export function eligibleSecuritiesAssets(assets, context, productPolicies = { rules: {} }) {
  const engine = new KbProductPolicyEngine(productPolicies);
  return assets.filter((asset) => engine.evaluateSecurity(asset, context).eligible);
}

export function parsePreferentialConditions(value) {
  if (!value) return [];
  return String(value)
    .split(";")
    .map((condition) => {
      const [id, label, bonus] = condition.split("|");
      return { id, label, bonusRate: Number(bonus ?? 0) };
    })
    .filter((condition) => condition.id && condition.label);
}

export function getRateQuote(product, evidence = {}, asOf) {
  const freshness = getFreshness(product.last_verified_at, asOf);
  const conditions = parsePreferentialConditions(product.preferential_rate_conditions).map(
    (condition) => ({
      ...condition,
      status:
        evidence[condition.id] === "confirmed"
          ? "충족 확인"
          : evidence[condition.id] === "possible"
            ? "충족 가능"
            : "충족 여부 미확인",
    }),
  );
  const confirmedBonus = conditions
    .filter((condition) => condition.status === "충족 확인")
    .reduce((sum, condition) => sum + condition.bonusRate, 0);
  const potentialBonus = conditions
    .filter((condition) => condition.status !== "충족 확인")
    .reduce((sum, condition) => sum + condition.bonusRate, 0);
  const calculable = freshness.status === "fresh" && product.base_rate != null;
  return {
    baseRate: calculable ? product.base_rate : null,
    expectedRate: calculable ? Number((product.base_rate + confirmedBonus).toFixed(2)) : null,
    confirmedBonus: calculable ? confirmedBonus : 0,
    potentialBonus,
    maximumRate: product.maximum_rate,
    conditions,
    freshness,
    warning:
      freshness.status === "warning"
        ? "금리 확인일이 30일을 지나 예상수익 계산에서 제외했습니다."
        : freshness.status === "expired"
          ? "상품정보가 오래되어 신규 추천에서 제외했습니다."
          : null,
  };
}

function classifyBank(product) {
  if (!product) return "cash";
  if (product.product_category === "demand_deposit") return "cash";
  if (product.product_category === "installment_savings") return "savings";
  if (product.product_category === "term_deposit") return "deposit";
  return "fund";
}

function classifySecurity(asset) {
  const overseas = asset.market !== "KRX";
  if (asset.vehicle_type === "etf") return overseas ? "overseasEtf" : "domesticEtf";
  return overseas ? "overseasStock" : "domesticStock";
}

export function aggregateHoldings(data, bankProducts, securitiesAssets) {
  const amounts = Object.fromEntries(ASSET_CLASSES.map((key) => [key, 0]));
  const bankById = new Map(bankProducts.map((item) => [item.product_id, item]));
  const securityById = new Map(securitiesAssets.map((item) => [item.asset_id, item]));

  for (const account of data.bankAccounts) {
    amounts[classifyBank(bankById.get(account.productId))] += account.balance;
  }
  for (const account of data.securitiesAccounts) amounts.cash += account.cashBalance;
  for (const holding of data.securitiesHoldings) {
    const asset = securityById.get(holding.assetId);
    if (asset) amounts[classifySecurity(asset)] += holding.marketValue;
  }
  const total = Object.values(amounts).reduce((sum, amount) => sum + amount, 0);
  const weights = Object.fromEntries(
    ASSET_CLASSES.map((key) => [key, total ? (amounts[key] / total) * 100 : 0]),
  );
  return { amounts, weights, total };
}

function productMatchesClass(product, assetClass) {
  return classifyBank(product) === assetClass;
}

function securityMatchesClass(asset, assetClass) {
  return asset.asset_class?.includes("equity") && classifySecurity(asset) === assetClass;
}

function bankPriority(product, heldProductIds) {
  if (heldProductIds.has(product.product_id)) return 500;
  if (product.product_subcategory?.startsWith("youth")) return 400;
  if (["installment_savings", "term_deposit", "demand_deposit"].includes(product.product_category))
    return 300;
  if (product.product_subcategory === "bond_fund") return 250;
  return 200;
}

function recommendationReason(assetClass, held, item, preference) {
  if (held) return "현재 보유 중이며 목표 자산군과 가입 조건에 맞아 우선 유지합니다.";
  if (assetClass === "savings")
    return "적금 선호 순위와 자녀 연령, 월 납입 예정액, 목표기간을 확인한 KB국민은행 후보입니다.";
  if (assetClass === "deposit")
    return "예금 선호 순위와 만기 계획에 맞는 KB국민은행 정기예금 후보입니다.";
  if (assetClass === "fund")
    return "채권 선호 비중에 맞춰 KB국민은행에서 가입 가능한 채권형 펀드를 우선 연결합니다.";
  if (assetClass.includes("Etf"))
    return `${preference.label} 선택을 반영한 분산투자 후보로 KB증권 M-able에서 확인할 수 있습니다.`;
  if (assetClass.includes("Stock"))
    return `${preference.label} 선택을 반영해 제한된 개별종목 비중에만 적용하는 KB증권 후보입니다.`;
  return `${item.product_name ?? item.name}을 대기자금 용도로 활용합니다.`;
}

export function generatePlan({
  bankProducts,
  securitiesAssets,
  data,
  profile,
  asOf = data.asOf,
  giftTaxRules = null,
  investmentTaxRules = {},
  feeAssumptions = { schedules: {} },
  productPolicies = { rules: {} },
  proposedGift = null,
}) {
  const child = data.children[0];
  const age = calculateAge(child.birthDate, asOf);
  const preference = calculatePreferenceAllocation({
    assetRanking: profile.assetRanking,
    strategyRanking: profile.strategyRanking,
    horizonYears: profile.horizonYears,
  });
  const target = preference.target;
  const current = aggregateHoldings(data, bankProducts, securitiesAssets);
  const context = {
    age,
    asOf,
    horizonYears: profile.horizonYears,
    monthlyContribution: profile.monthlyContribution,
  };
  const banks = eligibleBankProducts(bankProducts, context, productPolicies);
  const securities = eligibleSecuritiesAssets(securitiesAssets, context, productPolicies);
  const taxFeeEngine = new InvestmentTaxFeeEngine(investmentTaxRules, feeAssumptions);
  const heldProductIds = new Set(data.bankAccounts.map((account) => account.productId));
  const heldAssetIds = new Set(data.securitiesHoldings.map((holding) => holding.assetId));
  const recommendations = [];
  const limitations = [];

  for (const assetClass of ASSET_CLASSES) {
    if (target[assetClass] <= 0) continue;
    const targetAmount = Math.round((current.total * target[assetClass]) / 100);
    const actionAmount = Math.max(0, targetAmount - current.amounts[assetClass]);
    let item;
    let held = false;
    let kind;

    if (["cash", "savings", "deposit", "fund"].includes(assetClass)) {
      item = banks
        .filter((product) => productMatchesClass(product, assetClass))
        .sort((a, b) => bankPriority(b, heldProductIds) - bankPriority(a, heldProductIds))[0];
      held = Boolean(item && heldProductIds.has(item.product_id));
      kind = "bank";
    } else {
      item = securities
        .filter((asset) => securityMatchesClass(asset, assetClass))
        .sort(
          (a, b) =>
            Number(heldAssetIds.has(b.asset_id)) - Number(heldAssetIds.has(a.asset_id)) ||
            Number(a.expense_ratio ?? 99) - Number(b.expense_ratio ?? 99),
        )[0];
      held = Boolean(item && heldAssetIds.has(item.asset_id));
      kind = "security";
    }

    if (!item) {
      limitations.push({
        assetClass,
        message: `${ASSET_LABELS[assetClass]}의 검증된 KB 후보가 없어 비중을 비워 두었습니다.`,
      });
      continue;
    }

    const rateQuote = kind === "bank" ? getRateQuote(item, data.eligibilityEvidence, asOf) : null;
    const expectedReturnRate =
      rateQuote?.expectedRate ??
      item.expected_return_assumption ??
      0;
    const costEstimate = taxFeeEngine.estimate(item, {
      amount: targetAmount,
      expectedReturnRate,
      holdingYears: 1,
      action: "buy",
    });
    recommendations.push({
      assetClass,
      label: ASSET_LABELS[assetClass],
      kind,
      id: item.product_id ?? item.asset_id,
      name: item.product_name ?? item.name,
      provider: item.provider,
      channel: item.subscription_channel ?? "KB증권 M-able",
      targetWeight: target[assetClass],
      targetAmount,
      actionAmount,
      held,
      riskGrade: item.risk_grade ?? item.risk_level,
      eligible: true,
      reason: recommendationReason(assetClass, held, item, preference),
      rateQuote,
      expectedReturn: item.expected_return_assumption,
      maturity:
        item.contract_months > 0
          ? `${item.contract_months}개월`
          : item.recommended_holding_months
            ? `권장 ${item.recommended_holding_months}개월`
            : "수시",
      warning: item.liquidity_warning ?? item.early_termination_rule,
      depositProtection: Boolean(item.deposit_protection),
      effectiveDate: item.effective_date,
      sourceName: item.source_name,
      sourceReference: item.source_reference,
      symbol: item.symbol,
      taxCategory: item.tax_category,
      feeScheduleId: item.fee_schedule_id,
      policyRuleIds: item.policy_rule_ids,
      expenseRatio: item.expense_ratio,
      costEstimate,
    });
  }

  recommendations.sort(
    (a, b) => b.targetWeight - a.targetWeight || Number(b.held) - Number(a.held),
  );

  const rebalancing = buildRebalancing({
    data,
    bankProducts,
    current,
    recommendations,
    asOf,
  });
  const performanceComparison = buildPerformanceComparison(
    banks,
    data,
    investmentTaxRules,
    asOf,
  );
  const giftTax =
    giftTaxRules && proposedGift
      ? new GiftTaxPolicyEngine(giftTaxRules).evaluate(
          data.giftHistory,
          proposedGift,
          child,
          asOf,
        )
      : { applicable: false, reason: "추가 증여 시나리오가 없습니다." };

  return {
    age,
    preference,
    target,
    current,
    recommendations,
    limitations,
    rebalancing,
    performanceComparison,
    giftTax,
    policyFacts: {
      age,
      asOf,
      horizonYears: profile.horizonYears,
      monthlyContribution: profile.monthlyContribution,
      eligibleProductIds: recommendations.map((item) => item.id),
      giftTax,
      safetyGuardrail:
        profile.horizonYears < 3
          ? "ETF·개별주식 합계 20% 이하"
          : profile.horizonYears <= 5
            ? "ETF·개별주식 합계 45% 이하·개별주식 10% 이하"
            : "장기 투자 선호순위 적용",
    },
  };
}

export function applyAdvisorProposal({
  basePlan,
  proposal,
  data,
  bankProducts,
  investmentTaxRules = {},
  feeAssumptions = { schedules: {} },
  asOf = data.asOf,
}) {
  const target = Object.fromEntries(
    ASSET_CLASSES.map((key) => [key, Number(proposal.allocations?.[key] ?? 0)]),
  );
  const candidateById = new Map(basePlan.recommendations.map((item) => [item.id, item]));
  const taxFeeEngine = new InvestmentTaxFeeEngine(investmentTaxRules, feeAssumptions);
  const recommendations = proposal.recommendations
    .map((advisorItem) => {
      const candidate = candidateById.get(advisorItem.productId);
      if (!candidate) return null;
      const targetWeight = target[advisorItem.assetClass];
      const targetAmount = Math.round((basePlan.current.total * targetWeight) / 100);
      const expectedReturnRate =
        candidate.rateQuote?.expectedRate ?? candidate.expectedReturn ?? 0;
      const costEstimate = taxFeeEngine.estimate(
        {
          tax_category: candidate.taxCategory,
          fee_schedule_id: candidate.feeScheduleId,
          expense_ratio: candidate.expenseRatio,
          provider: candidate.provider,
        },
        {
          amount: targetAmount,
          expectedReturnRate,
          holdingYears: 1,
          action: "buy",
        },
      );
      return {
        ...candidate,
        targetWeight,
        targetAmount,
        actionAmount: Math.max(
          0,
          targetAmount - basePlan.current.amounts[advisorItem.assetClass],
        ),
        reason: advisorItem.rationale || candidate.reason,
        advisorAction: advisorItem.action,
        costEstimate,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.targetWeight - a.targetWeight || Number(b.held) - Number(a.held));

  return {
    ...basePlan,
    target,
    recommendations,
    rebalancing: buildRebalancing({
      data,
      bankProducts,
      current: basePlan.current,
      recommendations,
      asOf,
    }),
    advisorApplied: true,
  };
}

function buildRebalancing({ data, bankProducts, current, recommendations, asOf }) {
  const available =
    data.cashFlows.newBankDeposit + data.cashFlows.securitiesCashAndDividends;
  const deficits = recommendations
    .map((item) => ({ ...item, gap: Math.max(0, item.targetAmount - current.amounts[item.assetClass]) }))
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  let remaining = available;
  const allocations = deficits.slice(0, 3).map((item) => {
    const amount = Math.min(item.gap, remaining);
    remaining -= amount;
    return { assetClass: item.assetClass, label: item.label, amount };
  }).filter((item) => item.amount > 0);

  const bankById = new Map(bankProducts.map((item) => [item.product_id, item]));
  const holds = data.bankAccounts
    .filter((account) => account.maturityDate)
    .map((account) => {
      const product = bankById.get(account.productId);
      const days = Math.ceil(
        (new Date(`${account.maturityDate}T00:00:00Z`) - new Date(`${asOf}T00:00:00Z`)) / DAY,
      );
      const expectedImprovement = account.balance * 0.01;
      const maturitySoon = days <= 90;
      const lossDominates = account.earlyTerminationLoss >= expectedImprovement;
      return {
        accountName: account.accountName,
        productName: product?.product_name ?? account.accountName,
        maturityDate: account.maturityDate,
        balance: account.balance,
        keep: maturitySoon || lossDominates,
        reason: maturitySoon
          ? `만기까지 ${Math.max(days, 0)}일로 가까워 즉시 해지하지 않습니다.`
          : lossDominates
            ? "중도해지 손실이 12개월 환산 기대 개선액보다 커 유지합니다."
            : "목표 비중과 비용을 다시 확인한 뒤 해지를 검토할 수 있습니다.",
        reservation: "만기 후 목표 비중이 부족한 자산군으로 재배분 예약",
      };
    });

  return {
    available,
    remaining,
    allocations,
    holds,
    sequence: [
      "신규 KB국민은행 입금액 사용",
      "만기 도래 예·적금 자금 사용",
      "KB증권 배당금·예수금 사용",
      "5%p 초과 투자상품만 일부 매도 검토",
      "손실이 큰 예·적금은 만기까지 유지",
    ],
  };
}

function buildPerformanceComparison(bankProducts, data, investmentTaxRules, asOf) {
  const savings =
    bankProducts.find((product) => product.product_id === "KB-YOUNG-SAVINGS") ??
    bankProducts.find((product) => product.product_category === "installment_savings");
  const quote = savings ? getRateQuote(savings, data.eligibilityEvidence, asOf) : null;
  const taxRate = Number(investmentTaxRules.interest_income_tax_rate ?? 0.154);
  const baseAfterTax = quote?.baseRate == null ? null : quote.baseRate * (1 - taxRate);
  const expectedAfterTax =
    quote?.expectedRate == null ? null : quote.expectedRate * (1 - taxRate);
  return {
    productName: savings?.product_name ?? "비교 가능한 KB 적금 없음",
    baseRate: quote?.baseRate,
    expectedRate: quote?.expectedRate,
    baseAfterTax: baseAfterTax == null ? null : Number(baseAfterTax.toFixed(2)),
    expectedAfterTax: expectedAfterTax == null ? null : Number(expectedAfterTax.toFixed(2)),
    portfolioAfterTaxReturn: data.performance.portfolioAfterTaxReturn,
    difference:
      expectedAfterTax == null
        ? null
        : Number((data.performance.portfolioAfterTaxReturn - expectedAfterTax).toFixed(2)),
    causes: data.performance.mainCauses,
    options: ["현재 구성 유지", "신규 입금 배분 조정", "목표 비중 다시 설정"],
  };
}

export function shouldKeepDeposit({
  daysToMaturity,
  earlyTerminationLoss,
  expectedImprovement,
  safeAssetAfterWeight,
  safeAssetTargetWeight,
}) {
  return (
    daysToMaturity <= 90 ||
    earlyTerminationLoss >= expectedImprovement ||
    safeAssetAfterWeight < safeAssetTargetWeight - 5
  );
}
