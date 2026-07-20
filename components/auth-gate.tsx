"use client";

import { useState } from "react";
import { Heart, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { configured, loading, user } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  if (!configured) return <>{children}<div className="demo-auth-banner">Modo demonstração · conecte o Supabase para ativar logins compartilhados</div></>;
  if (loading) return <div className="auth-loading"><LoaderCircle className="spin"/><span>Carregando seu espaço...</span></div>;
  if (user) return <>{children}</>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMessage(""); const supabase = createClient();
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: `${location.origin}/auth/callback` } });
      setMessage(error?.message || "Conta criada. Confirme o link enviado ao seu e-mail.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
    }
    setBusy(false);
  };
  return <main className="auth-page"><section className="auth-brand"><div><Heart/><b>Juntos</b> Finance</div><h1>Finanças compartilhadas,<br/>identidades individuais.</h1><p>Cada pessoa entra com seu próprio nome e senha, mas o casal administra o mesmo espaço.</p></section><form className="auth-card" onSubmit={submit}><span>{mode === "login" ? "BEM-VINDO DE VOLTA" : "CRIAR CONTA"}</span><h2>{mode === "login" ? "Entrar no Juntos" : "Começar um espaço"}</h2><p>{mode === "login" ? "Acesse seu espaço financeiro compartilhado." : "Depois você poderá convidar outra pessoa."}</p>{mode === "signup"&&<label>Seu nome<input value={name} onChange={e=>setName(e.target.value)} required placeholder="Como deseja ser chamado?"/></label>}<label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="voce@email.com"/></label><label>Senha<input type="password" minLength={6} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Mínimo de 6 caracteres"/></label>{message&&<div className="auth-message">{message}</div>}<button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin"/>:mode==='login'?'Entrar':'Criar minha conta'}</button><button type="button" className="auth-switch" onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('')}}>{mode==='login'?'Ainda não tenho uma conta':'Já tenho uma conta'}</button></form></main>;
}
