import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const memberSchema=z.object({workspaceId:z.string().uuid(),memberId:z.string().uuid()});
const editSchema=memberSchema.extend({name:z.string().trim().min(2).max(80)});

async function authorize(workspaceId:string,memberId:string){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return {error:NextResponse.json({error:"Não autorizado."},{status:401})};
  const {data:owner}=await supabase.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();
  if(owner?.role!=="owner")return {error:NextResponse.json({error:"Somente o proprietário pode gerenciar o cônjuge."},{status:403})};
  if(memberId===user.id)return {error:NextResponse.json({error:"Você não pode remover seu próprio acesso por esta opção."},{status:400})};
  const {data:target}=await supabase.from("workspace_members").select("user_id").eq("workspace_id",workspaceId).eq("user_id",memberId).maybeSingle();
  if(!target)return {error:NextResponse.json({error:"O cônjuge não participa mais deste espaço."},{status:404})};
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret)return {error:NextResponse.json({error:"O gerenciamento não está configurado no servidor."},{status:503})};
  return {admin:createAdminClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}})};
}

export async function PATCH(request:Request){
  const parsed=editSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Informe um nome válido."},{status:400});
  const access=await authorize(parsed.data.workspaceId,parsed.data.memberId);
  if(access.error)return access.error;
  const {error}=await access.admin!.from("profiles").update({full_name:parsed.data.name}).eq("id",parsed.data.memberId);
  if(error)return NextResponse.json({error:"Não foi possível editar o cônjuge."},{status:500});
  return NextResponse.json({ok:true});
}

export async function DELETE(request:Request){
  const parsed=memberSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Participante inválido."},{status:400});
  const access=await authorize(parsed.data.workspaceId,parsed.data.memberId);
  if(access.error)return access.error;
  const {error}=await access.admin!.from("workspace_members").delete().eq("workspace_id",parsed.data.workspaceId).eq("user_id",parsed.data.memberId);
  if(error)return NextResponse.json({error:"Não foi possível remover o cônjuge."},{status:500});
  const {count}=await access.admin!.from("workspace_members").select("workspace_id",{count:"exact",head:true}).eq("user_id",parsed.data.memberId);
  if(!count){
    const {data:personal,error:workspaceError}=await access.admin!.from("workspaces").insert({name:"Meu espaço",owner_id:parsed.data.memberId}).select("id").single();
    if(workspaceError||!personal)return NextResponse.json({error:"O acesso compartilhado foi removido, mas não foi possível criar o espaço individual."},{status:500});
    const {error:membershipError}=await access.admin!.from("workspace_members").insert({workspace_id:personal.id,user_id:parsed.data.memberId,role:"owner"});
    if(membershipError)return NextResponse.json({error:"O acesso compartilhado foi removido, mas o espaço individual não pôde ser concluído."},{status:500});
  }
  return NextResponse.json({ok:true});
}