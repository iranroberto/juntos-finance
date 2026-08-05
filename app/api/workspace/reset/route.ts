import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ workspaceId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Espaço inválido." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { data: membership } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", parsed.data.workspaceId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Somente o proprietário pode apagar todos os dados do espaço." }, { status: 403 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return NextResponse.json({ error: "A exclusão não está configurada no servidor." }, { status: 503 });
  const admin = createAdminClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = new Date().toISOString();
  const { error: recordsError } = await admin.from("workspace_records")
    .update({ data: null, deleted_at: now, updated_at: now, updated_by: user.id }).eq("workspace_id", parsed.data.workspaceId);
  if (recordsError) return NextResponse.json({ error: "Não foi possível apagar os dados sincronizados." }, { status: 500 });
  const { error: stateError } = await admin.from("workspace_state")
    .upsert({ workspace_id: parsed.data.workspaceId, state: {}, updated_at: now }, { onConflict: "workspace_id" });
  if (stateError) return NextResponse.json({ error: "Não foi possível limpar o backup anterior." }, { status: 500 });
  return NextResponse.json({ ok: true });
}