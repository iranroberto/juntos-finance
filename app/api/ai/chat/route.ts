import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })).min(1).max(20),
  financialData: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Faça login para usar a Juntos IA." }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.1";
  if (!apiKey) {
    return NextResponse.json({ error: "A Juntos IA ainda não foi configurada no servidor." }, { status: 503 });
  }

  const financialContext = JSON.stringify(parsed.data.financialData).slice(0, 100_000);
  const input = parsed.data.messages.map(message => ({
    role: message.role,
    content: message.content,
  }));

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        instructions: `Você é a Juntos IA, conselheira financeira do Juntos Finance. Responda em português do Brasil, com clareza, objetividade e tom acolhedor. Use exclusivamente os dados financeiros fornecidos. Nunca invente valores, datas, categorias ou conclusões. Quando faltarem dados, diga exatamente o que falta. Confira cálculos antes de responder e mostre contas resumidas quando isso ajudar. Diferencie fatos dos dados, estimativas e sugestões. Não prometa ganhos e não substitua aconselhamento profissional. Contexto financeiro atual do usuário: ${financialContext}`,
        input,
        max_output_tokens: 1200,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || "Não foi possível consultar a Juntos IA.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const answer = data.output
      ?.flatMap((item: any) => item.content || [])
      .find((content: any) => content.type === "output_text")?.text;
    if (!answer) return NextResponse.json({ error: "A IA não retornou uma resposta." }, { status: 502 });

    return NextResponse.json({ answer });
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json({ error: timeout ? "A resposta demorou demais. Tente novamente." : "Falha ao conectar com a Juntos IA." }, { status: 502 });
  }
}