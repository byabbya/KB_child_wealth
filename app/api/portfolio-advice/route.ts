import {
  GeminiLlmProvider,
  OllamaLlmProvider,
  runPortfolioAdvisor,
} from "@/lib/portfolio-agent.mjs";

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "요청 JSON을 읽을 수 없습니다." }, { status: 400 });
  }

  const isLocalDevelopment = process.env.NODE_ENV !== "production";
  const provider = isLocalDevelopment
    ? Object.assign(new OllamaLlmProvider({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
        model: process.env.OLLAMA_MODEL || null,
      }), { name: "ollama" })
    : process.env.GEMINI_API_KEY
      ? new GeminiLlmProvider({
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
        })
      : null;

  const result = await runPortfolioAdvisor({ provider, input });
  return Response.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
