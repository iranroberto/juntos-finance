"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Member = { user_id: string; role: string; profiles: { full_name: string; email: string } | null };
type Workspace = { id: string; name: string; role: string };
type AuthValue = {
  configured: boolean; loading: boolean; user: User | null; workspace: Workspace | null;
  members: Member[]; refresh: () => Promise<void>; signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const refresh = async () => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    const { data: { user: current } } = await supabase.auth.getUser();
    setUser(current);
    if (!current) { setWorkspace(null); setMembers([]); setLoading(false); return; }
    const { data: membership } = await supabase.from("workspace_members")
      .select("role, workspaces(id,name)").eq("user_id", current.id).limit(1).maybeSingle();
    const raw = membership?.workspaces as unknown as { id: string; name: string } | null;
    if (raw) {
      setWorkspace({ ...raw, role: membership!.role });
      const { data } = await supabase.from("workspace_members")
        .select("user_id,role,profiles(full_name,email)").eq("workspace_id", raw.id);
      setMembers((data || []) as unknown as Member[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    refresh();
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(refresh, 0));
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{
    configured: isSupabaseConfigured, loading, user, workspace, members, refresh,
    signOut: async () => { if (isSupabaseConfigured) await createClient().auth.signOut(); },
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
