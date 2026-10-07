-- phase4_prices_cron
-- Chi puo' far partire prices-daily, e quando.
--
-- Prerequisito (fuori da questa migrazione, perche' i segreti non si scrivono
-- in chiaro in un file versionato): nel Vault devono esistere
--   PRICES_CRON_SECRET   -- valore casuale, l'header x-cron-secret
--   PRICES_FUNCTION_URL  -- https://<project-ref>.supabase.co/functions/v1/prices-daily
-- creati una volta con vault.create_secret(...). Nei secret della funzione
-- serve inoltre COINGECKO_API_KEY.
--
-- Finche' i segreti non ci sono il job parte, non trova l'URL e non fa nulla:
-- il WHERE in fondo alla chiamata evita un errore ogni notte nel log di cron.

create or replace function public.prices_cron_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'PRICES_CRON_SECRET'
$$;

revoke execute on function public.prices_cron_secret() from public, anon, authenticated;
grant   execute on function public.prices_cron_secret() to service_role;

-- Alle 02:00 UTC, dopo il job FX delle 01:30: i prezzi si convertono in valuta
-- base col cambio del giorno, e conviene che il cambio ci sia gia'.
select cron.unschedule('prices-daily-0200') where exists (select 1 from cron.job where jobname = 'prices-daily-0200');

select cron.schedule('prices-daily-0200', '0 2 * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'PRICES_FUNCTION_URL'),
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'PRICES_CRON_SECRET')
    ),
    body    := '{}'::jsonb
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'PRICES_FUNCTION_URL');
$cron$);
