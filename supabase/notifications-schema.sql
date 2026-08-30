-- Web Push only: subscriptions, preferences and delivery deduplication.
-- Safe to run more than once.

-- Web Push: uma subscription por navegador/dispositivo.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_workspace_idx on public.push_subscriptions(workspace_id);
alter table public.push_subscriptions enable row level security;
grant select,insert,update,delete on public.push_subscriptions to authenticated;
drop policy if exists "users manage own push devices" on public.push_subscriptions;
create policy "users manage own push devices" on public.push_subscriptions for all to authenticated
  using(auth.uid() is not null and user_id=auth.uid() and public.is_workspace_member(workspace_id))
  with check(auth.uid() is not null and user_id=auth.uid() and public.is_workspace_member(workspace_id));

create table if not exists public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bills boolean not null default true,
  budgets boolean not null default true,
  goals boolean not null default true,
  financial_alerts boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,workspace_id)
);
alter table public.notification_preferences enable row level security;
grant select,insert,update,delete on public.notification_preferences to authenticated;
drop policy if exists "users manage own notification preferences" on public.notification_preferences;
create policy "users manage own notification preferences" on public.notification_preferences for all to authenticated
  using(auth.uid() is not null and user_id=auth.uid() and public.is_workspace_member(workspace_id))
  with check(auth.uid() is not null and user_id=auth.uid() and public.is_workspace_member(workspace_id));

-- Registro servidor de deduplicação. Não é exposto ao cliente.
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  dedupe_key text not null,
  notification_type text not null,
  entity_id text,
  sent_at timestamptz not null default now(),
  unique(user_id,subscription_id,dedupe_key)
);
create index if not exists notification_deliveries_workspace_idx on public.notification_deliveries(workspace_id,sent_at desc);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon,authenticated;
