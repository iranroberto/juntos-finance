import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ token: z.string().min(20).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "O link do convite está incompleto." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "Entre na sua conta para aceitar o convite." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return NextResponse.json({ error: "O aceite de convites não está configurado no servidor." }, { status: 503 });

  const admin = createAdminClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const { data: invitation, error: invitationError } = await admin.from("invitations")
    .select("id,workspace_id,email,role,status,expires_at")
    .eq("token_hash", tokenHash).maybeSingle();

  if (invitationError) return NextResponse.json({ error: "Não foi possível consultar o convite no banco." }, { status: 500 });
  if (!invitation || invitation.status !== "pending") return NextResponse.json({ error: "Este link já foi utilizado ou cancelado. Gere um novo convite." }, { status: 400 });
  if (!invitation.expires_at || new Date(invitation.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "Este convite expirou. Gere um novo link." }, { status: 400 });
  const openLink = invitation.email.toLowerCase().endsWith("@link.juntos.finance");
  if (!openLink && invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
    return NextResponse.json({ error: `Este convite pertence a ${invitation.email}. Entre usando exatamente esse e-mail.` }, { status: 403 });
  }

  const { data: existingMembership } = await admin.from("workspace_members").select("user_id")
    .eq("workspace_id", invitation.workspace_id).eq("user_id", user.id).maybeSingle();
  const { count: memberCount } = await admin.from("workspace_members").select("user_id", { count: "exact", head: true })
    .eq("workspace_id", invitation.workspace_id);
  if (!existingMembership && (memberCount || 0) > 1) return NextResponse.json({ error: "Este espaço já está compartilhado com outra pessoa." }, { status: 409 });

  const acceptedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from("invitations").update({
    status: "accepted", accepted_by: user.id, accepted_at: acceptedAt,
  }).eq("id", invitation.id).eq("status", "pending").select("id").maybeSingle();
  if (claimError || !claimed) return NextResponse.json({ error: "Este link acabou de ser utilizado. Gere um novo convite." }, { status: 409 });

  const { error: memberError } = await admin.from("workspace_members").upsert({
    workspace_id: invitation.workspace_id,
    user_id: user.id,
    role: invitation.role,
  }, { onConflict: "workspace_id,user_id" });
  if (memberError) {
    await admin.from("invitations").update({ status: "pending", accepted_by: null, accepted_at: null }).eq("id", invitation.id).eq("accepted_by", user.id);
    return NextResponse.json({ error: "Não foi possível adicionar sua conta ao espaço compartilhado." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, workspaceId: invitation.workspace_id });
}