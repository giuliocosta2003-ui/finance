-- phase3_fk_indexes
-- Indici sulle chiavi esterne composte delle tabelle nuove.
--
-- Non sono cosmetici: sono le FK che il database deve verificare quando
-- cancella. Un rollback elimina centinaia di transazioni, e per ognuna deve
-- trovare le import_rows che la citano (matched_transaction_id,
-- transfer_match_transaction_id): senza indice sarebbe una scansione completa
-- per ogni riga cancellata.
--
-- Restano volutamente senza indice le FK verso `currencies`: le valute non si
-- cancellano mai, si disattivano con `active`.

create index imports_account_idx        on public.imports (account_id, user_id);
create index imports_profile_idx        on public.imports (parser_profile_id, user_id) where parser_profile_id is not null;

create index import_events_import_user_idx on public.import_events (import_id, user_id);
create index import_events_user_idx        on public.import_events (user_id);

create index import_rows_import_user_idx   on public.import_rows (import_id, user_id);
create index import_rows_category_idx      on public.import_rows (category_id, user_id) where category_id is not null;
create index import_rows_matched_idx       on public.import_rows (matched_transaction_id, user_id) where matched_transaction_id is not null;
create index import_rows_transfer_tx_idx   on public.import_rows (transfer_match_transaction_id, user_id) where transfer_match_transaction_id is not null;
create index import_rows_transfer_row_idx  on public.import_rows (transfer_match_row_id, user_id) where transfer_match_row_id is not null;

create index merchant_rules_category_idx on public.merchant_rules (category_id, user_id);
