"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { configureSupabaseClient, createClient } from "@/lib/supabase/client";

type Member = { user_id: string; role: string; profiles: { full_name: string; email: string } | null };
type Workspace = { id: string; name: string; role: string };
type AuthValue = {
  configured: boolean; loading: boolean; user: User | null; workspace: Workspace | null;
  workspaces: Workspace[]; members: Member[]; refresh: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>; signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  children,
  configured,
  supabaseUrl,
  supabaseAnonKey,
}: {
  children: React.ReactNode;
  configured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  if (configured) {
    configureSupabaseClient({ url: supabaseUrl, anonKey: supabaseAnonKey });
  }
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(configured);

  const refresh = async () => {
    if (!configured) return;
    const supabase = createClient();
    const { data: { user: current } } = await supabase.auth.getUser();
    setUser(current);
    if (!current) { setWorkspace(null); setWorkspaces([]); setMembers([]); setLoading(false); return; }
    const { data: memberships } = await supabase.from("workspace_members")
      .select("role, workspaces(id,name)").eq("user_id", current.id);
    const availableWorkspaces=(memberships||[]).flatMap(item=>{const itemWorkspace=item.workspaces as unknown as {id:string;name:string}|null;return itemWorkspace?[{...itemWorkspace,role:item.role}]:[]});
    setWorkspaces(availableWorkspaces);
    const accountPreferredId = typeof current.user_metadata?.preferred_workspace_id === "string" ? current.user_metadata.preferred_workspace_id : null;
    const localPreferredId = typeof window !== "undefined" ? localStorage.getItem("juntos-active-workspace") : null;
    const preferredId = accountPreferredId || localPreferredId;
    const membership = memberships?.find(item => (item.workspaces as unknown as { id?: string } | null)?.id === preferredId) || memberships?.[0];
    const raw = membership?.workspaces as unknown as { id: string; name: string } | null;
    if (raw) {
      if (typeof window !== "undefined" && localPreferredId && localPreferredId !== raw.id) {
        const keep=new Set(["juntos-theme","juntos-profile","juntos-session-only","juntos-sync-client"]);
        Object.keys(localStorage).forEach(key=>{if(key.startsWith("juntos-")&&!keep.has(key))localStorage.removeItem(key)});
        localStorage.setItem("juntos-sync-queue","{}");
      }
      if (typeof window !== "undefined") localStorage.setItem("juntos-active-workspace", raw.id);
      setWorkspace({ ...raw, role: membership!.role });
      const { data } = await supabase.from("workspace_members")
        .select("user_id,role,profiles(full_name,email)").eq("workspace_id", raw.id);
      setMembers((data || []) as unknown as Member[]);
    }
    setLoading(false);
  };

  const switchWorkspace = async (workspaceId: string) => {
    if (!configured || workspaceId === workspace?.id || !workspaces.some(item => item.id === workspaceId)) return;
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ data: { preferred_workspace_id: workspaceId } });
    if (error) throw error;
    await refresh();
  };

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    refresh();
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(refresh, 0));
    return () => data.subscription.unsubscribe();
  }, [configured]);

  return <AuthContext.Provider value={{
    configured, loading, user, workspace, workspaces, members, refresh, switchWorkspace,
    signOut: async () => { if (configured) await createClient().auth.signOut(); },
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
