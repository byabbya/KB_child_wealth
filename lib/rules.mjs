const DAY = 86_400_000;

function utcDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function subtractYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() - years);
  return result;
}

function roundWon(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function calculateAgeAt(birthDate, asOf) {
  const birth = utcDate(birthDate);
  const date = utcDate(asOf);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() && date.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function filingDueDate(giftDate, monthsAfterGiftMonth) {
  const date = utcDate(giftDate);
  const due = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + Number(monthsAfterGiftMonth) + 1,
      0,
    ),
  );
  return due.toISOString().slice(0, 10);
}

function progressiveTax(taxableBase, brackets) {
  if (taxableBase <= 0) return 0;
  const bracket =
    brackets.find((item) => item.up_to == null || taxableBase <= Number(item.up_to)) ??
    brackets[brackets.length - 1];
  return roundWon(
    taxableBase * Number(bracket?.rate ?? 0) - Number(bracket?.quick_deduction ?? 0),
  );
}

export function parsePolicyDocument(input) {
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("정책 파일은 JSON 호환 YAML 형식이어야 합니다.");
  }
}

export class GiftTaxPolicyEngine {
  constructor(policy) {
    this.policy = policy;
  }

  evaluate(history, proposedGift, child, asOf = proposedGift?.date) {
    const proposalDate = proposedGift?.date ?? asOf;
    if (!proposalDate || !proposedGift || Number(proposedGift.amount) <= 0) {
      return {
        applicable: false,
        reason: "증여일과 양수 금액이 필요합니다.",
      };
    }

    const proposalDateValue = utcDate(proposalDate);
    const windowStart = subtractYears(proposalDateValue, Number(this.policy.lookback_years ?? 10));
    const relevantHistory = history
      .filter((gift) => {
        const date = utcDate(gift.date);
        return date >= windowStart && date <= proposalDateValue;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const age = calculateAgeAt(child.birthDate, proposalDate);
    const deductionLimit = Number(
      age < 19
        ? this.policy.deductions.minor_direct_ascendant
        : this.policy.deductions.adult_direct_ascendant,
    );
    const previousTotal = relevantHistory.reduce(
      (sum, gift) => sum + roundWon(gift.amount),
      0,
    );
    const proposedAmount = roundWon(proposedGift.amount);
    const combinedTotal = previousTotal + proposedAmount;
    const deductionUsedBefore = Math.min(deductionLimit, previousTotal);
    const remainingDeductionBefore = Math.max(0, deductionLimit - deductionUsedBefore);
    const deductionAppliedToProposal = Math.min(remainingDeductionBefore, proposedAmount);

    const donorGroupId = proposedGift.donorGroupId ?? proposedGift.donorId ?? "unknown";
    const sameDonorHistory = relevantHistory.filter(
      (gift) => (gift.donorGroupId ?? gift.donorId ?? "unknown") === donorGroupId,
    );
    const sameDonorPriorTotal = sameDonorHistory.reduce(
      (sum, gift) => sum + roundWon(gift.amount),
      0,
    );
    const aggregationApplies =
      sameDonorPriorTotal >= Number(this.policy.same_donor_aggregation_threshold ?? 10_000_000);

    // 핵심 프로토타입은 동일 부모·배우자 그룹의 현금 증여를 다룹니다.
    // 복수 증여자 그룹이면 공제 사용 순서에 따라 실제 세액이 달라질 수 있어 경고합니다.
    const donorGroups = new Set(
      relevantHistory.map((gift) => gift.donorGroupId ?? gift.donorId ?? "unknown"),
    );
    donorGroups.add(donorGroupId);
    const taxableBase = Math.max(0, combinedTotal - deductionLimit);
    const calculatedTax = progressiveTax(taxableBase, this.policy.brackets ?? []);
    const priorTaxPaid = sameDonorHistory.reduce(
      (sum, gift) => sum + roundWon(gift.priorTaxPaid),
      0,
    );
    const taxAfterPriorCredit = Math.max(0, calculatedTax - priorTaxPaid);
    const timelyFilingCredit = roundWon(
      taxAfterPriorCredit * Number(this.policy.timely_filing_credit_rate ?? 0),
    );
    const estimatedTaxAfterCredit = Math.max(0, taxAfterPriorCredit - timelyFilingCredit);

    return {
      applicable: true,
      ageAtGift: age,
      windowStart: windowStart.toISOString().slice(0, 10),
      windowEnd: proposalDate,
      previousTotal,
      proposedAmount,
      combinedTotal,
      deductionLimit,
      deductionUsedBefore,
      remainingDeductionBefore,
      deductionAppliedToProposal,
      taxableBase,
      sameDonorPriorTotal,
      aggregationApplies,
      calculatedTax,
      priorTaxPaid,
      taxAfterPriorCredit,
      timelyFilingCredit,
      estimatedTaxAfterCredit,
      filingDueDate: filingDueDate(
        proposalDate,
        this.policy.filing_due_months_after_gift_month ?? 3,
      ),
      sourceReferences: this.policy.source_references ?? [],
      disclaimer: this.policy.disclaimer,
      warnings:
        donorGroups.size > 1
          ? ["복수 증여자 그룹은 공제 사용 순서와 종전 신고내역에 따라 실제 세액이 달라질 수 있습니다."]
          : [],
    };
  }
}

export class InvestmentTaxFeeEngine {
  constructor(taxPolicy, feePolicy) {
    this.taxPolicy = taxPolicy;
    this.feePolicy = feePolicy;
  }

  estimate(item, {
    amount,
    expectedReturnRate = 0,
    holdingYears = 1,
    action = "buy",
  }) {
    const principal = roundWon(amount);
    const expectedGain = roundWon(principal * (Number(expectedReturnRate) / 100) * holdingYears);
    const category = item.tax_category ?? "unknown";
    const schedule =
      this.feePolicy.schedules?.[item.fee_schedule_id] ??
      this.feePolicy.schedules?.kb_bank ??
      {};
    const commissionRate =
      action === "sell"
        ? Number(schedule.sell_commission_rate ?? 0)
        : Number(schedule.buy_commission_rate ?? 0);
    const commission = roundWon(principal * commissionRate);
    const fxCost = roundWon(principal * Number(schedule.fx_spread_rate ?? 0));
    const annualExpenseRatio = Number(item.expense_ratio ?? 0) / 100;
    const productExpense = roundWon(principal * annualExpenseRatio * holdingYears);

    let estimatedTax = 0;
    let taxNote = "과세 유형을 확인할 수 없어 세후 비교에서 제외";
    let calculable = true;
    if (category === "bank_interest") {
      estimatedTax = roundWon(expectedGain * Number(this.taxPolicy.interest_income_tax_rate));
      taxNote = "이자소득 원천징수 15.4% 가정";
    } else if (category === "fund_distribution") {
      estimatedTax = roundWon(expectedGain * Number(this.taxPolicy.fund_distribution_tax_rate));
      taxNote = "펀드 과세대상 이익에 15.4% 가정";
    } else if (category === "domestic_listed_equity_small_shareholder") {
      estimatedTax = 0;
      taxNote = "일반 소액주주 장내거래 양도소득세 0원 가정·매도 거래세 별도";
    } else if (category === "domestic_listed_domestic_equity_etf") {
      estimatedTax = 0;
      taxNote = "국내주식형 ETF 매매차익 비과세 일반 사례·분배금 과세 별도";
    } else if (category === "domestic_listed_overseas_asset_etf") {
      estimatedTax = roundWon(
        expectedGain * Number(this.taxPolicy.domestic_overseas_asset_etf_income_tax_rate),
      );
      taxNote = "국내 상장 해외자산 ETF 과세대상 이익 15.4% 단순 가정";
    } else if (category === "overseas_listed_equity_or_etf") {
      const taxableGain = Math.max(
        0,
        expectedGain -
          Number(this.taxPolicy.overseas_capital_gains_basic_deduction_krw ?? 0),
      );
      estimatedTax = roundWon(
        taxableGain * Number(this.taxPolicy.overseas_capital_gains_tax_rate),
      );
      taxNote = "해외주식 연간 기본공제 250만원을 이 거래에 전부 사용한다고 가정";
    } else {
      calculable = false;
    }

    let transactionTax = 0;
    if (action === "sell" && item.market === "KRX" && item.vehicle_type === "stock") {
      const marketRule = this.taxPolicy.transaction_tax?.KRX_KOSPI ?? {};
      transactionTax = roundWon(
        principal *
          (Number(marketRule.securities_transaction_tax_rate ?? 0) +
            Number(marketRule.rural_special_tax_rate ?? 0)),
      );
    }

    const totalCost = estimatedTax + transactionTax + commission + fxCost + productExpense;
    return {
      calculable,
      taxCategory: category,
      principal,
      expectedGain,
      estimatedTax,
      transactionTax,
      commission,
      fxCost,
      productExpense,
      totalCost,
      estimatedNetGain: Math.max(0, expectedGain - totalCost),
      taxNote,
      feeNote: schedule.note ?? "수수료 조건 확인 필요",
      effectiveDate: this.taxPolicy.effective_date,
      disclaimer: `${this.taxPolicy.disclaimer} ${this.feePolicy.disclaimer}`,
    };
  }
}

function dataFreshness(lastVerifiedAt, asOf) {
  if (!lastVerifiedAt) return { status: "expired", days: Infinity };
  const days = Math.floor((utcDate(asOf) - utcDate(lastVerifiedAt)) / DAY);
  if (days <= 30) return { status: "fresh", days };
  if (days <= 90) return { status: "warning", days };
  return { status: "expired", days };
}

export class KbProductPolicyEngine {
  constructor(policy) {
    this.policy = policy;
  }

  evaluateBankProduct(product, context) {
    const reasons = [];
    const freshness = dataFreshness(product.last_verified_at, context.asOf);
    if (product.provider !== "KB국민은행") reasons.push("KB국민은행 상품이 아님");
    if (product.product_status !== "active") reasons.push("신규 판매 중인 상품이 아님");
    if (product.minor_eligible !== true) reasons.push("미성년자 가입 불가");
    if (!product.source_name || !product.source_reference) reasons.push("공식 출처 누락");
    if (product.source_reference === "source:prototype-policy") reasons.push("검증용 데이터");
    if (freshness.status === "expired") reasons.push("상품정보 유효기간 만료");
    if (product.minimum_age != null && context.age < product.minimum_age) reasons.push("최소 가입연령 미달");
    if (product.maximum_age != null && context.age > product.maximum_age) reasons.push("최대 가입연령 초과");
    if (product.contract_months && product.contract_months > context.horizonYears * 12) {
      reasons.push("투자 종료시점보다 만기가 늦음");
    }
    if (
      product.monthly_payment_limit &&
      context.monthlyContribution > product.monthly_payment_limit
    ) {
      reasons.push("월 납입한도 초과");
    }
    if (
      ["installment_savings", "term_deposit"].includes(product.product_category) &&
      product.base_rate == null
    ) {
      reasons.push("기본금리 누락");
    }
    const productPolicy = Object.values(this.policy.rules ?? {}).find(
      (rule) => rule.product_id === product.product_id,
    );
    return {
      eligible: reasons.length === 0,
      reasons,
      freshness,
      productPolicy: productPolicy ?? null,
    };
  }

  evaluateSecurity(asset, context) {
    const reasons = [];
    const freshness = dataFreshness(asset.last_verified_at, context.asOf);
    if (asset.provider !== "KB증권") reasons.push("KB증권 거래 자산이 아님");
    if (asset.approved !== true) reasons.push("승인되지 않은 자산");
    if (asset.minor_account_tradable !== true) reasons.push("미성년 계좌 거래 불가");
    if (asset.leverage_flag === true) reasons.push("레버리지 자산");
    if (asset.inverse_flag === true) reasons.push("인버스 자산");
    if (!asset.source_name || !asset.source_reference) reasons.push("공식 출처 누락");
    if (asset.source_reference === "source:prototype-policy") reasons.push("검증용 데이터");
    if (freshness.status === "expired") reasons.push("자산정보 유효기간 만료");
    return { eligible: reasons.length === 0, reasons, freshness };
  }
}
