-- Historial de versiones de la bóveda (ya aplicado en Supabase el 2026-11-04).
-- Cada vez que la bóveda cambia en la nube, la versión anterior (cifrada) se guarda aquí.
-- Se conservan las últimas 30 versiones por usuario.

create table if not exists public.vault_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  rev bigint not null,
  data jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists vault_history_user_idx on public.vault_history (user_id, id desc);

alter table public.vault_history enable row level security;

drop policy if exists vault_history_select_own on public.vault_history;
create policy vault_history_select_own on public.vault_history
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists vault_history_delete_own on public.vault_history;
create policy vault_history_delete_own on public.vault_history
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Nadie inserta directo: solo el trigger.
create or replace function public.vault_keep_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.data is distinct from new.data then
    insert into public.vault_history (user_id, rev, data) values (old.user_id, old.rev, old.data);
    delete from public.vault_history h
     where h.user_id = old.user_id
       and h.id not in (
         select id from public.vault_history
          where user_id = old.user_id
          order by id desc
          limit 30);
  end if;
  return new;
end;
$$;
revoke all on function public.vault_keep_history() from public, anon, authenticated;

drop trigger if exists vaults_keep_history on public.vaults;
create trigger vaults_keep_history
  before update on public.vaults
  for each row execute function public.vault_keep_history();
