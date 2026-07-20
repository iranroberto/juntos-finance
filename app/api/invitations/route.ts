import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { email, workspaceId, role = "member" } = await request.json();
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Somente o administrador pode convidar." }, { status: 403 });
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return NextResponse.json({ error: "SUPABASE_SECRET_KEY não configurada." }, { status: 500 });
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secret, { auth:{autoRefreshToken:false,persistSession:false} });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { data:{full_name:"",invited_workspace_id:workspaceId,invited_role:role}, redirectTo:`${new URL(request.url).origin}/auth/callback` });
  if (error) return NextResponse.json({ error:error.message }, { status:400 });
  await supabase.from("invitations").insert({workspace_id:workspaceId,email,role,invited_by:user.id});
  return NextResponse.json({ ok:true });
}
