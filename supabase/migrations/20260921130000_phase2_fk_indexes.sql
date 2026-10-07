-- phase2_fk_indexes
-- Indici sulle chiavi esterne composte segnalate dall'advisor di performance.
-- Servono davvero: sono le FK verso tabelle dell'utente, quindi entrano in
-- gioco sia nelle cancellazioni a cascata sia nei filtri per categoria.
--
-- NON vengono creati gli indici sulle FK che puntano a `currencies`
-- (accounts.currency, transactions.currency, transactions.original_currency):
-- servirebbero solo a rendere veloce la verifica quando si cancella una
-- valuta, cosa che non succede mai (le valute si disattivano con `active`,
-- non si eliminano). Sarebbero tre indici da mantenere a ogni scrittura in
-- cambio di niente.

create index categories_parent_idx     on public.categories (parent_id, user_id) where parent_id is not null;
create index transactions_account_idx  on public.transactions (account_id, user_id);
create index transactions_category_idx on public.transactions (category_id, user_id) where category_id is not null;
