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

export const RISK_LABELS = [
  "안정형",
  "안정추구형",
  "위험중립형",
  "적극투자형",
  "공격투자형",
];

export const BASE_ALLOCATIONS = {
  안정형: {
    cash: 15,
    savings: 30,
    deposit: 35,
    fund: 15,
    domesticEtf: 5,
    overseasEtf: 0,
    domesticStock: 0,
    overseasStock: 0,
  },
  안정추구형: {
    cash: 10,
    savings: 25,
    deposit: 25,
    fund: 15,
    domesticEtf: 10,
    overseasEtf: 15,
    domesticStock: 0,
    overseasStock: 0,
  },
  위험중립형: {
    cash: 10,
    savings: 15,
    deposit: 15,
    fund: 15,
    domesticEtf: 15,
    overseasEtf: 20,
    domesticStock: 5,
    overseasStock: 5,
  },
  적극투자형: {
    cash: 5,
    savings: 10,
    deposit: 10,
    fund: 15,
    domesticEtf: 20,
    overseasEtf: 25,
    domesticStock: 8,
    overseasStock: 7,
  },
  공격투자형: {
    cash: 5,
    savings: 5,
    deposit: 5,
    fund: 10,
    domesticEtf: 25,
    overseasEtf: 30,
    domesticStock: 10,
    overseasStock: 10,
  },
};

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

export function calculateRiskLevel(scores) {
  const score = scores.reduce((sum, item) => sum + Math.max(0, Math.min(4, Number(item))), 0);
  const index = score <= 3 ? 0 : score <= 6 ? 1 : score <= 9 ? 2 : score <= 12 ? 3 : 4;
  return { score, label: RISK_LABELS[index], index };
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

function scaleRiskAssets(allocation, cap, stockCap = Infinity) {
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

export function getTargetAllocation(riskLabel, horizonYears) {
  const base = BASE_ALLOCATIONS[riskLabel] ?? BASE_ALLOCATIONS.위험중립형;
  if (horizonYears < 3) return scaleRiskAssets(base, 20, 0);
  if (horizonYears <= 5) return scaleRiskAssets(base, 45, 10);
  return { ...base };
}

export function eligibleBankProducts(products, context) {
  return products.filter((product) => {
    const freshness = getFreshness(product.last_verified_at, context.asOf);
    const ageOk =
      (product.minimum_age == null || context.age >= product.minimum_age) &&
      (product.maximum_age == null || context.age <= product.maximum_age);
    const durationOk =
      !product.contract_months || product.contract_months <= context.horizonYears * 12;
    const amountOk =
      !product.monthly_payment_limit ||
      context.monthlyContribution <= product.monthly_payment_limit;
    const sourceOk =
      Boolean(product.source_name && product.source_reference) &&
      product.source_reference !== "source:demo-policy";
    const rateOk =
      !["installment_savings", "term_deposit"].includes(product.product_category) ||
      product.base_rate != null;
    return (
      product.provider === "KB국민은행" &&
      product.product_status === "active" &&
      product.minor_eligible === true &&
      ageOk &&
      durationOk &&
      amountOk &&
      sourceOk &&
      rateOk &&
      freshness.status !== "expired"
    );
  });
}

export function eligibleSecuritiesAssets(assets, context) {
  return assets.filter((asset) => {
    const freshness = getFreshness(asset.last_verified_at, context.asOf);
    return (
      asset.provider === "KB증권" &&
      asset.approved === true &&
      asset.minor_account_tradable === true &&
      asset.leverage_flag === false &&
      asset.inverse_flag === false &&
      Boolean(asset.source_name && asset.source_reference) &&
      asset.source_reference !== "source:demo-policy" &&
      freshness.status !== "expired"
    );
  });
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

export function aggregateHoldings(data, bankProducts, securitiesAssets, connected = true) {
  const amounts = Object.fromEntries(ASSET_CLASSES.map((key) => [key, 0]));
  const bankById = new Map(bankProducts.map((item) => [item.product_id, item]));
  const securityById = new Map(securitiesAssets.map((item) => [item.asset_id, item]));

  for (const account of data.bankAccounts) {
    amounts[classifyBank(bankById.get(account.productId))] += account.balance;
  }
  if (connected) {
    for (const account of data.securitiesAccounts) amounts.cash += account.cashBalance;
    for (const holding of data.securitiesHoldings) {
      const asset = securityById.get(holding.assetId);
      if (asset) amounts[classifySecurity(asset)] += holding.marketValue;
    }
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
  return classifySecurity(asset) === assetClass;
}

function bankPriority(product, heldProductIds) {
  if (heldProductIds.has(product.product_id)) return 500;
  if (product.product_subcategory?.startsWith("youth")) return 400;
  if (["installment_savings", "term_deposit", "demand_deposit"].includes(product.product_category))
    return 300;
  return 200;
}

function recommendationReason(assetClass, held, item) {
  if (held) return "현재 보유 중이며 목표 자산군과 가입 조건에 맞아 우선 유지합니다.";
  if (assetClass === "savings")
    return "자녀 연령, 월 납입 예정액과 목표기간을 확인한 KB국민은행 적금 후보입니다.";
  if (assetClass === "deposit")
    return "안전자산 목표와 만기 계획에 맞는 KB국민은행 정기예금 후보입니다.";
  if (assetClass === "fund")
    return "보호자 위험등급과 장기 목표에 맞춰 KB국민은행에서 가입 가능한 펀드를 연결합니다.";
  if (assetClass.includes("Etf"))
    return "개별종목보다 분산을 우선하며 KB증권 M-able 거래 화면으로 연결합니다.";
  if (assetClass.includes("Stock"))
    return "ETF 배분 후 남은 제한된 비중에만 적용하는 KB증권 거래 후보입니다.";
  return `${item.product_name ?? item.name}을 대기자금 용도로 활용합니다.`;
}

export function generatePlan({
  bankProducts,
  securitiesAssets,
  data,
  profile,
  connected = true,
  asOf = data.asOf,
  taxRules = {},
}) {
  const child = data.children[0];
  const age = calculateAge(child.birthDate, asOf);
  const risk = calculateRiskLevel(profile.riskScores);
  const target = getTargetAllocation(risk.label, profile.horizonYears);
  const current = aggregateHoldings(data, bankProducts, securitiesAssets, connected);
  const context = {
    age,
    asOf,
    horizonYears: profile.horizonYears,
    monthlyContribution: profile.monthlyContribution,
  };
  const banks = eligibleBankProducts(bankProducts, context);
  const securities = connected ? eligibleSecuritiesAssets(securitiesAssets, context) : [];
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
        message: connected
          ? `${ASSET_LABELS[assetClass]}의 검증된 KB 후보가 없어 비중을 비워 두었습니다.`
          : `${ASSET_LABELS[assetClass]}은 KB증권 계좌 연결 동의 후 확인할 수 있습니다.`,
      });
      continue;
    }

    const rateQuote = kind === "bank" ? getRateQuote(item, data.eligibilityEvidence, asOf) : null;
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
      reason: recommendationReason(assetClass, held, item),
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
    });
  }

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
    taxRules,
    asOf,
  );

  return {
    age,
    risk,
    target,
    current,
    recommendations,
    limitations,
    rebalancing,
    performanceComparison,
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

function buildPerformanceComparison(bankProducts, data, taxRules, asOf) {
  const savings =
    bankProducts.find((product) => product.product_id === "KB-YOUNG-SAVINGS") ??
    bankProducts.find((product) => product.product_category === "installment_savings");
  const quote = savings ? getRateQuote(savings, data.eligibilityEvidence, asOf) : null;
  const taxRate = Number(taxRules.interest_income_tax_rate ?? 0.154);
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
