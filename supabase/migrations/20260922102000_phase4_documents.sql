-- phase4_documents
-- Fatture, ricevute, buste paga e contratti: il file, i dati estratti da
-- Claude, e i collegamenti a movimenti e investimenti.
--
-- Perche' i campi fiscali (`net_minor`, `tax_minor`, `tax_rate`) ci sono gia'
-- adesso anche se le tasse sono di fase 5: raccoglierli dopo vorrebbe dire
-- rileggere ogni documento gia' archiviato. Costa nulla adesso, molto poi.

-- ── bucket ───────────────────────────────────────────────────────────────────
-- Stesse regole di `statements`: privato, e l'isolamento sta nel nome del file
-- (`{user_id}/{document_id}/{nome}`), non in una colonna.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520, -- 20 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
    -- Niente HEIC: Claude non lo accetta, e il browser converte in JPEG prima
    -- di caricare. Ammetterlo qui vorrebbe dire archiviare file illeggibili.
  ]
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Niente UPDATE: un documento caricato non si modifica, si sostituisce.
create policy documents_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy documents_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy documents_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── tabella ──────────────────────────────────────────────────────────────────

create type public.document_kind as enum
  ('invoice_issued','invoice_received','receipt','payslip','contract','other');

create type public.document_status as enum
  ('uploaded','extracting','pending_review','confirmed','failed');

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,

  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null,
  file_size     bigint,
  file_sha256   text,

  kind          public.document_kind not null default 'other',
  status        public.document_status not null default 'uploaded',

  -- Dati estratti, tutti facoltativi: un documento illeggibile resta comunque
  -- archiviato, e l'utente compila a mano quello che serve.
  issuer        text,
  counterparty  text,
  doc_date      date,
  due_date      date,
  reference     text,
  currency      char(3) references public.currencies(code),

  -- Buste paga: `total_minor` e' il NETTO. Lordo e contributi restano in
  -- `extraction`, e serviranno al tasso di risparmio della fase 5.
  total_minor   bigint,
  net_minor     bigint,
  tax_minor     bigint,
  tax_rate      numeric(5,2) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100)),

  -- L'output grezzo del modello, per capire dopo perche' un campo e' sbagliato.
  extraction    jsonb,
  flags         text[] not null default '{}',
  ai_input_tokens  integer not null default 0,
  ai_output_tokens integer not null default 0,

  -- Collegamenti facoltativi, tutti confermati dall'utente: mai automatici.
  transaction_id uuid,
  holding_id     uuid,
  holding_lot_id uuid,

  error         text,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (id, user_id),
  constraint documents_transaction_fkey foreign key (transaction_id, user_id)
    references public.transactions (id, user_id) on delete set null (transaction_id),
  constraint documents_holding_fkey foreign key (holding_id, user_id)
    references public.holdings (id, user_id) on delete set null (holding_id),
  constraint documents_lot_fkey foreign key (holding_lot_id, user_id)
    references public.holding_lots (id, user_id) on delete set null (holding_lot_id),

  -- Gli stessi valori ammessi dei flag di import_rows: una lista chiusa, cosi'
  -- un refuso non diventa un flag che nessuna schermata sa mostrare.
  constraint documents_flags_known check (
    flags <@ array['amounts_mismatch','unknown_currency','date_suspicious',
                   'duplicate_file','low_confidence','unreadable']::text[]
  )
);

comment on table public.documents is
  'Documenti caricati e i dati estratti. total_minor e il totale; per una busta paga e il netto.';

create index documents_user_idx        on public.documents (user_id, created_at desc);
create index documents_status_idx      on public.documents (user_id, status);
create index documents_sha_idx         on public.documents (user_id, file_sha256) where file_sha256 is not null;
create index documents_currency_idx    on public.documents (currency) where currency is not null;
create index documents_transaction_idx on public.documents (transaction_id, user_id) where transaction_id is not null;
create index documents_holding_idx     on public.documents (holding_id, user_id) where holding_id is not null;
create index documents_lot_idx         on public.documents (holding_lot_id, user_id) where holding_lot_id is not null;

create trigger documents_updated_at before update on public.documents
for each row execute function public.set_updated_at();

-- Il collegamento inverso, ora che `documents` esiste: la fattura d'acquisto
-- di un titolo sta attaccata al lotto.
alter table public.holding_lots
  add constraint holding_lots_document_fkey foreign key (document_id, user_id)
  references public.documents (id, user_id) on delete set null (document_id);

create index holding_lots_document_idx on public.holding_lots (document_id, user_id)
  where document_id is not null;

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.documents enable row level security;
alter table public.documents force  row level security;

create policy documents_select_own_row on public.documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy documents_insert_own_row on public.documents
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy documents_update_own_row on public.documents
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy documents_delete_own_row on public.documents
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.documents from anon, authenticated;
grant select, insert, delete on public.documents to authenticated;
grant update (storage_path, file_name, mime_type, file_size, file_sha256, kind, status,
              issuer, counterparty, doc_date, due_date, reference, currency,
              total_minor, net_minor, tax_minor, tax_rate, extraction, flags,
              ai_input_tokens, ai_output_tokens,
              transaction_id, holding_id, holding_lot_id, error, confirmed_at)
  on public.documents to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- L'estrazione gira in sottofondo: senza un canale, il client non saprebbe
-- quando ha finito. Come per `imports`, si pubblica solo la riga di stato.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documents'
  ) then
    alter publication supabase_realtime add table public.documents;
  end if;
end $$;
