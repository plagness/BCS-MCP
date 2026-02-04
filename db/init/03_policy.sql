\connect bcs_private

CREATE TABLE IF NOT EXISTS policy_docs (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO policy_docs (key, data)
VALUES (
  'bcs_policy_v1',
  jsonb_build_object(
    'equities_t1', jsonb_build_object(
      'broker_pct_range', jsonb_build_array(0.01, 0.03),
      'exchange_pct_range', jsonb_build_array(0.01, 0.01),
      'roundtrip_pct_range', jsonb_build_array(0.04, 0.08),
      'gdr_adr_risk', 'риск блокировки/обособления, возможны неторговые разделы',
      'overnight_repo', 'если продал и сразу выводишь/перекладываешь — кредит до Т+1 (ставка РЕПО)',
      'notes', jsonb_build_array(
        'Комиссия списывается при каждой сделке',
        'Округление до копейки может увеличить % на микролотах < 1000 руб'
      )
    ),
    'forts', jsonb_build_object(
      'broker_fee_rub_range', jsonb_build_array(1, 10),
      'exchange_fee_rub_range', jsonb_build_array(2, 5),
      'scalper_fee_note', 'на быстрых сделках комиссия может быть выше (мейкер/тейкер условия)',
      'forced_close_multiplier', 'двойная/тройная комиссия при принудительном закрытии на экспирации',
      'variation_margin', 'списывается/начисляется в клиринг; нужен кэш',
      'clearing_times', jsonb_build_array('14:00', '18:45')
    ),
    'bonds', jsonb_build_object(
      'commission_pct_range', jsonb_build_array(0.04, 0.08),
      'nkd_note', 'НКД — не комиссия, но расход при покупке',
      'offer_note', 'участие в оферте может быть платным (если только голосом)'
    ),
    'currency', jsonb_build_object(
      'lot_1000_note', 'стандартный режим, низкая комиссия',
      'odd_lot_note', 'лот <1000: иной стакан, хуже спред',
      'unfriendly_storage_annual_pct', 'до 12% годовых и выше',
      'withdrawal_note', 'вывод валюты платный (минимум ~30-50 у.е.)'
    ),
    'margin', jsonb_build_object(
      'long_annual_pct_range', jsonb_build_array(20, 25),
      'short_annual_pct_range', jsonb_build_array(20, 25),
      'weekend_multiplier', 'x3',
      'note', 'списание ежедневно за перенос позиции; лонг/шорт'
    ),
    'cash_fees', jsonb_build_object(
      'subscription_fee_rub', 299,
      'subscription_condition', 'если активов < 30000 руб и не было сделок',
      'unfriendly_storage_monthly', 'до 1% в месяц и выше'
    ),
    'systemic_fees', jsonb_build_object(
      'margin_call', 'принудительное закрытие: доп. комиссия (например 0.1% или фикс)',
      'hard_to_borrow', 'запрет на шорт — позицию могут закрыть принудительно',
      'phone_order', 'голосовое поручение ~500-1000 руб'
    ),
    'schedule_msk', jsonb_build_object(
      'morning_auction', '09:50-10:00',
      'main_session', '10:00-18:39:59',
      'mid_clearing', '14:00-14:05',
      'evening_clearing', '18:40-19:00',
      'evening_session', '19:05-23:50',
      'forts_day_change_time', '19:05'
    ),
    'tech_limits', jsonb_build_object(
      'rps', '5-10',
      'night_window', '00:00-07:00',
      'weekend', 'данные могут быть старыми или API недоступен'
    ),
    'api_specifics', jsonb_build_object(
      'identifiers', 'тикеры могут отличаться; маппинг через справочник',
      'historical_candles', 'обычно 1-3 месяца через Trade API',
      'level2_access', 'доступ к стакану зависит от тарифа',
      'portfolio_delay_seconds', '1-2',
      'odd_lots', 'отдельный board/режим, иные комиссии/стакан'
    ),
    'compact_sections', jsonb_build_object(
      'equities', 'Акции T+1: брокер 0.01–0.03% + биржа ~0.01%; круг 0.04–0.08%. Риск РЕПО при выводе в день продажи.',
      'forts', 'FORTS: фикс комиссия за контракт (брокер 1–10 руб, биржа 2–5 руб), вариационная маржа в клиринг 14:00/18:45.',
      'bonds', 'Облигации: комиссия как акции, НКД — расход при покупке.',
      'currency', 'FX: неполные лоты — отдельный стакан, хуже спред; хранение USD/EUR до 12% годовых.',
      'margin', 'Маржинальная торговля: ~20–25% годовых лонг/шорт, списание ежедневно; перенос через выходные = 3 дня.',
      'cash', 'Абонплата 299 руб/мес при отсутствии сделок и активов < 30000; хранение USD/EUR до ~1% в мес.',
      'systemic', 'Штрафы: margin call/принудительное закрытие, запрет шорта, голосовое поручение платное.'
    ),
    'compact', 'Ключевое: Акции T+1: брокер 0.01–0.03% + биржа ~0.01% (круг 0.04–0.08%), риск РЕПО при выводе в день продажи. FORTS: фикс комиссия за контракт (1–10 руб брокер + 2–5 руб биржа), вариационная маржа в клиринг 14:00/18:45. Маржинальная торговля: ~20–25% годовых лонг/шорт, перенос через выходные = 3 дня. Облигации: НКД — расход при покупке. FX: неполные лоты — отдельный стакан, хуже спред; хранение USD/EUR до 12% годовых и выше. Абонплата 299 руб/мес при отсутствии сделок и активов < 30000. Сессии (MSK): 09:50–10:00 аукцион, 10:00–18:39:59 основная, 14:00–14:05 клиринг, 18:40–19:00 клиринг, 19:05–23:50 вечерняя. FORTS новый день с 19:05. Ночью 00:00–07:00 возможны ошибки.'
  )
)
ON CONFLICT (key) DO UPDATE
SET data = EXCLUDED.data,
    updated_at = now();
