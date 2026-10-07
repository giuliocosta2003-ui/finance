-- phase6_fk_indexes
-- Indici di copertura sulle FK composte delle tabelle tasse, segnalate
-- dall'advisor di performance. Come in phase2/3/4: si indicizzano le FK verso
-- tabelle dell'utente (cascate e filtri), NON quella verso `currencies`
-- (tax_items.currency), che servirebbe solo a cancellare una valuta — cosa che
-- non accade, le valute si disattivano.

-- FK (tax_item_id, user_id): il periodo appartiene alla voce dell'utente.
create index tax_periods_item_fk_idx on public.tax_periods (tax_item_id, user_id);

-- FK (tax_period_id, user_id): copre anche l'indice singolo di prima, che tolgo.
drop index if exists public.tax_payments_period_idx;
create index tax_payments_period_fk_idx on public.tax_payments (tax_period_id, user_id);

-- FK verso profiles: i pagamenti dell'utente.
create index tax_payments_user_idx on public.tax_payments (user_id);

-- FK (tax_set_aside_account_id, id) su profiles: conta alla cancellazione del
-- conto di accantonamento.
create index profiles_set_aside_idx on public.profiles (tax_set_aside_account_id)
  where tax_set_aside_account_id is not null;
