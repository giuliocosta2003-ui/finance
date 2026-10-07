-- phase3_storage
-- Bucket privato per gli estratti conto caricati.
--
-- Il percorso e' `{user_id}/{import_id}/{nome_file}`: la prima cartella e'
-- l'id dell'utente, ed e' su quella che le policy fanno il controllo. Cosi'
-- l'isolamento non dipende da una colonna ma dal nome stesso del file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'statements',
  'statements',
  false,
  20971520, -- 20 MB: sopra questa soglia non e' piu' un estratto conto
  array[
    'text/csv',
    'text/plain',                                                         -- alcuni browser mandano i .csv cosi'
    'application/vnd.ms-excel',                                           -- .xls, e a volte i .csv da Windows
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  -- .xlsx
    'application/pdf',
    'application/x-ofx',
    'application/octet-stream'                                            -- .ofx/.qfx, che spesso arrivano senza tipo
  ]
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Niente policy di UPDATE: un estratto conto gia' caricato non si modifica.
-- Se serve rifarlo si cancella e si ricarica, cosi' resta tracciato.
create policy statements_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy statements_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy statements_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);
