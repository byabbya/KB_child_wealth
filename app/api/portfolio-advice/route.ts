import {
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

  const localOllamaEnabled =
    process.env.NODE_ENV !== "production" || Boolean(process.env.OLLAMA_BASE_URL);
  const provider = localOllamaEnabled
    ? new OllamaLlmProvider({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
        model: process.env.OLLAMA_MODEL || null,
      })
    : null;

  const result = await runPortfolioAdvisor({ provider, input });
  return Response.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
