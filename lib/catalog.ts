import bankCsv from "@/data/kb_bank_products.csv?raw";
import securitiesCsv from "@/data/kb_securities_assets.csv?raw";
import giftTaxYaml from "@/data/gift_tax_rules.yaml?raw";
import investmentTaxYaml from "@/data/investment_tax_rules.yaml?raw";
import feeAssumptionsYaml from "@/data/fee_assumptions.yaml?raw";
import productPoliciesYaml from "@/data/kb_product_policies.yaml?raw";
import scenario from "@/data/sample_scenario.json";
import productSources from "@/data/product_sources.json";
import marketSnapshot from "@/data/market_snapshot.json";
import { parseCsv } from "./engine.mjs";
import { parsePolicyDocument } from "./rules.mjs";

export const prototypeCatalog = {
  bankProducts: parseCsv(bankCsv),
  securitiesAssets: parseCsv(securitiesCsv),
  data: scenario,
  marketSnapshot,
  productSources,
  giftTaxRules: parsePolicyDocument(giftTaxYaml),
  investmentTaxRules: parsePolicyDocument(investmentTaxYaml),
  feeAssumptions: parsePolicyDocument(feeAssumptionsYaml),
  productPolicies: parsePolicyDocument(productPoliciesYaml),
};
