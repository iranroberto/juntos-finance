import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ token: z.string().min(20).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Convite inválido." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Entre na sua conta para aceitar o convite." }, { status: 401 });
  const { data, error } = await supabase.rpc("accept_workspace_invitation", { invitation_token: parsed.data.token });
  if (error) return NextResponse.json({ error: error.message.includes("outro e-mail") ? "Este convite foi criado para outro e-mail." : "O convite é inválido ou expirou." }, { status: 400 });
  return NextResponse.json({ ok: true, workspaceId: data });
}