import { timingSafeEqual } from "node:crypto";

const authorized = (request: Request) => {
  const expected = process.env.CRON_SECRET;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
};

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = process.env.SUPABASE_PUSH_FUNCTION_URL;
  const secret = process.env.PUSH_CRON_SECRET;
  if (!url || !secret) return Response.json({ error: "Push scheduler is not configured" }, { status: 503 });

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({ error: "Invalid push response" }));
  return Response.json(result, { status: response.status });
}