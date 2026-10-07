-- phase2_fx_cron
-- Chi puo' far partire fx-daily, e quando.
--
-- Prerequisito (fuori da questa migrazione, perche' i segreti non si scrivono
-- in chiaro in un file versionato): nel Vault devono esistere
--   FX_CRON_SECRET   -- valore casuale, l'header x-cron-secret
--   FX_FUNCTION_URL  -- https://<project-ref>.supabase.co/functions/v1/fx-daily
-- creati una volta con vault.create_secret(...).

-- La Edge Function non ha accesso diretto allo schema vault: legge il segreto
-- da qui. security definer perche' vault.decrypted_secrets non e' leggibile
-- dai ruoli normali; l'execute e' concesso alla sola service role, quindi
-- nessun client (anon o authenticated) puo' chiamarla.
create or replace function public.fx_cron_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'FX_CRON_SECRET'
$$;

revoke execute on function public.fx_cron_secret() from public, anon, authenticated;
grant   execute on function public.fx_cron_secret() to service_role;

-- Due esecuzioni al giorno: la seconda e' una riprova. E' innocua perche' la
-- funzione e' idempotente (insert ... on conflict do nothing), quindi se la
-- prima e' andata bene la seconda salva zero righe.
select cron.unschedule('fx-daily-0130') where exists (select 1 from cron.job where jobname = 'fx-daily-0130');
select cron.unschedule('fx-daily-0730') where exists (select 1 from cron.job where jobname = 'fx-daily-0730');

select cron.schedule('fx-daily-0130', '30 1 * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'FX_FUNCTION_URL'),
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'FX_CRON_SECRET')
    ),
    body    := '{}'::jsonb
  );
$cron$);

select cron.schedule('fx-daily-0730', '30 7 * * *', $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'FX_FUNCTION_URL'),
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'FX_CRON_SECRET')
    ),
    body    := '{}'::jsonb
  );
$cron$);
