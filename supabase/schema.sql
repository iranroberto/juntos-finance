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
  owner_id uuid not null references public.profiles(id) on delete cascade,
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
  invited_by uuid not null references public.profiles(id) on delete cascade,
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
-- Corrige projetos existentes para permitir a exclusão completa de usuários.
alter table public.workspaces drop constraint if exists workspaces_owner_id_fkey;
alter table public.workspaces add constraint workspaces_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete cascade;
alter table public.invitations drop constraint if exists invitations_invited_by_fkey;
alter table public.invitations add constraint invitations_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete cascade;

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
    update invitations set status='accepted',accepted_by=new.id,accepted_at=now() where workspace_id=invited_workspace and lower(email)=lower(new.email) and status='pending';
  else
    insert into workspaces(name,owner_id) values('Espaço de '||display_name,new.id) returning id into workspace;
    insert into workspace_members(workspace_id,user_id,role) values(workspace,new.id,'owner');
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

do $$
begin
  alter publication supabase_realtime add table public.workspace_state;
exception when duplicate_object then null;
end $$;

-- Sincronização incremental por entidade. workspace_state permanece somente
-- para migração de instalações anteriores.
create table if not exists public.workspace_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  data jsonb,
  revision bigint not null default 1,
  deleted_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, entity_type, entity_id)
);

create index if not exists workspace_records_workspace_updated_idx
  on public.workspace_records(workspace_id, updated_at desc);
create index if not exists workspace_records_active_type_idx
  on public.workspace_records(workspace_id, entity_type)
  where deleted_at is null;

alter table public.workspace_records enable row level security;
grant select on public.workspace_records to authenticated;
drop policy if exists "members read records" on public.workspace_records;
create policy "members read records" on public.workspace_records for select to authenticated
  using(public.is_workspace_member(workspace_id));
drop policy if exists "editors write records" on public.workspace_records;
create policy "editors write records" on public.workspace_records for all to authenticated
  using(exists(select 1 from public.workspace_members where workspace_id=workspace_records.workspace_id and user_id=auth.uid() and role in ('owner','member')))
  with check(exists(select 1 from public.workspace_members where workspace_id=workspace_records.workspace_id and user_id=auth.uid() and role in ('owner','member')));

create or replace function public.apply_workspace_changes(target_workspace uuid, changes jsonb)
returns setof public.workspace_records
language plpgsql security definer set search_path=public as $$
declare item jsonb;
begin
  if not exists(select 1 from workspace_members where workspace_id=target_workspace and user_id=auth.uid() and role in ('owner','member')) then
    raise exception 'Sem permissão para editar este espaço' using errcode='42501';
  end if;
  if jsonb_typeof(changes) <> 'array' then raise exception 'changes deve ser um array JSON'; end if;
  for item in select value from jsonb_array_elements(changes)
  loop
    insert into workspace_records(workspace_id,entity_type,entity_id,data,deleted_at,updated_by)
    values(target_workspace,item->>'entity_type',item->>'entity_id',item->'data',case when coalesce((item->>'deleted')::boolean,false) then now() else null end,auth.uid())
    on conflict(workspace_id,entity_type,entity_id) do update set
      data=excluded.data,
      deleted_at=excluded.deleted_at,
      updated_by=auth.uid(),
      updated_at=now(),
      revision=workspace_records.revision+1;
  end loop;
  return query select * from workspace_records where workspace_id=target_workspace and (entity_type,entity_id) in (select value->>'entity_type',value->>'entity_id' from jsonb_array_elements(changes));
end $$;

revoke all on function public.apply_workspace_changes(uuid,jsonb) from public;
grant execute on function public.apply_workspace_changes(uuid,jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.workspace_records;
exception when duplicate_object then null;
end $$;
-- Convites compartilháveis, vinculados ao e-mail e com validade limitada.
alter table public.invitations add column if not exists token_hash text;
alter table public.invitations add column if not exists expires_at timestamptz;
alter table public.invitations add column if not exists accepted_by uuid references public.profiles(id) on delete set null;
alter table public.invitations add column if not exists accepted_at timestamptz;
create unique index if not exists invitations_token_hash_idx on public.invitations(token_hash) where token_hash is not null;
create index if not exists invitations_pending_email_idx on public.invitations(lower(email),expires_at) where status='pending';

create or replace function public.accept_workspace_invitation(invitation_token text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare invitation public.invitations; current_email text;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária' using errcode='42501'; end if;
  select * into invitation from invitations
    where token_hash=encode(digest(invitation_token,'sha256'),'hex') and status='pending' and expires_at>now()
    for update;
  if invitation.id is null then raise exception 'Convite inválido ou expirado'; end if;
  select email into current_email from profiles where id=auth.uid();
  if lower(coalesce(current_email,''))<>lower(invitation.email) then raise exception 'Este convite pertence a outro e-mail' using errcode='42501'; end if;
  insert into workspace_members(workspace_id,user_id,role) values(invitation.workspace_id,auth.uid(),invitation.role)
    on conflict(workspace_id,user_id) do update set role=excluded.role;
  update invitations set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  return invitation.workspace_id;
end $$;
revoke all on function public.accept_workspace_invitation(text) from public;
grant execute on function public.accept_workspace_invitation(text) to authenticated;