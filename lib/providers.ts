export type LinkAction = "detail" | "subscribe" | "trade";

export interface ProductCatalogProvider {
  listBankProducts(): Promise<Record<string, unknown>[]>;
  listSecuritiesAssets(): Promise<Record<string, unknown>[]>;
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

export class StaticProductLinkProvider implements ProductLinkProvider {
  getLink(itemId: string, action: LinkAction) {
    const securities = itemId.startsWith("KBSEC-") || action === "trade";
    const channel = securities ? ("KB증권 M-able" as const) : ("KB스타뱅킹" as const);
    return {
      kind: "mock" as const,
      channel,
      label:
        action === "detail"
          ? "상품 자세히 보기"
          : action === "subscribe"
            ? "KB 예·적금 가입 화면으로 이동"
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

export class KbProductRateApiProvider implements ProductRateProvider {
  async getRateQuote(): Promise<Record<string, unknown>> {
    throw new MvpProviderUnavailableError("KbProductRateApiProvider");
  }
}
