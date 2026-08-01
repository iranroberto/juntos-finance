import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(6).max(128),
});

export async function POST(request: Request) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise seu nome, e-mail e senha antes de continuar." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    return NextResponse.json({ error: "O cadastro está temporariamente indisponível." }, { status: 503 });
  }

  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.name },
  });

  if (error) {
    const duplicate = /already|registered|exists/i.test(error.message);
    return NextResponse.json({
      error: duplicate
        ? "Este e-mail já possui uma conta. Entre com sua senha."
        : "Não foi possível criar sua conta agora. Tente novamente.",
    }, { status: duplicate ? 409 : 400 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}