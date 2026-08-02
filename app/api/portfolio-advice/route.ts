import {
  GeminiLlmProvider,
  runPortfolioAdvisor,
} from "@/lib/portfolio-agent.mjs";

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "요청 JSON을 읽을 수 없습니다." }, { status: 400 });
  }

  const provider = process.env.GEMINI_API_KEY
    ? new GeminiLlmProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      })
    : null;

  const result = await runPortfolioAdvisor({ provider, input });
  return Response.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
