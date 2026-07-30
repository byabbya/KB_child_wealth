import bankCsv from "@/data/kb_bank_products.csv?raw";
import securitiesCsv from "@/data/kb_securities_assets.csv?raw";
import taxYaml from "@/data/tax_rules.yaml?raw";
import holdings from "@/data/sample_holdings.json";
import productSources from "@/data/product_sources.json";
import { parseCsv, parseTaxYaml } from "./engine.mjs";

export const demoCatalog = {
  bankProducts: parseCsv(bankCsv),
  securitiesAssets: parseCsv(securitiesCsv),
  data: holdings,
  productSources,
  taxRules: parseTaxYaml(taxYaml),
};
