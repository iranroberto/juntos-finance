"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Heart,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

type AuthMode = "login" | "signup" | "recovery";
type Feedback = { tone: "error" | "success"; text: string } | null;

const copy = {
  login: {
    eyebrow: "BEM-VINDO DE VOLTA",
    title: "Acesse sua conta",
    description: "Entre para continuar cuidando da sua vida financeira.",
    submit: "Entrar na minha conta",
  },
  signup: {
    eyebrow: "COMECE AGORA",
    title: "Crie sua conta",
    description: "Organize suas finanças sozinho ou compartilhe com seu cônjuge depois.",
    submit: "Criar conta gratuita",
  },
  recovery: {
    eyebrow: "RECUPERAR ACESSO",
    title: "Esqueceu sua senha?",
    description: "Informe seu e-mail e enviaremos as instruções de recuperação.",
    submit: "Enviar link de recuperação",
  },
} as const;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { configured, loading, user, refresh, signOut } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const inviteToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invite') : null;
  const [processingInvite,setProcessingInvite]=useState(Boolean(inviteToken));
  const [inviteError,setInviteError]=useState('');
  useEffect(()=>{if(!user||!inviteToken){setProcessingInvite(false);return}let active=true;void(async()=>{setProcessingInvite(true);const response=await fetch('/api/invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:inviteToken})});const result=await response.json().catch(()=>({}));if(!active)return;if(response.ok){localStorage.setItem('juntos-active-workspace',result.workspaceId);window.history.replaceState({},'',window.location.pathname);await refresh()}else setInviteError(result.error||'Não foi possível aceitar o convite.');if(active)setProcessingInvite(false)})();return()=>{active=false}},[user?.id,inviteToken]);

  if (!configured) {
    return <>{children}<div className="demo-auth-banner">Modo demonstração · conecte o Supabase para ativar o login</div></>;
  }
  if (loading) {
    return <div className="auth-loading"><div className="auth-loading-mark"><Heart/><LoaderCircle className="spin"/></div><b>Juntos Finance</b><span>Preparando seu espaço seguro...</span></div>;
  }
  if (user && processingInvite) return <div className="auth-loading"><div className="auth-loading-mark"><Heart/><LoaderCircle className="spin"/></div><b>Aceitando convite...</b><span>Conectando sua conta ao espaço compartilhado.</span></div>;
  if (user && inviteError) return <div className="auth-loading"><div className="auth-loading-mark"><Heart/><ShieldCheck/></div><b>Não foi possível aceitar o convite</b><span>{inviteError}</span><button className="auth-submit" onClick={signOut}>Entrar com outro e-mail</button></div>;
  if (user) return <>{children}</>;

  const changeMode = (next: AuthMode) => {
    setMode(next);
    setFeedback(null);
    setPassword("");
    setConfirmation("");
  };

  const acceptInvitation = async () => {
    if (!inviteToken) return true;
    const response = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inviteToken }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setFeedback({ tone: 'error', text: result.error || 'Não foi possível aceitar o convite.' }); return false; }
    localStorage.setItem('juntos-active-workspace', result.workspaceId);
    window.history.replaceState({}, '', window.location.pathname);
    await refresh();
    return true;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return setFeedback({ tone: "error", text: "Informe um e-mail válido." });
    if (mode === "signup" && password !== confirmation) return setFeedback({ tone: "error", text: "As senhas não coincidem." });

    setBusy(true);
    const supabase = createClient();
    if (mode === "recovery") {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${location.origin}/auth/callback` });
      setFeedback(error ? { tone: "error", text: error.message } : { tone: "success", text: "Enviamos o link de recuperação para seu e-mail." });
    } else if (mode === "signup") {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: normalizedEmail, password }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: result.error ?? "Não foi possível criar sua conta. Tente novamente." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) {
          setFeedback({ tone: "error", text: "Sua conta foi criada, mas não foi possível entrar automaticamente. Tente fazer login." });
          setMode("login");
        } else {
          await acceptInvitation();
        }
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) setFeedback({ tone: "error", text: "E-mail ou senha incorretos. Verifique os dados e tente novamente." });
      else await acceptInvitation();
      if (!remember) sessionStorage.setItem("juntos-session-only", "true");
    }
    setBusy(false);
  };

  const current = copy[mode];
  return (
    <main className="auth-page">
      <section className="auth-brand" aria-label="Apresentação do Juntos Finance">
        <div className="auth-logo"><span><Heart/></span><b>Juntos</b> Finance</div>
        <div className="auth-presentation">
          <span className="auth-kicker"><ShieldCheck/> Finanças protegidas e organizadas</span>
          <h1>Controle hoje.<br/><em>Construa amanhã.</em></h1>
          <p>Um espaço simples e seguro para acompanhar sua vida financeira, definir metas e compartilhar tudo com quem você confia.</p>
          <div className="auth-benefits">
            <div><TrendingUp/><span><b>Visão completa</b><small>Receitas, despesas e metas em um só lugar</small></span></div>
            <div><Users/><span><b>Individual ou em casal</b><small>Você decide quando compartilhar seu espaço</small></span></div>
            <div><ShieldCheck/><span><b>Dados protegidos</b><small>Acesso seguro com autenticação pelo Supabase</small></span></div>
          </div>
        </div>
        <div className="auth-brand-footer"><span>© 2026 Juntos Finance</span><span>Privacidade · Segurança</span></div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-mobile-logo"><Heart/><b>Juntos Finance</b></div>
          <header>
            <span>{current.eyebrow}</span>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
          </header>

          {inviteToken&&<div className="auth-message success"><Users/><span>Você recebeu um convite para compartilhar um espaço financeiro. Entre ou crie sua conta usando o e-mail convidado.</span></div>}

          {mode === "signup" && <label className="auth-field"><span>Nome completo</span><div><UserRound/><input value={name} onChange={event=>setName(event.target.value)} required autoComplete="name" placeholder="Como deseja ser chamado?"/></div></label>}

          <label className="auth-field"><span>E-mail</span><div><Mail/><input type="email" value={email} onChange={event=>setEmail(event.target.value)} required autoComplete="email" placeholder="voce@email.com"/></div></label>

          {mode !== "recovery" && <label className="auth-field"><span>Senha</span><div><LockKeyhole/><input type={showPassword?"text":"password"} minLength={6} value={password} onChange={event=>setPassword(event.target.value)} required autoComplete={mode==="login"?"current-password":"new-password"} placeholder="Mínimo de 6 caracteres"/><button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?"Ocultar senha":"Mostrar senha"}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label>}

          {mode === "signup" && <label className="auth-field"><span>Confirmar senha</span><div><LockKeyhole/><input type={showPassword?"text":"password"} minLength={6} value={confirmation} onChange={event=>setConfirmation(event.target.value)} required autoComplete="new-password" placeholder="Digite a senha novamente"/></div></label>}

          {mode === "login" && <div className="auth-options"><label><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/><span>Lembrar de mim</span></label><button type="button" onClick={()=>changeMode("recovery")}>Esqueci minha senha</button></div>}

          {feedback&&<div className={`auth-message ${feedback.tone}`}>{feedback.tone==="success"&&<CheckCircle2/>}<span>{feedback.text}</span></div>}

          <button className="auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<>{current.submit}<ArrowRight/></>}</button>

          <div className="auth-divider"><span>acesso seguro</span></div>

          {mode === "login"&&<p className="auth-alternate">Ainda não tem uma conta? <button type="button" onClick={()=>changeMode("signup")}>Criar conta</button></p>}
          {mode === "signup"&&<p className="auth-alternate">Já possui uma conta? <button type="button" onClick={()=>changeMode("login")}>Entrar agora</button></p>}
          {mode === "recovery"&&<button className="auth-back" type="button" onClick={()=>changeMode("login")}>Voltar para o login</button>}

          <footer>Ao continuar, você concorda com nossos <button type="button">Termos de Uso</button> e <button type="button">Política de Privacidade</button>.</footer>
        </form>
      </section>
    </main>
  );
}
