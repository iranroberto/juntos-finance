-- Execute este arquivo no SQL Editor do Supabase.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','member','viewer')) default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  status text not null default 'pending',
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_state (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.workspace_state enable row level security;

create or replace function public.is_workspace_member(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from workspace_members where workspace_id=target and user_id=auth.uid());
$$;
create or replace function public.is_workspace_owner(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from workspace_members where workspace_id=target and user_id=auth.uid() and role='owner');
$$;

drop policy if exists "profiles visible to workspace members" on public.profiles;
create policy "profiles visible to workspace members" on public.profiles for select to authenticated using (
  id=auth.uid() or exists(select 1 from workspace_members mine join workspace_members theirs using(workspace_id) where mine.user_id=auth.uid() and theirs.user_id=profiles.id)
);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "members view workspace" on public.workspaces;
create policy "members view workspace" on public.workspaces for select to authenticated using(public.is_workspace_member(id));
drop policy if exists "members view memberships" on public.workspace_members;
create policy "members view memberships" on public.workspace_members for select to authenticated using(public.is_workspace_member(workspace_id));
drop policy if exists "owners manage memberships" on public.workspace_members;
create policy "owners manage memberships" on public.workspace_members for all to authenticated using(public.is_workspace_owner(workspace_id)) with check(public.is_workspace_owner(workspace_id));
drop policy if exists "owners manage invitations" on public.invitations;
create policy "owners manage invitations" on public.invitations for all to authenticated using(public.is_workspace_owner(workspace_id)) with check(public.is_workspace_owner(workspace_id));
drop policy if exists "members read state" on public.workspace_state;
create policy "members read state" on public.workspace_state for select to authenticated using(public.is_workspace_member(workspace_id));
drop policy if exists "editors write state" on public.workspace_state;
create policy "editors write state" on public.workspace_state for all to authenticated using(
  exists(select 1 from workspace_members where workspace_id=workspace_state.workspace_id and user_id=auth.uid() and role in ('owner','member'))
) with check(
  exists(select 1 from workspace_members where workspace_id=workspace_state.workspace_id and user_id=auth.uid() and role in ('owner','member'))
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare workspace uuid; display_name text; invited_workspace uuid; member_role text;
begin
  display_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1));
  insert into profiles(id,full_name,email) values(new.id,display_name,coalesce(new.email,'')) on conflict(id) do nothing;
  invited_workspace := nullif(new.raw_user_meta_data->>'invited_workspace_id','')::uuid;
  if invited_workspace is not null then
    member_role := coalesce(new.raw_user_meta_data->>'invited_role','member');
    insert into workspace_members(workspace_id,user_id,role) values(invited_workspace,new.id,member_role) on conflict do nothing;
    update invitations set status='accepted' where workspace_id=invited_workspace and lower(email)=lower(new.email);
  else
    insert into workspaces(name,owner_id) values('Espaço de '||display_name,new.id) returning id into workspace;
    insert into workspace_members(workspace_id,user_id,role) values(workspace,new.id,'owner');
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter publication supabase_realtime add table public.workspace_state;
