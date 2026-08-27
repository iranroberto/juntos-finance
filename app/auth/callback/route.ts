import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url); const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/?recovery_error=missing_code", url.origin));
  const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/?recovery_error=invalid_link", url.origin));
  return NextResponse.redirect(new URL("/?password_recovery=1", url.origin));
}
