-- 20260921024828_phase1_profiles
-- Copia versionata della migrazione gia' applicata al progetto Supabase
-- "finance-app" (dmnaxnvxxbqcibefirja). Serve a tenere lo schema nel repo:
-- non va ri-applicata a mano.

create type public.profile_type as enum ('student','employee','entrepreneur','other');
create type public.app_locale as enum ('it','en');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  intro text check (char_length(intro) <= 1000),
  profile_type public.profile_type,
  base_currency char(3) check (base_currency ~ '^[A-Z]{3}$'),
  country char(2) check (country ~ '^[A-Z]{2}$'),
  locale public.app_locale not null default 'it',
  onboarding_completed boolean not null default false,
  ai_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_requires_fields check (
    not onboarding_completed
    or (full_name is not null and profile_type is not null
        and base_currency is not null and country is not null)
  )
);
comment on table public.profiles is 'Un profilo per utente. Fonte di verita dopo il login: il frontend non legge mai profilo/stato dal JWT.';

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Nessuna policy INSERT/DELETE: la riga la crea il trigger, la cancella il cascade da auth.users.

revoke all on public.profiles from anon;
revoke insert, delete, truncate on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, intro, profile_type, base_currency, country, locale, onboarding_completed, ai_consent_at)
  on public.profiles to authenticated;
