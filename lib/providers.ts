export type LinkAction = "detail" | "subscribe" | "trade" | "connect";

export interface ProductCatalogProvider {
  listBankProducts(): Promise<Record<string, unknown>[]>;
  listSecuritiesAssets(): Promise<Record<string, unknown>[]>;
}

export interface BankAccountProvider {
  getChildAccounts(childId: string): Promise<Record<string, unknown>[]>;
  getCashFlows(childId: string): Promise<Record<string, number>>;
}

export interface SecuritiesAccountProvider {
  getChildAccounts(childId: string): Promise<Record<string, unknown>[]>;
  getHoldings(accountId: string): Promise<Record<string, unknown>[]>;
}

export interface ProductRateProvider {
  getRateQuote(
    productId: string,
    evidence: Record<string, string>,
    asOf: string,
  ): Promise<Record<string, unknown>>;
}

export interface ProductEligibilityProvider {
  evaluate(
    itemId: string,
    context: Record<string, unknown>,
  ): Promise<{ eligible: boolean; reasons: string[] }>;
}

export interface ProductLinkProvider {
  getLink(itemId: string, action: LinkAction): {
    kind: "mock";
    channel: "KB스타뱅킹" | "KB증권 M-able";
    label: string;
    notice: string;
  };
}

interface MockProviderData {
  bankAccounts: Record<string, unknown>[];
  securitiesAccounts: Record<string, unknown>[];
  securitiesHoldings: Record<string, unknown>[];
  cashFlows: Record<string, number>;
}

export class CsvKbProductCatalogProvider implements ProductCatalogProvider {
  constructor(
    private readonly bankProducts: Record<string, unknown>[],
    private readonly securitiesAssets: Record<string, unknown>[],
  ) {}

  async listBankProducts() {
    return this.bankProducts;
  }

  async listSecuritiesAssets() {
    return this.securitiesAssets;
  }
}

export class MockKbBankAccountProvider implements BankAccountProvider {
  constructor(private readonly data: MockProviderData) {}

  async getChildAccounts(childId: string) {
    return this.data.bankAccounts.filter(
      (account: Record<string, unknown>) => account.childId === childId,
    );
  }

  async getCashFlows() {
    return this.data.cashFlows;
  }
}

export class MockKbSecuritiesAccountProvider
  implements SecuritiesAccountProvider
{
  constructor(private readonly data: MockProviderData) {}

  async getChildAccounts(childId: string) {
    return this.data.securitiesAccounts.filter(
      (account: Record<string, unknown>) => account.childId === childId,
    );
  }

  async getHoldings(accountId: string) {
    return this.data.securitiesHoldings.filter(
      (holding: Record<string, unknown>) => holding.accountId === accountId,
    );
  }
}

export class StaticProductLinkProvider implements ProductLinkProvider {
  getLink(itemId: string, action: LinkAction) {
    const securities = itemId.startsWith("KBSEC-") || action === "trade" || action === "connect";
    const channel = securities ? ("KB증권 M-able" as const) : ("KB스타뱅킹" as const);
    return {
      kind: "mock" as const,
      channel,
      label:
        action === "detail"
          ? "상품 자세히 보기"
          : action === "subscribe"
            ? "KB 예·적금 가입 화면으로 이동"
            : action === "connect"
              ? "KB증권 계좌 연결"
              : "KB증권 M-able에서 상품 확인",
      notice: `프로토타입에서는 실제 딥링크나 주문을 실행하지 않습니다. ${channel}의 Mock 연결 화면입니다.`,
    };
  }
}

export class MvpProviderUnavailableError extends Error {
  constructor(providerName: string) {
    super(`${providerName}은(는) MVP에서 연동되지 않았습니다.`);
    this.name = "MvpProviderUnavailableError";
  }
}

// 향후 KB 내부 승인 API 연동용 골격입니다. 실제 endpoint·인증·wire schema를 임의로 정의하지 않습니다.
export class KbBankProductApiProvider implements ProductCatalogProvider {
  async listBankProducts(): Promise<Record<string, unknown>[]> {
    throw new MvpProviderUnavailableError("KbBankProductApiProvider");
  }
  async listSecuritiesAssets(): Promise<Record<string, unknown>[]> {
    throw new MvpProviderUnavailableError("KbBankProductApiProvider");
  }
}

export class KbBankAccountApiProvider implements BankAccountProvider {
  async getChildAccounts(): Promise<Record<string, unknown>[]> {
    throw new MvpProviderUnavailableError("KbBankAccountApiProvider");
  }
  async getCashFlows(): Promise<Record<string, number>> {
    throw new MvpProviderUnavailableError("KbBankAccountApiProvider");
  }
}

export class KbSecuritiesAccountApiProvider
  implements SecuritiesAccountProvider
{
  async getChildAccounts(): Promise<Record<string, unknown>[]> {
    throw new MvpProviderUnavailableError("KbSecuritiesAccountApiProvider");
  }
  async getHoldings(): Promise<Record<string, unknown>[]> {
    throw new MvpProviderUnavailableError("KbSecuritiesAccountApiProvider");
  }
}

export class KbProductRateApiProvider implements ProductRateProvider {
  async getRateQuote(): Promise<Record<string, unknown>> {
    throw new MvpProviderUnavailableError("KbProductRateApiProvider");
  }
}
