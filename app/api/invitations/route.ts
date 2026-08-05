import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const invitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  workspaceId: z.string().uuid(),
  role: z.enum(["member", "viewer"]).default("member"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const parsed = invitationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise o e-mail informado." }, { status: 400 });
  const { email, workspaceId, role } = parsed.data;
  if (email === user.email?.toLowerCase()) return NextResponse.json({ error: "Use o e-mail da pessoa que será convidada." }, { status: 400 });

  const { data: membership } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Somente o administrador pode convidar." }, { status: 403 });

  const { data: existingProfile } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingProfile) {
    const { data: existingMember } = await supabase.from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("user_id", existingProfile.id).maybeSingle();
    if (existingMember) return NextResponse.json({ error: "Essa pessoa já participa do espaço." }, { status: 409 });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("invitations").update({ status: "revoked" })
    .eq("workspace_id", workspaceId).eq("email", email).eq("status", "pending");
  const { error } = await supabase.from("invitations").insert({
    workspace_id: workspaceId, email, role, invited_by: user.id,
    token_hash: tokenHash, expires_at: expiresAt, status: "pending",
  });
  if (error) { const schemaMissing = /token_hash|expires_at|column|schema cache/i.test(error.message); return NextResponse.json({ error: schemaMissing ? "O banco ainda não recebeu a atualização de convites. Execute o schema.sql no Supabase e tente novamente." : "Não foi possível criar o convite." }, { status: schemaMissing ? 503 : 400 }); }

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const origin = configuredOrigin || new URL(request.url).origin;
  return NextResponse.json({ ok: true, inviteUrl: `${origin}/?invite=${encodeURIComponent(token)}`, expiresAt });
}