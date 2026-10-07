-- phase2_currencies_fx
-- Valute, tassi di cambio con pivot USD, log dei fetch e la funzione di cambio.
-- pg_cron schedula il job FX, pg_net fa la chiamata HTTP alla Edge Function.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ── currencies ───────────────────────────────────────────────────────────────
-- Fonte di verita' delle minor units: gli importi sono BIGINT in minor units,
-- quindi sbagliare qui significa sbagliare di 100 volte (VND, JPY) o di 10
-- (KWD, BHD). `name` e' solo un riferimento in inglese: nella UI il nome lo
-- produce Intl.DisplayNames nella lingua dell'utente.
create table public.currencies (
  code        char(3)  primary key check (code ~ '^[A-Z]{3}$'),
  name        text     not null,
  minor_units smallint not null check (minor_units between 0 and 4),
  active      boolean  not null default true
);
comment on table public.currencies is 'Valute ISO 4217 con i decimali ufficiali. Sola lettura per il client.';
comment on column public.currencies.minor_units is 'Decimali ISO 4217: VND/JPY/KRW 0, KWD/BHD/OMR 3.';

insert into public.currencies (code, name, minor_units) values
('AED','UAE Dirham',2),('AFN','Afghan Afghani',2),('ALL','Albanian Lek',2),
('AMD','Armenian Dram',2),('ANG','Netherlands Antillean Guilder',2),('AOA','Angolan Kwanza',2),
('ARS','Argentine Peso',2),('AUD','Australian Dollar',2),('AWG','Aruban Florin',2),
('AZN','Azerbaijani Manat',2),('BAM','Bosnia-Herzegovina Convertible Mark',2),('BBD','Barbadian Dollar',2),
('BDT','Bangladeshi Taka',2),('BGN','Bulgarian Lev',2),('BHD','Bahraini Dinar',3),
('BIF','Burundian Franc',0),('BMD','Bermudian Dollar',2),('BND','Brunei Dollar',2),
('BOB','Bolivian Boliviano',2),('BRL','Brazilian Real',2),('BSD','Bahamian Dollar',2),
('BTN','Bhutanese Ngultrum',2),('BWP','Botswana Pula',2),('BYN','Belarusian Ruble',2),
('BZD','Belize Dollar',2),('CAD','Canadian Dollar',2),('CDF','Congolese Franc',2),
('CHF','Swiss Franc',2),('CLP','Chilean Peso',0),('CNY','Chinese Yuan',2),
('COP','Colombian Peso',2),('CRC','Costa Rican Colon',2),('CUP','Cuban Peso',2),
('CVE','Cape Verdean Escudo',2),('CZK','Czech Koruna',2),('DJF','Djiboutian Franc',0),
('DKK','Danish Krone',2),('DOP','Dominican Peso',2),('DZD','Algerian Dinar',2),
('EGP','Egyptian Pound',2),('ERN','Eritrean Nakfa',2),('ETB','Ethiopian Birr',2),
('EUR','Euro',2),('FJD','Fijian Dollar',2),('FKP','Falkland Islands Pound',2),
('GBP','British Pound',2),('GEL','Georgian Lari',2),('GHS','Ghanaian Cedi',2),
('GIP','Gibraltar Pound',2),('GMD','Gambian Dalasi',2),('GNF','Guinean Franc',0),
('GTQ','Guatemalan Quetzal',2),('GYD','Guyanaese Dollar',2),('HKD','Hong Kong Dollar',2),
('HNL','Honduran Lempira',2),('HTG','Haitian Gourde',2),('HUF','Hungarian Forint',2),
('IDR','Indonesian Rupiah',2),('ILS','Israeli New Shekel',2),('INR','Indian Rupee',2),
('IQD','Iraqi Dinar',3),('IRR','Iranian Rial',2),('ISK','Icelandic Krona',0),
('JMD','Jamaican Dollar',2),('JOD','Jordanian Dinar',3),('JPY','Japanese Yen',0),
('KES','Kenyan Shilling',2),('KGS','Kyrgystani Som',2),('KHR','Cambodian Riel',2),
('KMF','Comorian Franc',0),('KPW','North Korean Won',2),('KRW','South Korean Won',0),
('KWD','Kuwaiti Dinar',3),('KYD','Cayman Islands Dollar',2),('KZT','Kazakhstani Tenge',2),
('LAK','Laotian Kip',2),('LBP','Lebanese Pound',2),('LKR','Sri Lankan Rupee',2),
('LRD','Liberian Dollar',2),('LSL','Lesotho Loti',2),('LYD','Libyan Dinar',3),
('MAD','Moroccan Dirham',2),('MDL','Moldovan Leu',2),('MGA','Malagasy Ariary',2),
('MKD','Macedonian Denar',2),('MMK','Myanmar Kyat',2),('MNT','Mongolian Tugrik',2),
('MOP','Macanese Pataca',2),('MRU','Mauritanian Ouguiya',2),('MUR','Mauritian Rupee',2),
('MVR','Maldivian Rufiyaa',2),('MWK','Malawian Kwacha',2),('MXN','Mexican Peso',2),
('MYR','Malaysian Ringgit',2),('MZN','Mozambican Metical',2),('NAD','Namibian Dollar',2),
('NGN','Nigerian Naira',2),('NIO','Nicaraguan Cordoba',2),('NOK','Norwegian Krone',2),
('NPR','Nepalese Rupee',2),('NZD','New Zealand Dollar',2),('OMR','Omani Rial',3),
('PAB','Panamanian Balboa',2),('PEN','Peruvian Sol',2),('PGK','Papua New Guinean Kina',2),
('PHP','Philippine Peso',2),('PKR','Pakistani Rupee',2),('PLN','Polish Zloty',2),
('PYG','Paraguayan Guarani',0),('QAR','Qatari Rial',2),('RON','Romanian Leu',2),
('RSD','Serbian Dinar',2),('RUB','Russian Ruble',2),('RWF','Rwandan Franc',0),
('SAR','Saudi Riyal',2),('SBD','Solomon Islands Dollar',2),('SCR','Seychellois Rupee',2),
('SDG','Sudanese Pound',2),('SEK','Swedish Krona',2),('SGD','Singapore Dollar',2),
('SHP','Saint Helena Pound',2),('SLE','Sierra Leonean Leone',2),('SOS','Somali Shilling',2),
('SRD','Surinamese Dollar',2),('SSP','South Sudanese Pound',2),('STN','Sao Tome and Principe Dobra',2),
('SVC','Salvadoran Colon',2),('SYP','Syrian Pound',2),('SZL','Swazi Lilangeni',2),
('THB','Thai Baht',2),('TJS','Tajikistani Somoni',2),('TMT','Turkmenistani Manat',2),
('TND','Tunisian Dinar',3),('TOP','Tongan Paanga',2),('TRY','Turkish Lira',2),
('TTD','Trinidad and Tobago Dollar',2),('TWD','New Taiwan Dollar',2),('TZS','Tanzanian Shilling',2),
('UAH','Ukrainian Hryvnia',2),('UGX','Ugandan Shilling',0),('USD','US Dollar',2),
('UYU','Uruguayan Peso',2),('UZS','Uzbekistani Som',2),('VES','Venezuelan Bolivar',2),
('VND','Vietnamese Dong',0),('VUV','Vanuatu Vatu',0),('WST','Samoan Tala',2),
('XAF','Central African CFA Franc',0),('XCD','East Caribbean Dollar',2),('XCG','Caribbean Guilder',2),
('XOF','West African CFA Franc',0),('XPF','CFP Franc',0),('YER','Yemeni Rial',2),
('ZAR','South African Rand',2),('ZMW','Zambian Kwacha',2),('ZWG','Zimbabwe Gold',2);

-- ── fx_rates ─────────────────────────────────────────────────────────────────
-- Pivot USD: una riga dice quante unita' di `quote` vale 1 USD. USD non ha
-- righe (varrebbe sempre 1) e le coppie si ottengono come rapporto, quindi
-- aggiungere una valuta non richiede di ricaricare tutte le combinazioni.
create table public.fx_rates (
  rate_date  date           not null,
  quote      char(3)        not null references public.currencies(code),
  rate       numeric(28,12) not null check (rate > 0),
  source     text           not null,
  fetched_at timestamptz    not null default now(),
  primary key (rate_date, quote)
);
comment on table public.fx_rates is 'Unita di <quote> per 1 USD. USD = 1 per definizione e non ha righe.';
create index fx_rates_quote_date_idx on public.fx_rates (quote, rate_date desc);

-- ── fx_fetch_log ─────────────────────────────────────────────────────────────
create table public.fx_fetch_log (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  rate_date   date,
  source      text,
  outcome     text not null check (outcome in ('ok','empty','error','anomaly','skipped')),
  rates_saved integer not null default 0,
  error       text
);
comment on table public.fx_fetch_log is 'Diario del job FX. Nessuna policy: lo legge solo la service role.';
create index fx_fetch_log_ran_at_idx on public.fx_fetch_log (ran_at desc);

-- ── RLS e permessi ───────────────────────────────────────────────────────────
-- currencies e fx_rates sono dati pubblici fra gli utenti autenticati: si
-- leggono e basta. Scrive solo la Edge Function con la service role, che
-- bypassa la RLS; per questo non esiste nessuna policy di scrittura.
alter table public.currencies   enable row level security;
alter table public.fx_rates     enable row level security;
alter table public.fx_fetch_log enable row level security;

create policy currencies_select_all on public.currencies
  for select to authenticated using (true);
create policy fx_rates_select_all on public.fx_rates
  for select to authenticated using (true);
-- fx_fetch_log: nessuna policy, quindi nessun client vede niente.

revoke all on public.currencies   from anon, authenticated;
revoke all on public.fx_rates     from anon, authenticated;
revoke all on public.fx_fetch_log from anon, authenticated;
grant select on public.currencies to authenticated;
grant select on public.fx_rates   to authenticated;

-- ── fx_rate() ────────────────────────────────────────────────────────────────
-- Cambio fra due valute a una certa data, via il pivot USD.
-- Regole: si prende l'ultimo tasso con data <= p_on (cosi' sabato usa venerdi');
-- se il piu' vecchio dei due tassi supera i 7 giorni il cambio non e'
-- affidabile e si restituisce NULL, perche' un valore vecchio e' peggio di un
-- valore assente. security invoker: legge fx_rates con i diritti del chiamante,
-- quindi la RLS vale anche qui.
create or replace function public.fx_rate(p_from char(3), p_to char(3), p_on date)
returns table (rate numeric, effective_date date)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from_rate numeric;
  v_from_date date;
  v_to_rate   numeric;
  v_to_date   date;
  v_eff       date;
begin
  if p_from is null or p_to is null or p_on is null then
    return query select null::numeric, null::date;
    return;
  end if;

  if p_from = p_to then
    return query select 1::numeric, p_on;
    return;
  end if;

  if p_from = 'USD' then
    v_from_rate := 1;
  else
    select fr.rate, fr.rate_date into v_from_rate, v_from_date
    from public.fx_rates fr
    where fr.quote = p_from and fr.rate_date <= p_on
    order by fr.rate_date desc
    limit 1;
  end if;

  if p_to = 'USD' then
    v_to_rate := 1;
  else
    select fr.rate, fr.rate_date into v_to_rate, v_to_date
    from public.fx_rates fr
    where fr.quote = p_to and fr.rate_date <= p_on
    order by fr.rate_date desc
    limit 1;
  end if;

  if v_from_rate is null or v_to_rate is null then
    return query select null::numeric, null::date;
    return;
  end if;

  -- Fra i due tassi comanda il piu' vecchio: e' quello che decide quanto e'
  -- attendibile il cambio.
  v_eff := least(coalesce(v_from_date, v_to_date), coalesce(v_to_date, v_from_date));

  if p_on - v_eff > 7 then
    return query select null::numeric, v_eff;
    return;
  end if;

  return query select v_to_rate / v_from_rate, v_eff;
end $$;

revoke execute on function public.fx_rate(char(3), char(3), date) from public, anon;
grant   execute on function public.fx_rate(char(3), char(3), date) to authenticated;
