-- 20260922020000_phase3_realtime.sql
-- Fase 3, completamento: Realtime sulla riga di `imports` e l'ultimo indice di
-- copertura che mancava.
--
-- Perche' serve: la lettura di un PDF scansionato avviene in sottofondo, dopo
-- che la Edge Function ha gia' risposto. Senza un canale che avvisi, il client
-- non ha modo di sapere quando le righe sono pronte, e l'utente resta davanti a
-- un'attesa che non finisce. Si pubblica solo `imports`: e' una riga sola per
-- import, piccola, e basta a dire "e' pronto" o "e' andata male".
--
-- `import_rows` e `import_events` NON vanno in Realtime di proposito: sono
-- tante righe e, nel caso del diario, righe grandi. Il client, avvisato, va a
-- leggerle con una query normale, che passa dalla stessa RLS.

-- La pubblicazione esiste gia' in ogni progetto Supabase; qui si aggiunge solo
-- la tabella, e solo se non c'e' gia', perche' una migrazione si puo' riapplicare.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'imports'
  ) then
    alter publication supabase_realtime add table public.imports;
  end if;
end $$;

-- Realtime rispetta la RLS: un utente riceve gli eventi solo delle righe che
-- potrebbe leggere con una select. Le policy di `imports` sono gia' quelle
-- giuste e non si tocca niente qui.

-- Indice di copertura per l'ultima FK rimasta scoperta.
create index if not exists import_rows_currency_idx
  on public.import_rows (currency);
