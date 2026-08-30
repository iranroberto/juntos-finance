import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

type RecordRow = { workspace_id:string; entity_type:string; entity_id:string; data:Record<string,unknown> };
type Alert = { key:string; type:string; title:string; body:string; url:string; entityId:string; preference:"bills"|"budgets"|"goals"|"financial_alerts" };

const env = (name:string) => { const value=Deno.env.get(name); if(!value) throw new Error("Missing "+name); return value };
const daysBetween=(from:string,to:string)=>Math.round((new Date(to+"T12:00:00Z").getTime()-new Date(from+"T12:00:00Z").getTime())/86400000);
const paid=(item:Record<string,unknown>)=>String(item.status||"").toLowerCase().includes("pag")||Boolean(item.paidAt);
const amount=(value:unknown)=>Number(value)||0;

function alertsForWorkspace(records:RecordRow[],today:string):Alert[]{
  const alerts:Alert[]=[];
  const byType=(type:string)=>records.filter(row=>row.entity_type===type&&!row.data?.deleted);
  const transactions=byType("transactions");
  for(const row of transactions){
    const item=row.data; if(item.type!=="out"||paid(item)||!item.dateInput)continue;
    const days=daysBetween(today,String(item.dateInput)); if(![-1,0,1,3].includes(days)&&days>=0)continue;
    const stage=days<0?"overdue":days===0?"today":days===1?"tomorrow":"3days";
    const title=days<0?"Conta vencida":days===0?"Conta vence hoje":days===1?"Conta vence amanhã":"Conta vence em 3 dias";
    alerts.push({key:`bill:${row.entity_id}:${stage}:${item.dateInput}`,type:days<0?"bill_overdue":"bill_due",title,body:`${item.title||"Pagamento"}: R$ ${amount(item.value).toFixed(2).replace(".",",")}`,url:"/?page=Transações",entityId:row.entity_id,preference:"bills"});
  }
  const budgets=byType("budgets");
  const month=today.slice(0,7);
  for(const row of budgets){
    const budget=row.data; const limit=amount(budget.limit); if(limit<=0)continue;
    const spent=transactions.filter(tx=>tx.data.type==="out"&&String(tx.data.dateInput||"").startsWith(month)&&(tx.data.category===budget.category||tx.data.category===budget.name)).reduce((sum,tx)=>sum+amount(tx.data.value),0);
    const percent=Math.round(spent/limit*100); if(percent<80)continue;
    const stage=percent>100?"exceeded":percent>=100?"limit":"warning";
    alerts.push({key:`budget:${row.entity_id}:${month}:${stage}`,type:stage==="warning"?"budget_warning":"budget_exceeded",title:stage==="warning"?"⚠️ Orçamento chegando ao limite":stage==="limit"?"🚨 Limite do orçamento atingido":"🚨 Orçamento ultrapassado",body:stage==="warning"?`Você já utilizou ${percent}% do orçamento de ${budget.name||budget.category||"categoria"}.`:`${budget.name||budget.category||"Categoria"} ${stage==="limit"?"atingiu":"ultrapassou"} o limite planejado.`,url:"/?page=Orçamentos",entityId:row.entity_id,preference:"budgets"});
  }
  for(const row of byType("goals")){
    const goal=row.data,total=amount(goal.total),current=amount(goal.current);if(total<=0)continue;
    const percent=Math.round(current/total*100);if(percent<80)continue;
    const completed=percent>=100;
    alerts.push({key:`goal:${row.entity_id}:${completed?"completed":"80"}`,type:completed?"goal_completed":"goal_progress",title:completed?"🎉 Meta concluída":"Meta próxima de ser concluída",body:completed?`Você concluiu a meta ${goal.title||"financeira"}.`:`${goal.title||"Sua meta"} já chegou a ${percent}%.`,url:"/?page=Metas",entityId:row.entity_id,preference:"goals"});
  }
  return alerts;
}

Deno.serve(async request=>{
  try{
    if(request.headers.get("authorization")!==`Bearer ${env("PUSH_CRON_SECRET")}`)return new Response("Unauthorized",{status:401});
    webpush.setVapidDetails(env("VAPID_SUBJECT"),env("VAPID_PUBLIC_KEY"),env("VAPID_PRIVATE_KEY"));
    const supabase=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
    const {data:subscriptions,error:subscriptionError}=await supabase.from("push_subscriptions").select("*");if(subscriptionError)throw subscriptionError;
    if(!subscriptions?.length)return Response.json({sent:0,subscriptions:0,workspaces:0});
    const workspaceIds=[...new Set(subscriptions.map(item=>item.workspace_id))];
    const {data:records,error:recordsError}=await supabase.from("workspace_records").select("workspace_id,entity_type,entity_id,data").in("workspace_id",workspaceIds).is("deleted_at",null).in("entity_type",["transactions","budgets","goals"]);if(recordsError)throw recordsError;
    const {data:preferences}=await supabase.from("notification_preferences").select("*").in("workspace_id",workspaceIds);
    let sent=0;
    for(const subscription of subscriptions){
      const prefs=preferences?.find(item=>item.user_id===subscription.user_id&&item.workspace_id===subscription.workspace_id)||{bills:true,budgets:true,goals:true,financial_alerts:true};
      const alerts=alertsForWorkspace((records||[]).filter(row=>row.workspace_id===subscription.workspace_id) as RecordRow[],new Date().toISOString().slice(0,10)).filter(alert=>prefs[alert.preference]!==false);
      for(const alert of alerts){
        const {data:existing}=await supabase.from("notification_deliveries").select("id").eq("user_id",subscription.user_id).eq("subscription_id",subscription.id).eq("dedupe_key",alert.key).maybeSingle();
        if(existing)continue;
        try{
          await webpush.sendNotification({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify({...alert,tag:alert.key,icon:"/icons/juntos-app-icon-192-v2.png?v=12"}),{TTL:86400,urgency:alert.type.includes("overdue")||alert.type.includes("exceeded")?"high":"normal"});
          await supabase.from("notification_deliveries").insert({user_id:subscription.user_id,workspace_id:subscription.workspace_id,subscription_id:subscription.id,dedupe_key:alert.key,notification_type:alert.type,entity_id:alert.entityId});
          sent++;
        }catch(error){
          const status=(error as {statusCode?:number}).statusCode;
          if(status===404||status===410)await supabase.from("push_subscriptions").delete().eq("id",subscription.id);
          else console.error("push failed",subscription.id,error);
        }
      }
    }
    return Response.json({sent,subscriptions:subscriptions.length,workspaces:workspaceIds.length});
  }catch(error){console.error(error);const message=error instanceof Error?error.message:typeof error==="object"?JSON.stringify(error):String(error);return Response.json({error:message},{status:500})}
});