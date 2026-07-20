"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

const PREFIX = "juntos-";
const snapshot = () => Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith(PREFIX)).map(k=>[k,localStorage.getItem(k)]));

export function CloudSync() {
  const { workspace } = useAuth();
  useEffect(() => {
    if (!workspace) return;
    const supabase = createClient(); let applying = false; let timer: ReturnType<typeof setTimeout>;
    const apply = (state: Record<string,string>) => { applying=true; Object.entries(state||{}).forEach(([k,v])=>localStorage.setItem(k,v)); applying=false; };
    const push = async () => { if (!applying) await supabase.from("workspace_state").upsert({ workspace_id:workspace.id, state:snapshot(), updated_at:new Date().toISOString() }); };
    (async()=>{const {data}=await supabase.from("workspace_state").select("state").eq("workspace_id",workspace.id).maybeSingle();if(data?.state&&Object.keys(data.state).length){apply(data.state)}else await push()})();
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k:string,v:string){original.call(this,k,v);if(k.startsWith(PREFIX)&&!applying){clearTimeout(timer);timer=setTimeout(push,700)}};
    const channel=supabase.channel(`workspace-${workspace.id}`).on("postgres_changes",{event:"UPDATE",schema:"public",table:"workspace_state",filter:`workspace_id=eq.${workspace.id}`},payload=>apply((payload.new as any).state)).subscribe();
    return()=>{Storage.prototype.setItem=original;clearTimeout(timer);supabase.removeChannel(channel)};
  },[workspace?.id]);
  return null;
}
