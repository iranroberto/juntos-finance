import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
const invitationSchema=z.object({workspaceId:z.string().uuid(),role:z.enum(["member","viewer"]).default("member")});
export async function POST(request:Request){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Sua sessão expirou. Entre novamente para gerar o convite."},{status:401});
  const parsed=invitationSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Não foi possível identificar o espaço."},{status:400});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;if(!url||!secret)return NextResponse.json({error:"A geração de convites não está configurada no servidor."},{status:503});
  const admin=createAdminClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});const {workspaceId,role}=parsed.data;
  const {data:membership,error:membershipError}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(membershipError)return NextResponse.json({error:"Não foi possível verificar seu espaço."},{status:500});if(membership?.role!=="owner")return NextResponse.json({error:"Somente o proprietário pode gerar convites."},{status:403});
  const {count:memberCount,error:countError}=await admin.from("workspace_members").select("user_id",{count:"exact",head:true}).eq("workspace_id",workspaceId);
  if(countError)return NextResponse.json({error:"Não foi possível verificar os participantes."},{status:500});if((memberCount||0)>1)return NextResponse.json({error:"Este espaço já possui um cônjuge. Remova-o antes de gerar outro convite."},{status:409});
  const token=randomBytes(32).toString("base64url"),tokenHash=createHash("sha256").update(token).digest("hex"),expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString(),linkEmail=`invite-${randomBytes(12).toString("hex")}@link.juntos.finance`;
  const {error:revokeError}=await admin.from("invitations").update({status:"revoked"}).eq("workspace_id",workspaceId).eq("status","pending");if(revokeError)return NextResponse.json({error:"Não foi possível renovar o convite anterior."},{status:500});
  const {error}=await admin.from("invitations").insert({workspace_id:workspaceId,email:linkEmail,role,invited_by:user.id,token_hash:tokenHash,expires_at:expiresAt,status:"pending"});
  if(error){const schemaMissing=/token_hash|expires_at|column|schema cache/i.test(error.message);return NextResponse.json({error:schemaMissing?"O banco ainda não recebeu a atualização de convites. Execute o schema.sql no Supabase e tente novamente.":"Não foi possível criar o convite no banco."},{status:schemaMissing?503:500})}
  const configuredOrigin=process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/,"");const origin=configuredOrigin||new URL(request.url).origin;return NextResponse.json({ok:true,inviteUrl:`${origin}/?invite=${encodeURIComponent(token)}`,expiresAt});
}