'use client';

import { useEffect, useMemo, useState } from 'react';

const SETTINGS_STORAGE_KEY = 'lumora_settings_v16_saas_access';

const DEFAULT_SETTINGS = {
  theme: 'light',
  accent: 'gold',
  restaurantLabel: 'Ресторан',
  planDay: 150000,
  planWeek: 500000,
  planMonth: 3000000,
  avgCheckTarget: 2200,
  avgGuestTarget: 1700,
  foodcostEnabled: false,
  foodcostTarget: 30,
  discountLimit: 9000,
  autoRefresh: true,
  compactMode: false,
  hardAccessProtection: true,
  showFoodcostCard: false,
  aiTone: 'Управленческий',
  visible: {
    revenue: true,
    avgCheck: true,
    checks: true,
    guests: true,
    avgGuest: true,
    foodcost: false,
    discounts: true
  }
};

const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'reports', label: 'Отчёты' },
  { id: 'waiters', label: 'Официанты' },
  { id: 'ai', label: 'Lumora AI' },
  { id: 'analytics', label: 'AI-аналитика' },
  { id: 'plan', label: 'План' },
  { id: 'risks', label: 'Риски' },
  { id: 'control', label: 'Управление' }
];

const QUICK_QUESTIONS = [
  'Что мешает выполнить план?',
  'Что сделать сегодня?',
  'Какие скидки проверить?',
  'Какие блюда продвигать?',
  'Что видно по официантам?',
  'Сформируй план на неделю',
  'Сделай отчёт владельцу',
  'Дай скрипт для смены',
  'Что проверить по рискам?'
];

function getLocalDate() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function loadSettings() {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
    return {
      ...DEFAULT_SETTINGS,
      ...(stored || {}),
      visible: { ...DEFAULT_SETTINGS.visible, ...(stored?.visible || {}) }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(next) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  document.documentElement.dataset.theme = next.theme;
  document.documentElement.dataset.accent = next.accent;
}

function money(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₽`;
}

function num(value) {
  return Math.round(Number(value || 0)).toLocaleString('ru-RU');
}

function pct(value) {
  const n = Number(value || 0);
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function metric(summary, key) {
  return (summary?.metrics || []).find((item) => item.key === key) || null;
}

function metricRaw(summary, key) {
  return Number(metric(summary, key)?.raw || 0);
}

function activePlan(settings, period) {
  if (period === 'week') return Number(settings.planWeek || 0);
  if (period === 'month') return Number(settings.planMonth || 0);
  return Number(settings.planDay || 0);
}

function periodTitle(period) {
  if (period === 'week') return 'Неделя';
  if (period === 'month') return 'Месяц';
  return 'Сегодня';
}

function planLabel(period) {
  if (period === 'week') return 'План недели';
  if (period === 'month') return 'План месяца';
  return 'План дня';
}

function heroTitle(period) {
  if (period === 'week') return 'Контроль недели';
  if (period === 'month') return 'Контроль месяца';
  return 'Сегодняшний контроль';
}

function toneClass(level) {
  if (level === 'bad' || level === 'Высокий') return 'bad';
  if (level === 'warn' || level === 'Средний') return 'warn';
  if (level === 'good' || level === 'Низкий') return 'good';
  return 'neutral';
}

function Sparkline({ data = [], field = 'revenue' }) {
  const values = data.map((item) => Number(item?.[field] || item?.revenue || 0)).filter(Number.isFinite);
  const safe = values.length > 1 ? values : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = max - min || 1;
  const points = safe.map((value, index) => {
    const x = (index / Math.max(safe.length - 1, 1)) * 100;
    const y = 44 - ((value - min) / range) * 34;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,48 ${points} 100,48`} fill="currentColor" opacity="0.08" />
    </svg>
  );
}

function TopBar({ summary, settings, setSettings, restaurantId, setRestaurantId, restaurants, canSelectAll = true, date, setDate, openNotifications }) {
  function toggleTheme() {
    const next = { ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' };
    setSettings(next);
    saveSettings(next);
  }

  return (
    <header className="topbar">
      <div className="brand-row">
        <div className="brand-mark">✦</div>
        <div className="brand-copy">
          <strong>КЛИК</strong>
          <span>AI-аналитик ресторана</span>
        </div>
        <button className="ghost-icon" onClick={toggleTheme} aria-label="Тема">{settings.theme === 'dark' ? '☾' : '☀'}</button>
        <button className="notify-btn" onClick={openNotifications} aria-label="Уведомления">⌁</button>
      </div>

      <div className="filter-row">
        <select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)} aria-label="Ресторан">
          {canSelectAll ? <option value="all">Вся сеть</option> : null}
          {restaurants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Дата" />
      </div>
      <div className="data-note">{summary?.period?.title || 'Данные iiko'} · обновлено {summary?.generatedAt || '—'}</div>
    </header>
  );
}

function TopTabs({ tab, setTab, authInfo }) {
  const tabs = getVisibleTabs(authInfo);
  if (!tabs.length) return null;
  return (
    <nav className="top-tabs" aria-label="Разделы">
      {tabs.map((item) => (
        <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function PeriodSwitch({ period, setPeriod }) {
  return (
    <div className="period-switch">
      <button className={period === 'day' ? 'active' : ''} onClick={() => setPeriod('day')}>День</button>
      <button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>Неделя</button>
      <button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Месяц</button>
    </div>
  );
}

function Section({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="section-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function statDeltaText(item) {
  if (!item) return '—';
  if (item.key === 'avgCheck') {
    if (item.status === 'good') return 'выше цели';
    if (item.status === 'bad') return 'ниже цели';
  }
  if (item.key === 'discounts' && item.status === 'bad' && item.delta) return item.delta;
  return item.delta || '—';
}

function StatCard({ item, trend }) {
  if (!item || item.disabled) return null;
  return (
    <article className={`stat-card ${item.status || 'neutral'}`}>
      <div className="stat-top"><span>{item.label}</span><b>{statDeltaText(item)}</b></div>
      <strong>{item.value}</strong>
      {trend ? <Sparkline data={trend} field={item.key === 'avgCheck' ? 'avgCheck' : item.key === 'checks' ? 'checks' : 'revenue'} /> : null}
    </article>
  );
}

function EmptyState({ title = 'Данных пока нет', text = 'Lumora ждёт первые чеки из iiko. Старые блюда и официанты не подмешиваются.' }) {
  return (
    <div className="empty-state">
      <div className="empty-star">✦</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}


function HourlyAnalyticsBlock({ summary, compact = false }) {
  const analytics = summary?.hourlyAnalytics || {};
  const peaks = analytics.peaks || summary?.hourlyPeaks || [];
  const weakHours = analytics.weakHours || summary?.weakHours || [];
  const bestHour = analytics.bestHour || peaks[0];

  if (!peaks.length && !weakHours.length) {
    return (
      <Section title="Почасовая аналитика" subtitle="пики и слабые часы продаж">
        <EmptyState title="Почасовки пока нет" text="После загрузки hourly_sales Lumora покажет пики, слабые часы и рекомендации по смене." />
      </Section>
    );
  }

  return (
    <>
      <Section title="Пики продаж по часам" subtitle="когда ресторан зарабатывает больше всего">
        <div className="forecast-grid">
          <div><span>Лучший час</span><b>{bestHour?.label || '—'}</b><p>{bestHour?.revenueText || '—'}</p></div>
          <div><span>Обед</span><b>{analytics.lunchRevenueText || '—'}</b><p>{analytics.lunchShare || 0}% выручки</p></div>
          <div><span>Вечер</span><b>{analytics.eveningRevenueText || '—'}</b><p>{analytics.eveningShare || 0}% выручки</p></div>
        </div>
        <p className="soft-text">{analytics.insight || 'Lumora анализирует распределение выручки по часам.'}</p>
        <div className="event-list">
          {peaks.slice(0, compact ? 3 : 5).map((item) => (
            <div className="channel-row" key={`peak-${item.hour}`}>
              <div><b>{item.label}</b><span>{item.checks} чеков · средний {item.avgCheckText}</span></div>
              <div><strong>{item.revenueText}</strong><em>{item.share}%</em></div>
            </div>
          ))}
        </div>
      </Section>

      {!compact ? (
        <Section title="Слабые часы" subtitle="где стоит проверить загрузку смены">
          <div className="event-list">
            {weakHours.slice(0, 5).map((item) => (
              <div className="channel-row muted" key={`weak-${item.hour}`}>
                <div><b>{item.label}</b><span>{item.checks} чеков · средний {item.avgCheckText}</span></div>
                <div><strong>{item.revenueText}</strong><em>{item.share}%</em></div>
              </div>
            ))}
          </div>
          <p className="soft-text">{analytics.advice || 'Слабые часы лучше оценивать вместе с расписанием смены и временем работы кухни.'}</p>
        </Section>
      ) : null}
    </>
  );
}


function NetworkPointsBlock({ summary, compact = false }) {
  const restaurants = summary?.network?.restaurants || [];
  const visibleRestaurants = restaurants.filter((item) => Number(item?.revenue || 0) > 0);
  const totalRevenue = visibleRestaurants.reduce((total, item) => total + Number(item?.revenue || 0), 0);
  const leader = [...visibleRestaurants].sort((a, b) => Number(b?.revenue || 0) - Number(a?.revenue || 0))[0];

  if (!visibleRestaurants.length) {
    return (
      <Section title="Точки сети" subtitle="выручка по отдельным ресторанам">
        <EmptyState title="Данных по точкам пока нет" text="После загрузки daily_sales Lumora покажет выручку и долю каждой точки." />
      </Section>
    );
  }

  return (
    <Section title="Точки сети" subtitle="выручка и доля каждой точки">
      {!compact ? (
        <div className="forecast-grid">
          <div><span>Сумма точек</span><b>{money(totalRevenue)}</b><p>{visibleRestaurants.length} точки</p></div>
          <div><span>Лидер</span><b>{leader?.name || '—'}</b><p>{leader ? money(leader.revenue) : '—'}</p></div>
          <div><span>Доля лидера</span><b>{totalRevenue && leader ? Math.round((Number(leader.revenue || 0) / totalRevenue) * 100) : 0}%</b><p>от выручки точек</p></div>
        </div>
      ) : null}

      <div className="event-list">
        {visibleRestaurants.slice(0, compact ? 2 : 6).map((item) => {
          const revenue = Number(item?.revenue || 0);
          const share = totalRevenue ? Math.round((revenue / totalRevenue) * 100) : 0;
          return (
            <div className="channel-row" key={item.id || item.name}>
              <div>
                <b>{item.name}</b>
                <span>выручка и доля за выбранный период</span>
              </div>
              <div><strong>{money(revenue)}</strong><em>{share}%</em></div>
            </div>
          );
        })}
      </div>
      <p className="soft-text">Точки считаются по выбранному периоду: день, неделя или месяц. Сумма точек должна сходиться с выручкой всей сети.</p>
    </Section>
  );
}


function DiscountAnalyticsBlock({ summary, compact = false }) {
  const analytics = summary?.discountAnalytics || {};
  const channels = analytics.channels || summary?.discountByChannels || [];
  const days = analytics.days || summary?.discountByDays || [];
  const riskyDays = analytics.riskyDays || summary?.discountRiskDays || [];
  const worstChannel = analytics.worstChannel || channels[0];
  const worstDay = analytics.worstDay || riskyDays[0] || days.slice().sort((a, b) => Number(b?.percent || 0) - Number(a?.percent || 0))[0];

  const totalBonusesText = analytics.totalBonusesText || '0 ₽';
  const loyaltyOrdersCount = Number(analytics.loyaltyOrdersCount || 0);
  const bonusOrdersCount = Number(analytics.bonusOrdersCount || 0);
  const loyaltyShareText = analytics.loyaltyShareText || '0%';
  const bonusText = analytics.bonusInsight || (
    loyaltyOrdersCount > 0
      ? `Списаний бонусов нет, но заказов с картой/лояльностью: ${loyaltyOrdersCount}.`
      : 'Списаний бонусов и заказов с картой за период не видно.'
  );

  if (!channels.length && !days.length) {
    return (
      <Section title="Скидки и бонусы" subtitle="скидки, списания и бонусная система">
        <EmptyState title="Скидок пока нет" text="После загрузки channel_sales Lumora покажет скидки, бонусы и заказы с картой." />
      </Section>
    );
  }

  return (
    <Section title="Скидки и бонусы" subtitle="скидки, списания бонусов и заказы с картой">
      <div className="forecast-grid">
        <div>
          <span>Всего скидок</span>
          <b>{analytics.totalDiscountsText || money(0)}</b>
          <p>{analytics.percentText || '0%'} от продаж</p>
        </div>

        <div>
          <span>Бонусы</span>
          <b>{totalBonusesText}</b>
          <p>{bonusOrdersCount > 0 ? `${bonusOrdersCount} заказов со списанием` : 'списаний за период нет'}</p>
        </div>

        <div>
          <span>Карты / лояльность</span>
          <b>{loyaltyOrdersCount}</b>
          <p>{loyaltyOrdersCount > 0 ? `${loyaltyShareText} от чеков` : 'заказов с картой не видно'}</p>
        </div>
      </div>

      <p className="soft-text">{analytics.insight || bonusText}</p>

      <div className="event-list">
        {channels.slice(0, compact ? 3 : 5).map((item) => (
          <div className={`channel-row ${toneClass(item.status)}`} key={`discount-channel-${item.key || item.name}`}>
            <div>
              <b>{item.name}</b>
              <span>
                {item.statusText || 'статус'} · {item.revenueText} выручки · бонусы {item.bonusesText || '0 ₽'}
              </span>
            </div>
            <div>
              <strong>{item.discountsText}</strong>
              <em>{item.percentText}</em>
            </div>
          </div>
        ))}
      </div>

      {!compact ? (
        <>
          <div className="event-list">
            {days.slice(0, 7).map((item) => (
              <div className={`channel-row ${toneClass(item.status)}`} key={`discount-day-${item.date || item.label}`}>
                <div>
                  <b>{item.label || item.date}</b>
                  <span>
                    {item.statusText || 'статус'} · {item.revenueText} выручки · бонусы {item.bonusesText || '0 ₽'}
                  </span>
                </div>
                <div>
                  <strong>{item.discountsText}</strong>
                  <em>{item.percentText}</em>
                </div>
              </div>
            ))}
          </div>

          <div className="ai-note">
            <b>Бонусная система</b>
            <p>{bonusText}</p>
          </div>

          <p className="soft-text">{analytics.advice || 'Если процент скидок выше обычного, проверьте причины скидок, смену и канал продаж.'}</p>
        </>
      ) : null}
    </Section>
  );
}

function buildOwnerReport(summary) {
  const revenue = metricRaw(summary, 'revenue');
  const checks = metricRaw(summary, 'checks');
  const guests = metricRaw(summary, 'guests');
  const avgCheck = metricRaw(summary, 'avgCheck');
  const avgGuest = metricRaw(summary, 'avgGuest');
  const discounts = metric(summary, 'discounts');
  const plan = Number(summary?.plan?.activeRevenue || summary?.restaurant?.plan || 0);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : 0;
  const avgCheckTarget = Number(summary?.plan?.avgCheck || 0);
  const bestHour = summary?.hourlyAnalytics?.bestHour || summary?.hourlyPeaks?.[0];
  const bestChannel = summary?.salesChannels?.[0] || summary?.channels?.[0];
  const discount = summary?.discountAnalytics || {};
  const worstChannel = discount.worstChannel || summary?.discountByChannels?.[0];
  const worstDay = discount.worstDay || summary?.discountRiskDays?.[0] || summary?.discountByDays?.[0];
  const topDish = summary?.topDishes?.[0];
  const periodTitleText = summary?.period?.title || 'выбранный период';

  const lines = [
    `Отчёт владельцу Lumora`,
    `${periodTitleText}`,
    ``,
    `1. Выручка: ${money(revenue)}. План: ${money(plan)}, выполнение ${planPercent}%.`,
    `2. Чеки: ${num(checks)}. Гости: ${num(guests)}. Средний чек: ${money(avgCheck)}${avgCheckTarget ? ` при цели ${money(avgCheckTarget)}` : ''}. Средний чек гостя: ${money(avgGuest)}.`,
    bestChannel ? `3. Основной канал: ${bestChannel.name}, ${bestChannel.revenueText || money(bestChannel.revenue)}, доля ${bestChannel.share || 0}%.` : null,
    bestHour ? `4. Главный час продаж: ${bestHour.label}, ${bestHour.revenueText || money(bestHour.revenue)}.` : null,
    discount.totalDiscountsText ? `5. Скидки: ${discount.totalDiscountsText}, ${discount.percentText || discounts?.delta || '0%'} от продаж. Основной канал проверки: ${worstChannel?.name || 'нет'}.` : `5. Скидки: ${discounts?.value || money(0)}, ${discounts?.delta || '0% от продаж'}.`,
    topDish ? `6. Блюдо в фокусе: ${topDish.name}, ${topDish.revenue}.` : null,
    ``,
    `Что проверить:`,
    planPercent < 85 ? `- План-факт: до плана не хватает ${money(Math.max(plan - revenue, 0))}.` : `- План-факт: текущий период идёт близко к цели или выше нормы.`,
    worstChannel ? `- Скидки в канале ${worstChannel.name}: ${worstChannel.percentText || ''}, ${worstChannel.discountsText || ''}.` : null,
    worstDay ? `- День со скидками: ${worstDay.label}, ${worstDay.percentText || ''}, ${worstDay.discountsText || ''}.` : null,
    bestHour ? `- Смену и кухню усилить около ${bestHour.label}.` : null,
    `- Фудкост смотреть по подключенной себестоимости и категориям.`,
    `- По официантам смотреть выручку; средний чек пока на проверке.`
  ];

  return lines.filter(Boolean).join('\n');
}

function OwnerReportBlock({ summary, compact = false }) {
  const [copied, setCopied] = useState(false);
  const report = buildOwnerReport(summary);
  const revenue = metricRaw(summary, 'revenue');
  const plan = Number(summary?.plan?.activeRevenue || summary?.restaurant?.plan || 0);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : 0;
  const bestHour = summary?.hourlyAnalytics?.bestHour || summary?.hourlyPeaks?.[0];
  const discount = summary?.discountAnalytics || {};
  const worstDay = discount.worstDay || summary?.discountRiskDays?.[0] || summary?.discountByDays?.[0];

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section title="Отчёт владельцу" subtitle="готовая выжимка для отправки" action={<button onClick={copyReport}>{copied ? 'Скопировано' : 'Скопировать отчёт'}</button>}>
      <div className="forecast-grid">
        <div><span>Выручка</span><b>{money(revenue)}</b><p>{planPercent}% плана</p></div>
        <div><span>Пик продаж</span><b>{bestHour?.label || '—'}</b><p>{bestHour?.revenueText || 'нет данных'}</p></div>
        <div><span>Скидки</span><b>{discount.percentText || metric(summary, 'discounts')?.delta || '0%'}</b><p>{worstDay ? `проверить ${worstDay.label}` : 'контроль нормы'}</p></div>
      </div>
      <div className="ai-note">
        <b>{summary?.ai?.summary || 'Lumora сформирует отчёт после загрузки данных.'}</b>
        {!compact ? <pre className="soft-text" style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{report}</pre> : <p>{summary?.forecast?.recommendations?.[0] || 'Проверьте план-факт, скидки и пики продаж.'}</p>}
      </div>
    </Section>
  );
}



function ExecutiveFocusBlock({ summary, settings, setTab }) {
  const revenue = metricRaw(summary, 'revenue');
  const selectedPeriod = summary?.period?.type || 'day';
  const plan = activePlan(settings, selectedPeriod);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : 0;
  const gap = Math.max(plan - revenue, 0);
  const bestHour = summary?.hourlyAnalytics?.bestHour || summary?.hourlyPeaks?.[0];
  const discount = summary?.discountAnalytics || {};
  const worstChannel = discount.worstChannel || summary?.discountByChannels?.[0];
  const topDish = summary?.topDishes?.[0];
  const mainFocus = planPercent < 85
    ? 'Добрать план-факт'
    : discount.status === 'warn' || discount.status === 'bad'
      ? 'Проверить скидки'
      : bestHour
        ? `Усилить пик ${bestHour.label}`
        : 'Удержать темп';

  return (
    <Section title="Командный фокус" subtitle="что важно сделать сейчас" action={<button onClick={() => setTab('plan')}>к плану</button>}>
      <div className="forecast-grid">
        <div><span>Главный фокус</span><b>{mainFocus}</b><p>{gap > 0 ? `до плана ${money(gap)}` : 'план близко или закрыт'}</p></div>
        <div><span>Пик смены</span><b>{bestHour?.label || '—'}</b><p>{bestHour?.revenueText || 'нет почасовки'}</p></div>
        <div><span>Контроль скидок</span><b>{discount.percentText || metric(summary, 'discounts')?.delta || '0%'}</b><p>{worstChannel ? `${worstChannel.name}: ${worstChannel.discountsText}` : 'без явного риска'}</p></div>
      </div>
      <div className="event-list">
        {(summary?.forecast?.recommendations || []).slice(0, 3).map((item, index) => (
          <div className="insight-row" key={`focus-${index}`}><span>{index + 1}</span><p>{item}</p></div>
        ))}
        {topDish ? <div className="insight-row"><span>4</span><p>Меню: держать в фокусе {topDish.name}, выручка {topDish.revenue}.</p></div> : null}
      </div>
      <div className="quick-grid">
        <button onClick={() => setTab('risks')}>Проверить риски</button>
        <button onClick={() => setTab('ai')}>Спросить Lumora AI</button>
        <button onClick={() => setTab('reports')}>Открыть отчёты</button>
      </div>
    </Section>
  );
}

function buildExportPack(summary) {
  const blocks = [
    buildOwnerReport(summary),
    '',
    'Скрипт для команды:',
    summary?.teamScript || 'Скрипт появится после данных.',
    '',
    buildRiskReport(summary)
  ];

  if (summary?.ai?.recommendations?.length) {
    blocks.push('', 'Рекомендации Lumora:', ...summary.ai.recommendations.slice(0, 6).map((item, index) => `${index + 1}. ${item}`));
  }

  return blocks.filter(Boolean).join('\n');
}

function ExportPackBlock({ summary }) {
  const [copied, setCopied] = useState(false);
  const pack = buildExportPack(summary);

  async function copyPack() {
    try {
      await navigator.clipboard.writeText(pack);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section title="Пакет для владельца" subtitle="отчёт + риски + скрипт в один текст" action={<button onClick={copyPack}>{copied ? 'Скопировано' : 'Скопировать всё'}</button>}>
      <div className="forecast-grid">
        <div><span>Отчёт</span><b>готов</b><p>цифры и выводы</p></div>
        <div><span>Риски</span><b>{riskScoreValue(summary)}/100</b><p>индекс контроля</p></div>
        <div><span>Команда</span><b>скрипт</b><p>для рабочего чата</p></div>
      </div>
      <p className="soft-text">Один текст можно отправить владельцу, управляющему или в рабочий чат. Без технички, только управленческая выжимка.</p>
    </Section>
  );
}

function MenuStrategyBlock({ summary }) {
  const [copied, setCopied] = useState(false);
  const topDish = summary?.topDishes?.[0];
  const weakDish = summary?.lowDishes?.[0];
  const topCategory = summary?.categories?.[0];
  const discount = summary?.discountAnalytics || {};
  const text = [
    'Меню-фокус Lumora',
    summary?.period?.title || 'выбранный период',
    topDish ? `1. Продвигать сильную позицию: ${topDish.name}, выручка ${topDish.revenue}.` : null,
    topCategory ? `2. Главная категория: ${topCategory.name}, выручка ${topCategory.revenueText}.` : null,
    weakDish ? `3. Проверить слабую позицию: ${weakDish.name}, ${weakDish.revenue}. Без жёстких выводов до подключения маржи.` : null,
    discount.worstChannel ? `4. Следить, чтобы продвижение не разгоняло скидки в канале ${discount.worstChannel.name}.` : null,
    '5. Фудкост и маржу не обещать до подключения себестоимости iiko.'
  ].filter(Boolean).join('\n');

  async function copyMenuFocus() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section title="Меню-фокус" subtitle="что продвигать и что проверить" action={<button onClick={copyMenuFocus}>{copied ? 'Скопировано' : 'Скопировать меню-фокус'}</button>}>
      <div className="forecast-grid">
        <div><span>Продвигать</span><b>{topDish?.name || '—'}</b><p>{topDish?.revenue || 'нет данных'}</p></div>
        <div><span>Категория</span><b>{topCategory?.name || '—'}</b><p>{topCategory?.revenueText || 'нет данных'}</p></div>
        <div><span>Проверить</span><b>{weakDish?.name || '—'}</b><p>{weakDish?.revenue || 'без слабых позиций'}</p></div>
      </div>
      <p className="soft-text">Lumora показывает, что можно продвигать по выручке. Маржу и фудкост включаем только после подключения себестоимости.</p>
    </Section>
  );
}

function WaiterShiftScriptBlock({ summary }) {
  const [copied, setCopied] = useState(false);
  const waiters = summary?.waiters || [];
  const leader = waiters[0];
  const low = waiters.length ? [...waiters].sort((a, b) => Number(a.rawRevenue || 0) - Number(b.rawRevenue || 0))[0] : null;
  const script = summary?.teamScript || 'Скрипт появится после данных.';
  const text = [
    'Скрипт для смены Lumora',
    summary?.period?.title || 'выбранный период',
    '',
    script,
    '',
    leader ? `Лидер по выручке: ${leader.name}, ${leader.revenue}.` : null,
    low ? `Зона внимания по выручке: ${low.name}, ${low.revenue}. Средний чек по сотрудникам пока на проверке.` : null,
    'Важно: по официантам сейчас безопасно смотреть выручку; средний чек по сотрудникам пока на проверке.'
  ].filter(Boolean).join('\n');

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section title="Скрипт для смены" subtitle="готовый текст для рабочего чата" action={<button onClick={copyScript}>{copied ? 'Скопировано' : 'Скопировать скрипт'}</button>}>
      <div className="forecast-grid">
        <div><span>Лидер</span><b>{leader?.name || '—'}</b><p>{leader?.revenue || 'нет данных'}</p></div>
        <div><span>Фокус</span><b>{summary?.hourlyAnalytics?.bestHour?.label || 'смена'}</b><p>{summary?.hourlyAnalytics?.bestHour?.revenueText || 'пики продаж'}</p></div>
        <div><span>Средний чек</span><b>на проверке</b><p>выручка точная</p></div>
      </div>
      <div className="ai-note"><b>{script}</b></div>
    </Section>
  );
}

function DataReadinessBlock({ summary }) {
  return (
    <Section title="Статус данных" subtitle="что уже можно показывать клиенту">
      <div className="event-list">
        <div className="event-row good"><span>✓</span><div><b>KPI</b><p>{summary?.dataQuality?.kpi || 'Выручка, чеки, гости и средние чеки подключены.'}</p></div></div>
        <div className="event-row good"><span>✓</span><div><b>Каналы и скидки</b><p>{summary?.dataQuality?.discounts || 'Скидки считаются по проценту от продаж.'}</p></div></div>
        <div className="event-row good"><span>✓</span><div><b>Почасовка</b><p>{summary?.dataQuality?.hourly || 'Пики продаж по часам подключены.'}</p></div></div>
        <div className="event-row warn"><span>!</span><div><b>Официанты</b><p>{'Выручка по сотрудникам подключена. Средний чек по сотрудникам показываем осторожно.'}</p></div></div>
        <div className="event-row warn"><span>!</span><div><b>Точки сети</b><p>{'Точки сети считаются по выбранному периоду и сходятся с выручкой сети.'}</p></div></div>
        <div className="event-row neutral"><span>•</span><div><b>Фудкост</b><p>{summary?.dataQuality?.foodcost || 'Себестоимость нужно подключить отдельным этапом.'}</p></div></div>
      </div>
    </Section>
  );
}

function TodayScreen({ summary, settings, setTab, period, setPeriod }) {
  const revenue = metricRaw(summary, 'revenue');
  const checks = metricRaw(summary, 'checks');
  const guests = metricRaw(summary, 'guests');
  const plan = activePlan(settings, period);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : 0;
  const visible = ['revenue', 'avgCheck', 'checks', 'guests', 'avgGuest', 'foodcost', 'discounts']
    .filter((key) => settings.visible?.[key] !== false)
    .map((key) => metric(summary, key));

  return (
    <div className="screen-stack">
      <div className="hero-card">
        <div>
          <span className="eyebrow">{heroTitle(period)}</span>
          <h1>{money(revenue)}</h1>
          <p>{summary?.isEmptyPeriod ? 'Продаж за выбранный период пока нет.' : `${planLabel(period)} ${money(plan)} выполнен на ${planPercent}%.`}</p>
        </div>
        <div className="orb-progress" style={{ '--p': `${Math.min(planPercent, 100)}%` }}>
          <b>{planPercent}%</b>
          <span>плана</span>
        </div>
      </div>

      <PeriodSwitch period={period} setPeriod={setPeriod} />

      <div className="stat-grid">
        {visible.map((item) => <StatCard key={item?.key} item={item} trend={summary?.week} />)}
      </div>

      <Section title="Прогноз выручки" subtitle="по текущему темпу и плану" action={<button onClick={() => setTab('plan')}>план</button>}>
        <div className="forecast-grid">
          <div><span>Сейчас</span><b>{money(revenue)}</b></div>
          <div><span>Прогноз</span><b>{money(summary?.forecast?.projected || 0)}</b></div>
          <div><span>{planLabel(period)}</span><b>{money(plan)}</b></div>
        </div>
        <p className="soft-text">{summary?.forecast?.risk || 'Прогноз появится после первых продаж.'}</p>
      </Section>

      <HourlyAnalyticsBlock summary={summary} compact />

      <NetworkPointsBlock summary={summary} compact />

      <Section title="Топ-10 категорий по выручке" subtitle="что приносит основную кассу">
        {summary?.categories?.length ? summary.categories.slice(0, 10).map((item) => (
          <div className="category-row" key={item.name}>
            <div><b>{item.name}</b><span>{num(item.quantity)} продаж</span></div>
            <div><strong>{item.revenueText}</strong><span>{item.cost > 0 ? `Фудкост: ${item.foodcostText} · Маржа: ${item.marginText}` : 'Себестоимость не подключена'}</span></div>
          </div>
        )) : <EmptyState title="Категорий пока нет" />}
      </Section>

      <DiscountAnalyticsBlock summary={summary} compact />

      <Section title="Главные события дня" subtitle="что было хорошо и что требует внимания">
        {summary?.moments?.length ? (
          <div className="event-list">
            {summary.moments.slice(0, 5).map((item, index) => (
              <div className={`event-row ${toneClass(item.level)}`} key={`${item.title}-${index}`}>
                <span>{item.level === 'good' ? '✓' : item.level === 'bad' ? '!' : '•'}</span>
                <div><b>{item.title}</b><p>{item.text}</p></div>
              </div>
            ))}
          </div>
        ) : <EmptyState title="Событий пока нет" text="После первых чеков Lumora покажет пики, просадки и важные сигналы." />}
      </Section>

      <Section title="Lumora-сигнал" subtitle="краткий вывод AI-аналитика" action={<button onClick={() => setTab('ai')}>спросить</button>}>
        <div className="ai-note">
          <b>{summary?.ai?.summary || 'Lumora ждёт данные.'}</b>
          <p>{summary?.ai?.recommendations?.[0] || 'После обновления iiko появятся рекомендации.'}</p>
        </div>
      </Section>
    </div>
  );
}

function ReportsScreen({ summary, period, setPeriod }) {
  const channels = summary?.salesChannels || [];
  const top = summary?.topDishes || [];
  const low = summary?.lowDishes || [];
  const categories = summary?.categories || [];

  return (
    <div className="screen-stack">
      <PeriodSwitch period={period} setPeriod={setPeriod} />
      <div className="stat-grid compact">
        {['revenue', 'avgCheck', 'checks', 'guests', 'avgGuest', 'foodcost'].map((key) => <StatCard key={key} item={metric(summary, key)} trend={summary?.week} />)}
      </div>

      <Section title={`Моменты: ${periodTitle(period).toLowerCase()}`} subtitle="лучшие и слабые точки периода">
        {summary?.moments?.length ? (
          <div className="event-list">{summary.moments.map((item, index) => <div className={`event-row ${toneClass(item.level)}`} key={index}><span>✦</span><div><b>{item.title}</b><p>{item.text}</p></div></div>)}</div>
        ) : <EmptyState />}
      </Section>

      <OwnerReportBlock summary={summary} />

      <ExportPackBlock summary={summary} />

      <HourlyAnalyticsBlock summary={summary} />

      <Section title="Источники выручки" subtitle="зал, доставка, самовывоз">
        {channels.length ? channels.map((item) => (
          <div className="channel-row" key={item.key}>
            <div><b>{item.name}</b><span>{item.checks} чеков · средний {money(item.avgCheck)}</span></div>
            <div><strong>{item.revenueText}</strong><em>{item.share}%</em></div>
          </div>
        )) : <EmptyState title="Каналов пока нет" text="После загрузки channel_sales появится зал, доставка и самовывоз." />}
      </Section>

      <DiscountAnalyticsBlock summary={summary} />

      <NetworkPointsBlock summary={summary} />

      <Section title="Категории еды" subtitle="выручка и количество продаж по категориям">
        {categories.length ? categories.slice(0, 8).map((item) => (
          <div className="category-row" key={item.name}>
            <div><b>{item.name}</b><span>{num(item.quantity)} порций</span></div>
            <div><strong>{item.revenueText}</strong><span>{item.cost > 0 ? `Себ.: ${item.foodcostText} · Маржа: ${item.marginText}` : 'Маржа появится после подключения себестоимости'}</span></div>
          </div>
        )) : <EmptyState title="Категорий пока нет" />}
      </Section>

      <MenuStrategyBlock summary={summary} />

      <div className="two-panels">
        <Section title="Топ-5 блюд" subtitle="по выручке">
          {top.length ? top.slice(0, 5).map((dish, index) => <DishLine key={`${dish.name}-${index}`} dish={dish} index={index} />) : <EmptyState title="Блюд пока нет" />}
        </Section>
        <Section title="Позиции с низкой выручкой" subtitle="что стоит проверить без жёстких выводов">
          {low.length ? low.slice(0, 5).map((dish, index) => <DishLine key={`${dish.name}-${index}`} dish={dish} index={index} weak />) : <EmptyState title="Таких позиций нет" />}
        </Section>
      </div>
    </div>
  );
}

function DishLine({ dish, index, weak = false }) {
  return (
    <div className="dish-line">
      <span>{index + 1}</span>
      <div><b>{dish.name}</b><p>{weak ? `${dish.category || 'Меню'} · ${dish.amount} · ${dish.issue || 'низкая выручка за период'}` : `${dish.category || 'Меню'} · ${dish.amount}`}</p></div>
      <strong>{dish.revenue}</strong>
    </div>
  );
}

function WaitersScreen({ summary, period, setPeriod }) {
  const waiters = summary?.waiters || [];
  return (
    <div className="screen-stack">
      <PeriodSwitch period={period} setPeriod={setPeriod} />
      <WaiterShiftScriptBlock summary={summary} />
      <Section title="Выручка по официантам" subtitle="выручка точная, средний чек по сотрудникам на проверке">
        {waiters.length ? waiters.map((waiter, index) => (
          <div className="waiter-row" key={`${waiter.name}-${index}`}>
            <span className="rank">{index + 1}</span>
            <div><b>{waiter.name}</b><p>Выручка учтена · допродажи добавим после проверки чеков</p></div>
            <div><strong>{waiter.revenue}</strong><span>{waiter.checks} чеков · {waiter.avgCheck}</span></div>
          </div>
        )) : <EmptyState title="Официантов за период нет" text="Данные появятся после загрузки продаж за выбранную дату." />}
      </Section>
      <Section title="Совет Lumora команде" subtitle="что усилить для роста выручки">
        <div className="ai-note"><b>{summary?.teamScript || 'Скрипт появится после данных.'}</b></div>
      </Section>
    </div>
  );
}

function AiScreen({ summary, restaurantId, period, date }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lumora_ai_history') || '[]');
      setMessages(stored);
    } catch {
      setMessages([]);
    }
  }, []);

  function persist(next) {
    setMessages(next);
    localStorage.setItem('lumora_ai_history', JSON.stringify(next.slice(-30)));
  }

  async function ask(text = question) {
    const q = String(text || '').trim();
    if (!q || loading) return;
    const userMessage = { role: 'Вы', text: q, time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) };
    const next = [...messages, userMessage];
    persist(next);
    setQuestion('');
    setLoading(true);
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...telegramAuthHeaders() },
        body: JSON.stringify({ restaurant_id: restaurantId, question: q, period, date, history: next.slice(-6) })
      });
      const data = await response.json();
      persist([...next, { role: 'Lumora', text: data.answer || 'Не удалось получить ответ.', time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }]);
    } catch {
      persist([...next, { role: 'Lumora', text: 'Не удалось подключиться к AI. Проверь OPENAI_API_KEY или попробуй позже.', time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen-stack ai-screen">
      <Section title="Lumora AI" subtitle="задавайте вопросы по данным ресторана">
        <div className="quick-grid">{QUICK_QUESTIONS.map((item) => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div>
      </Section>

      <div className="chat-box">
        {messages.length ? messages.map((msg, index) => (
          <div className={`message ${msg.role === 'Вы' ? 'user' : 'assistant'}`} key={`${msg.time}-${index}`}>
            <span>{msg.role} · {msg.time}</span>
            <p>{msg.text}</p>
          </div>
        )) : (
          <div className="message assistant"><span>Lumora</span><p>{summary?.ai?.summary || 'Спросите Lumora, где ресторан теряет деньги и что сделать сегодня.'}</p></div>
        )}
        {loading ? <div className="message assistant"><span>Lumora</span><p>Анализирую данные…</p></div> : null}
      </div>

      <div className="chat-input">
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Задайте вопрос Lumora…" onKeyDown={(event) => { if (event.key === 'Enter') ask(); }} />
        <button onClick={() => ask()}>➤</button>
      </div>
    </div>
  );
}

function AnalyticsScreen({ summary }) {
  const recommendations = summary?.ai?.recommendations || [];
  return (
    <div className="screen-stack">
      <Section title="AI-аналитика" subtitle="готовые выводы Lumora">
        <div className="ai-note big"><b>{summary?.ai?.summary}</b></div>
        {recommendations.map((text, index) => (
          <div className="insight-row" key={text}><span>{index + 1}</span><p>{text}</p></div>
        ))}
      </Section>
      <Section title="Где теряем деньги" subtitle="оценка по правилам Lumora">
        {(summary?.moneyLosses || []).map((item) => <RiskLine item={item} key={item.title} />)}
      </Section>
    </div>
  );
}


function buildWeeklyPlanText(summary, settings) {
  const revenue = metricRaw(summary, 'revenue');
  const checks = metricRaw(summary, 'checks');
  const guests = metricRaw(summary, 'guests');
  const avgCheck = metricRaw(summary, 'avgCheck');
  const selectedPeriod = summary?.period?.type || 'week';
  const plan = activePlan(settings, selectedPeriod);
  const percent = plan ? Math.round((revenue / plan) * 100) : 0;
  const gap = Math.max(plan - revenue, 0);
  const bestHour = summary?.hourlyAnalytics?.bestHour || summary?.hourlyPeaks?.[0];
  const discount = summary?.discountAnalytics || {};
  const worstChannel = discount.worstChannel || summary?.discountByChannels?.[0];
  const worstDay = discount.worstDay || summary?.discountRiskDays?.[0] || summary?.discountByDays?.[0];
  const topDish = summary?.topDishes?.[0];
  const weakDish = summary?.lowDishes?.[0];
  const bestChannel = summary?.salesChannels?.[0] || summary?.channels?.[0];
  const periodTitleText = summary?.period?.title || 'выбранный период';
  const forecast = summary?.forecast || {};

  const lines = [
    'План Lumora',
    periodTitleText,
    '',
    `Цель: довести выручку до ${money(plan)}. Сейчас: ${money(revenue)}, выполнение ${percent}%.`,
    gap > 0 ? `До плана осталось: ${money(gap)}.` : 'План по выручке выполнен или близок к выполнению.',
    `Чеки: ${num(checks)}. Гости: ${num(guests)}. Средний чек: ${money(avgCheck)}.`,
    bestChannel ? `Главный канал: ${bestChannel.name}, ${bestChannel.revenueText || money(bestChannel.revenue)}, доля ${bestChannel.share || 0}%.` : null,
    bestHour ? `Главный пик: ${bestHour.label}, ${bestHour.revenueText || money(bestHour.revenue)}. Усилить кухню и смену вокруг этого времени.` : null,
    discount.totalDiscountsText ? `Скидки: ${discount.totalDiscountsText}, ${discount.percentText || '0%'} от продаж. Проверить: ${worstChannel?.name || 'канал'} и ${worstDay?.label || 'день с максимумом'}.` : null,
    topDish ? `Меню: держать в фокусе ${topDish.name}, выручка ${topDish.revenue}.` : null,
    weakDish ? `Проверить слабую позицию: ${weakDish.name}, ${weakDish.revenue}. Без жёстких выводов до маржи.` : null,
    '',
    'Задачи:',
    ...(summary?.actionPlan || []).slice(0, 6).map((item, index) => `${index + 1}. ${item.title}: ${item.text}`),
    '',
    'Контроль:',
    '- Каждый день смотреть план-факт и прогноз.',
    '- Скидки оценивать по проценту от продаж, не только по рублям.',
    '- По официантам пока смотреть выручку; средний чек по сотрудникам на проверке.',
    '- Фудкост смотреть по подключенной себестоимости и категориям.'
  ];

  if (forecast.recommendations?.length) {
    lines.push('', 'Рекомендации Lumora:', ...forecast.recommendations.slice(0, 5).map((item) => `- ${item}`));
  }

  return lines.filter(Boolean).join('\n');
}

function WeeklyActionPlanBlock({ summary, settings, compact = false }) {
  const [copied, setCopied] = useState(false);
  const revenue = metricRaw(summary, 'revenue');
  const selectedPeriod = summary?.period?.type || 'week';
  const plan = activePlan(settings, selectedPeriod);
  const percent = plan ? Math.round((revenue / plan) * 100) : 0;
  const gap = Math.max(plan - revenue, 0);
  const bestHour = summary?.hourlyAnalytics?.bestHour || summary?.hourlyPeaks?.[0];
  const discount = summary?.discountAnalytics || {};
  const worstChannel = discount.worstChannel || summary?.discountByChannels?.[0];
  const actions = summary?.actionPlan || [];
  const planText = buildWeeklyPlanText(summary, settings);

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(planText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Section title="План действий" subtitle="что делать владельцу, управляющему и смене" action={<button onClick={copyPlan}>{copied ? 'Скопировано' : 'Скопировать план'}</button>}>
      <div className="forecast-grid">
        <div><span>Выполнение</span><b>{percent}%</b><p>{money(revenue)} из {money(plan)}</p></div>
        <div><span>До плана</span><b>{money(gap)}</b><p>{gap > 0 ? 'нужно добрать' : 'цель закрыта'}</p></div>
        <div><span>Фокус</span><b>{bestHour?.label || worstChannel?.name || 'План-факт'}</b><p>{bestHour ? `пик ${bestHour.revenueText}` : worstChannel ? `скидки ${worstChannel.percentText}` : 'контроль периода'}</p></div>
      </div>

      <div className="event-list">
        {actions.slice(0, compact ? 3 : 6).map((item, index) => (
          <div className="plan-row" key={`${item.title}-${index}`}>
            <span>{index + 1}</span>
            <div><b>{item.title}</b><p>{item.text}</p></div>
          </div>
        ))}
      </div>

      {!compact ? <pre className="soft-text" style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{planText}</pre> : <p className="soft-text">{summary?.forecast?.recommendations?.[0] || 'План формируется на основе выручки, скидок, часов, блюд и рисков.'}</p>}
    </Section>
  );
}

function PlanScreen({ summary, settings }) {
  const revenue = metricRaw(summary, 'revenue');
  const selectedPeriod = summary?.period?.type || 'day';
  const plan = activePlan(settings, selectedPeriod);
  const percent = plan ? Math.round((revenue / plan) * 100) : 0;
  const gap = Math.max(plan - revenue, 0);
  return (
    <div className="screen-stack">
      <Section title={`План: ${periodTitle(selectedPeriod).toLowerCase()}`} subtitle="план-факт, прогноз и действия">
        <div className="plan-card">
          <span>Выполнение выбранного периода</span>
          <b>{percent}%</b>
          <p>{money(revenue)} из {money(plan)} · до плана {money(gap)}</p>
        </div>
        <div className="forecast-grid">
          <div><span>Сейчас</span><b>{money(revenue)}</b><p>факт периода</p></div>
          <div><span>Прогноз</span><b>{money(summary?.forecast?.projected || 0)}</b><p>{summary?.forecast?.risk || 'оценка Lumora'}</p></div>
          <div><span>Уверенность</span><b>{summary?.forecast?.confidence || 0}%</b><p>по доступным данным</p></div>
        </div>
      </Section>

      <WeeklyActionPlanBlock summary={summary} settings={settings} />

      <Section title="Рекомендации к плану" subtitle="короткий список контроля">
        {(summary?.forecast?.recommendations || []).slice(0, 6).map((item, index) => (
          <div className="insight-row" key={`${item}-${index}`}><span>{index + 1}</span><p>{item}</p></div>
        ))}
      </Section>
    </div>
  );
}


function riskScoreValue(summary) {
  const risks = summary?.problems?.length ? summary.problems : summary?.moneyLosses || [];
  const revenue = metricRaw(summary, 'revenue');
  const plan = Number(summary?.plan?.activeRevenue || summary?.restaurant?.plan || 0);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : 0;
  const discountStatus = summary?.discountAnalytics?.status || metric(summary, 'discounts')?.status;
  let score = 0;

  if (planPercent < 60) score += 35;
  else if (planPercent < 85) score += 20;
  else if (planPercent < 100) score += 8;

  risks.forEach((item) => {
    if (item.level === 'bad' || item.level === 'Высокий') score += 24;
    if (item.level === 'warn' || item.level === 'Средний') score += 12;
  });

  if (discountStatus === 'bad') score += 18;
  if (discountStatus === 'warn') score += 8;
  if (summary?.dataQuality?.foodcost?.includes('не подключено')) score += 6;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function riskLevelFromScore(score) {
  if (score >= 70) return { level: 'bad', title: 'Высокий', text: 'нужен быстрый разбор сегодня' };
  if (score >= 35) return { level: 'warn', title: 'Средний', text: 'есть зоны контроля' };
  return { level: 'good', title: 'Низкий', text: 'критичных отклонений нет' };
}

function buildRiskReport(summary) {
  const risks = summary?.problems?.length ? summary.problems : summary?.moneyLosses || [];
  const alerts = summary?.alerts || [];
  const score = riskScoreValue(summary);
  const level = riskLevelFromScore(score);
  const revenue = metricRaw(summary, 'revenue');
  const plan = Number(summary?.plan?.activeRevenue || summary?.restaurant?.plan || 0);
  const planPercent = plan ? Math.round((revenue / plan) * 100) : 0;
  const discount = summary?.discountAnalytics || {};
  const worstChannel = discount.worstChannel || summary?.discountByChannels?.[0];
  const worstDay = discount.worstDay || summary?.discountRiskDays?.[0] || summary?.discountByDays?.[0];
  const bestHour = summary?.hourlyAnalytics?.bestHour || summary?.hourlyPeaks?.[0];
  const periodTitleText = summary?.period?.title || 'выбранный период';

  const lines = [
    'Риски Lumora',
    periodTitleText,
    '',
    `Индекс риска: ${score}/100. Уровень: ${level.title}.`,
    `План-факт: ${money(revenue)} из ${money(plan)}, выполнение ${planPercent}%.`,
    discount.totalDiscountsText ? `Скидки: ${discount.totalDiscountsText}, ${discount.percentText || '0%'} от продаж. Проверить: ${worstChannel?.name || 'канал'} / ${worstDay?.label || 'день'}.` : null,
    bestHour ? `Пиковый час: ${bestHour.label}, ${bestHour.revenueText}. В это время важны кухня, заготовки и смена.` : null,
    '',
    'Главные риски:',
    ...(risks.length ? risks.slice(0, 6).map((item, index) => `${index + 1}. ${item.title}: ${item.reason || item.action || item.impact || 'проверить'}`) : ['1. Критичных рисков не видно.']),
    '',
    'Сигналы:',
    ...(alerts.length ? alerts.slice(0, 5).map((item) => `- ${item.title}: ${item.text}`) : ['- Сигналов пока нет.']),
    '',
    'Ограничения данных:',
    '- Фудкост смотреть по подключенной себестоимости и категориям.',
    '- По официантам сейчас безопасно смотреть выручку, средний чек справочный.',
    '- По точкам сети сравнивать выручку и долю за выбранный период.'
  ];

  return lines.filter(Boolean).join('\n');
}

function RiskDashboardBlock({ summary }) {
  const [copied, setCopied] = useState(false);
  const risks = summary?.problems?.length ? summary.problems : summary?.moneyLosses || [];
  const alerts = summary?.alerts || [];
  const score = riskScoreValue(summary);
  const level = riskLevelFromScore(score);
  const report = buildRiskReport(summary);
  const mainRisk = risks.find((item) => item.level === 'bad') || risks.find((item) => item.level === 'warn') || risks[0];
  const discount = summary?.discountAnalytics || {};
  const worstChannel = discount.worstChannel || summary?.discountByChannels?.[0];
  const worstDay = discount.worstDay || summary?.discountRiskDays?.[0] || summary?.discountByDays?.[0];

  async function copyRiskReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Section title="Карта рисков" subtitle="что проверить в первую очередь" action={<button onClick={copyRiskReport}>{copied ? 'Скопировано' : 'Скопировать риски'}</button>}>
        <div className="forecast-grid">
          <div><span>Индекс риска</span><b>{score}/100</b><p>{level.text}</p></div>
          <div><span>Уровень</span><b>{level.title}</b><p>{mainRisk?.title || 'без критики'}</p></div>
          <div><span>Проверить</span><b>{worstChannel?.name || worstDay?.label || 'План-факт'}</b><p>{worstDay ? `${worstDay.percentText} скидок` : 'контроль периода'}</p></div>
        </div>
        <p className="soft-text">Lumora учитывает план-факт, скидки, сигналы, фудкост и качество данных. Индекс нужен как быстрый ориентир, а не как бухгалтерский расчёт.</p>
      </Section>

      <Section title="Главные риски" subtitle="что выше нормы или требует контроля">
        {risks.length ? risks.map((item, index) => <RiskLine item={item} key={`${item.title}-${index}`} />) : <EmptyState title="Рисков пока нет" />}
      </Section>

      <Section title="Сигналы Lumora" subtitle="короткие уведомления по периоду">
        {alerts.length ? alerts.map((item, index) => <div className={`event-row ${toneClass(item.level)}`} key={index}><span>⌁</span><div><b>{item.title}</b><p>{item.text}</p></div></div>) : <EmptyState title="Сигналов пока нет" />}
      </Section>

      <Section title="Качество данных" subtitle="что можно показывать клиенту уверенно">
        <div className="event-list">
          <div className="event-row good"><span>✓</span><div><b>KPI и каналы</b><p>{summary?.dataQuality?.kpi || 'Выручка, чеки и каналы подключены.'}</p></div></div>
          <div className="event-row good"><span>✓</span><div><b>Почасовка</b><p>{summary?.dataQuality?.hourly || 'Пики продаж по часам подключены.'}</p></div></div>
          <div className="event-row warn"><span>!</span><div><b>Официанты</b><p>{'Выручка по сотрудникам подключена. Средний чек по сотрудникам показываем осторожно.'}</p></div></div>
          <div className="event-row warn"><span>!</span><div><b>Точки сети</b><p>{'Точки сети считаются по выбранному периоду и сходятся с выручкой сети.'}</p></div></div>
          <div className="event-row neutral"><span>•</span><div><b>Фудкост</b><p>{summary?.dataQuality?.foodcost || 'Себестоимость нужно подключить отдельно.'}</p></div></div>
        </div>
      </Section>

      <Section title="Отчёт по рискам" subtitle="готовый текст для управляющего">
        <pre className="soft-text" style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{report}</pre>
      </Section>
    </>
  );
}

function RiskLine({ item }) {
  return (
    <div className={`risk-line ${toneClass(item.level)}`}>
      <div><b>{item.title}</b><p>{item.reason || item.action}</p></div>
      <strong>{item.amount ? money(item.amount) : item.impact || '—'}</strong>
    </div>
  );
}

function RisksScreen({ summary }) {
  return (
    <div className="screen-stack">
      <RiskDashboardBlock summary={summary} />
    </div>
  );
}


const ACCESS_ADMIN_STORAGE_KEY = 'klik_access_admin_key';

function roleLabel(role) {
  const map = { owner: 'Владелец', admin: 'Администратор', manager: 'Управляющий', viewer: 'Просмотр' };
  return map[role] || role || 'Просмотр';
}

function uniqueList(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

function getActiveAccess(authInfo) {
  return Array.isArray(authInfo?.access) ? authInfo.access.filter((item) => item?.status === 'active' && item?.restaurant_id) : [];
}

function getAllowedRestaurantIds(authInfo) {
  return uniqueList(getActiveAccess(authInfo).map((item) => item.restaurant_id));
}

function isTelegramAccessMode(authInfo) {
  return authInfo?.mode === 'telegram';
}

function telegramAuthHeaders() {
  if (typeof window === 'undefined') return {};
  const initData = window.Telegram?.WebApp?.initData || '';
  return initData ? { Authorization: `tma ${initData}` } : {};
}

function canUseAllRestaurants(authInfo) {
  const allowedIds = getAllowedRestaurantIds(authInfo);
  if (!isTelegramAccessMode(authInfo)) return true;
  if (isPlatformOwnerUser(authInfo)) return true;
  return allowedIds.length >= 2;
}

function filterRestaurantsByAccess(restaurants, authInfo) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  if (!isTelegramAccessMode(authInfo)) return list;
  if (isPlatformOwnerUser(authInfo)) return list;

  const allowedIds = getAllowedRestaurantIds(authInfo);
  if (!allowedIds.length) return [];

  return list.filter((item) => allowedIds.includes(item.id));
}

function normalizeInputUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}


function platformStatusLabel(value) {
  const map = { active: 'Активен', paused: 'Пауза', archived: 'Архив' };
  return map[value] || value || 'Активен';
}

function subscriptionStatusLabel(value) {
  const map = { trial: 'Trial', active: 'Оплачено', overdue: 'Просрочено', cancelled: 'Отключено' };
  return map[value] || value || 'Trial';
}

function subscriptionTone(value) {
  if (value === 'active') return 'good';
  if (value === 'overdue' || value === 'cancelled') return 'bad';
  if (value === 'trial') return 'warn';
  return 'neutral';
}

function businessRestaurantsText(business) {
  const restaurants = Array.isArray(business?.restaurants) ? business.restaurants : [];
  if (!restaurants.length) return 'Рестораны пока не привязаны';
  return restaurants.map((item) => item.name || item.id).join(', ');
}


function businessRoleLabel(role) {
  const map = {
    platform_owner: 'Владелец платформы',
    platform_admin: 'Админ платформы',
    business_owner: 'Владелец бизнеса',
    business_admin: 'Администратор бизнеса',
    accountant: 'Бухгалтер',
    viewer: 'Просмотр'
  };
  return map[role] || role || 'Пользователь';
}

function getPlatformInfo(authInfo) {
  return authInfo?.platform && typeof authInfo.platform === 'object' ? authInfo.platform : {};
}

function isPlatformOwnerUser(authInfo) {
  const platform = getPlatformInfo(authInfo);
  return Boolean(platform?.isPlatformOwner || platform?.role === 'platform_owner');
}

function getBusinessCabinetBusinesses(authInfo) {
  const platform = getPlatformInfo(authInfo);
  return Array.isArray(platform?.businesses) ? platform.businesses : [];
}

function getBusinessCabinetUsers(authInfo) {
  const platform = getPlatformInfo(authInfo);
  return Array.isArray(platform?.businessUsers) ? platform.businessUsers : [];
}

function canManageAccessCabinet(authInfo) {
  if (!isTelegramAccessMode(authInfo)) return true;
  if (isPlatformOwnerUser(authInfo)) return true;
  return getBusinessCabinetUsers(authInfo).some((item) => ['business_owner', 'business_admin'].includes(item.role));
}

function hasAnyProductAccess(authInfo) {
  if (!isTelegramAccessMode(authInfo)) return true;
  if (isPlatformOwnerUser(authInfo)) return true;
  if (getBusinessCabinetBusinesses(authInfo).length) return true;
  if (getActiveAccess(authInfo).length) return true;
  return false;
}

function getPrimaryBusinessRole(authInfo) {
  if (isPlatformOwnerUser(authInfo)) return 'platform_owner';
  const businessUsers = getBusinessCabinetUsers(authInfo);
  if (businessUsers.some((item) => item.role === 'business_owner')) return 'business_owner';
  if (businessUsers.some((item) => item.role === 'business_admin')) return 'business_admin';
  if (businessUsers[0]?.role) return businessUsers[0].role;
  const activeAccess = getActiveAccess(authInfo);
  if (activeAccess.some((item) => item.role === 'owner')) return 'owner';
  if (activeAccess.some((item) => item.role === 'admin')) return 'admin';
  if (activeAccess[0]?.role) return activeAccess[0].role;
  return '';
}

const SECTION_PERMISSION_OPTIONS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'reports', label: 'Отчёты' },
  { id: 'waiters', label: 'Официанты' },
  { id: 'ai', label: 'Lumora AI' },
  { id: 'analytics', label: 'AI-аналитика' },
  { id: 'plan', label: 'План' },
  { id: 'risks', label: 'Риски' },
  { id: 'control', label: 'Управление' }
];

function defaultSectionsForRole(role) {
  if (['platform_owner', 'platform_admin', 'business_owner', 'business_admin', 'owner', 'admin'].includes(role)) {
    return SECTION_PERMISSION_OPTIONS.map((item) => item.id);
  }
  if (role === 'accountant') return ['today', 'reports', 'analytics', 'risks'];
  if (role === 'manager') return ['today', 'reports', 'waiters', 'analytics', 'plan', 'risks'];
  if (role === 'viewer') return ['today', 'reports', 'risks'];
  if (role === 'employee') return ['today', 'waiters'];
  return ['today'];
}

function normalizePermissions(value, role = '') {
  const defaults = defaultSectionsForRole(role);
  if (!value || typeof value !== 'object') return { sections: defaults, can_manage_employees: ['business_owner', 'business_admin', 'platform_owner'].includes(role) };
  const sections = Array.isArray(value.sections) && value.sections.length ? value.sections : defaults;
  return {
    ...value,
    sections,
    can_manage_employees: Boolean(value.can_manage_employees || ['business_owner', 'business_admin', 'platform_owner'].includes(role))
  };
}

function getCurrentPermissions(authInfo) {
  const role = getPrimaryBusinessRole(authInfo);
  if (!isTelegramAccessMode(authInfo)) return normalizePermissions({ sections: SECTION_PERMISSION_OPTIONS.map((item) => item.id), can_manage_employees: true }, 'platform_owner');
  if (isPlatformOwnerUser(authInfo)) return normalizePermissions({ sections: SECTION_PERMISSION_OPTIONS.map((item) => item.id), can_manage_employees: true }, 'platform_owner');
  const userRows = getBusinessCabinetUsers(authInfo);
  const row = userRows.find((item) => item.permissions) || userRows[0] || null;
  return normalizePermissions(row?.permissions, role);
}

function canSeeSection(authInfo, sectionId) {
  if (!hasAnyProductAccess(authInfo)) return false;
  if (!isTelegramAccessMode(authInfo)) return true;
  if (isPlatformOwnerUser(authInfo)) return true;
  const permissions = getCurrentPermissions(authInfo);
  return (permissions.sections || []).includes(sectionId);
}

function canManageBusinessEmployees(authInfo) {
  if (!isTelegramAccessMode(authInfo)) return true;
  if (isPlatformOwnerUser(authInfo)) return true;
  const role = getPrimaryBusinessRole(authInfo);
  const permissions = getCurrentPermissions(authInfo);
  return ['business_owner', 'business_admin'].includes(role) || Boolean(permissions.can_manage_employees);
}

function getVisibleTabs(authInfo) {
  if (isTelegramAccessMode(authInfo) && !hasAnyProductAccess(authInfo)) return [];

  const dashboardTabs = TABS.filter((item) => item.id !== 'control').filter((item) => canSeeSection(authInfo, item.id));

  if (isPlatformOwnerUser(authInfo)) {
    return [
      { id: 'platform', label: 'Платформа' },
      ...dashboardTabs,
      { id: 'client', label: 'Клиент' },
      { id: 'control', label: 'Управление' }
    ];
  }

  if (getBusinessCabinetBusinesses(authInfo).length) {
    return [
      { id: 'client', label: 'Мой бизнес' },
      ...dashboardTabs,
      ...(canSeeSection(authInfo, 'control') ? [{ id: 'control', label: 'Управление' }] : [])
    ];
  }

  if (getActiveAccess(authInfo).length) {
    return [
      ...dashboardTabs,
      ...(canSeeSection(authInfo, 'control') ? [{ id: 'control', label: 'Управление' }] : [])
    ];
  }

  return TABS;
}

function getAllowedBusinessIds(authInfo) {
  return uniqueList(getBusinessCabinetBusinesses(authInfo).map((item) => item.id));
}

function permissionLabel(id) {
  return SECTION_PERMISSION_OPTIONS.find((item) => item.id === id)?.label || id;
}


function accessPolicyTitle(authInfo) {
  if (!isTelegramAccessMode(authInfo)) return 'Dev-режим без Telegram';
  if (isPlatformOwnerUser(authInfo)) return 'Полный доступ владельца платформы';
  if (getBusinessCabinetBusinesses(authInfo).length) return 'Кабинет клиента';
  if (getActiveAccess(authInfo).length) return 'Доступ сотрудника';
  return 'Доступ не найден';
}

function accessPolicyText(authInfo) {
  if (!isTelegramAccessMode(authInfo)) return 'В браузере дашборд открыт для проверки. В проде клиентские роли проверяются в Telegram Mini App.';
  if (isPlatformOwnerUser(authInfo)) return 'Ты видишь всех клиентов, бизнесы, подписки, рестораны и сотрудников. Это внутренний режим владельца КЛИК.';
  if (getBusinessCabinetBusinesses(authInfo).length) return 'Ресторатор видит только свой бизнес, свои рестораны и своих сотрудников. Кабинет платформы скрыт.';
  if (getActiveAccess(authInfo).length) return 'Сотрудник видит только назначенные точки. Управление платформой и чужими бизнесами скрыто.';
  return 'Пока доступ не выдан. В финальном режиме такой пользователь увидит экран запроса доступа.';
}


function shouldBlockDashboard(authInfo, settings) {
  if (!authInfo) return false;
  if (!isTelegramAccessMode(authInfo)) return false;
  return !hasAnyProductAccess(authInfo);
}

function NoAccessScreen({ authInfo }) {
  const user = authInfo?.user || {};
  return (
    <div className="screen-stack">
      <Section title="Доступ не выдан" subtitle="экран для пользователей без роли">
        <div className="event-row bad">
          <span>!</span>
          <div>
            <b>Этот аккаунт пока не привязан к ресторану</b>
            <p>{isTelegramAccessMode(authInfo) ? `Telegram: @${user.username || 'без username'} · ID ${user.id || '—'}` : 'Открой приложение из Telegram Mini App, чтобы система увидела аккаунт.'}</p>
          </div>
        </div>
        <p className="muted-line">Владелец бизнеса должен добавить сотрудника в разделе “Управление → Доступы”. Для тестов dev-режим в браузере не блокируется.</p>
      </Section>
    </div>
  );
}

function AccessGuardSettingsBlock({ settings, update, authInfo }) {
  const enabled = Boolean(settings.hardAccessProtection);
  const wouldBlock = shouldBlockDashboard(authInfo, { ...settings, hardAccessProtection: true });
  return (
    <Section title="Защита доступа" subtitle="финальный режим включается отдельно, после тестов">
      <div className={`event-row ${enabled ? 'warn' : 'good'}`}>
        <span>{enabled ? '!' : '✓'}</span>
        <div>
          <b>{enabled ? 'Жёсткая защита включена' : 'Жёсткая защита выключена'}</b>
          <p>{enabled ? 'Пользователь без роли увидит экран “Доступ не выдан”.' : 'Сейчас доступы работают мягко: роли видны, но рабочий MVP не блокируется.'}</p>
        </div>
      </div>
      <div className="control-row">
        <div>
          <b>Блокировать пользователей без доступа</b>
          <p>{wouldBlock ? 'Текущий Telegram-пользователь без доступа был бы заблокирован.' : 'Текущий пользователь проходит проверку или открыт dev-режим.'}</p>
        </div>
        <input type="checkbox" checked={enabled} onChange={(e) => update('hardAccessProtection', e.target.checked)} />
      </div>
      <p className="muted-line">Перед клиентским показом держим выключенным. Включать только после теста с отдельным аккаунтом без доступа.</p>
    </Section>
  );
}

function SoftAccessPolicyBlock({ authInfo }) {
  const activeAccess = getActiveAccess(authInfo);
  const businesses = getBusinessCabinetBusinesses(authInfo);
  const isPlatformOwner = isPlatformOwnerUser(authInfo);
  const isTelegram = isTelegramAccessMode(authInfo);
  const tone = !isTelegram ? 'warn' : isPlatformOwner || businesses.length || activeAccess.length ? 'good' : 'bad';

  return (
    <Section title="Схема доступа" subtitle="понятно, кто что видит в продукте">
      <div className={`event-row ${tone}`}>
        <span>{tone === 'bad' ? '!' : '✓'}</span>
        <div><b>{accessPolicyTitle(authInfo)}</b><p>{accessPolicyText(authInfo)}</p></div>
      </div>
      <div className="mini-grid">
        <div className="mini-card"><small>Бизнесы</small><b>{businesses.length}</b></div>
        <div className="mini-card"><small>Точки</small><b>{activeAccess.length}</b></div>
        <div className="mini-card"><small>Без доступа</small><b>закрыто</b></div>
      </div>
      <p className="muted-line">Сейчас это безопасный режим: роли уже определяются, но рабочий дашборд не закрывается без отдельного теста.</p>
    </Section>
  );
}

function getAccessModeTitle(authInfo) {
  if (!isTelegramAccessMode(authInfo)) return 'Режим разработчика';
  if (isPlatformOwnerUser(authInfo)) return 'Владелец платформы';
  const businesses = getBusinessCabinetBusinesses(authInfo);
  if (businesses.length) return 'Кабинет клиента';
  const activeAccess = getActiveAccess(authInfo);
  if (activeAccess.length) return 'Сотрудник ресторана';
  return 'Без активного доступа';
}

function AccessModeBlock({ authInfo }) {
  const user = authInfo?.user || {};
  const activeAccess = getActiveAccess(authInfo);
  const businesses = getBusinessCabinetBusinesses(authInfo);
  const platform = getPlatformInfo(authInfo);
  const roles = uniqueList([
    ...(isPlatformOwnerUser(authInfo) ? ['platform_owner'] : []),
    ...getBusinessCabinetUsers(authInfo).map((item) => item.role),
    ...activeAccess.map((item) => item.role)
  ]);

  return (
    <Section title="Кто сейчас в системе" subtitle="роль и видимость интерфейса">
      <div className="control-row">
        <div>
          <b>{getAccessModeTitle(authInfo)}</b>
          <p>{isTelegramAccessMode(authInfo) ? `@${user.username || 'telegram'} · ID ${user.id || '—'}` : 'Браузер без Telegram: открыт dev/admin-режим, дашборд не закрыт.'}</p>
        </div>
        <span>{authInfo?.mode || 'demo'}</span>
      </div>
      <div className="mini-grid">
        <div className="mini-card"><small>Бизнесы</small><b>{businesses.length}</b></div>
        <div className="mini-card"><small>Рестораны</small><b>{activeAccess.length}</b></div>
        <div className="mini-card"><small>Роли</small><b>{roles.length ? roles.map(businessRoleLabel).join(', ') : '—'}</b></div>
      </div>
      {platform?.note ? <p className="muted-line">{platform.note}</p> : null}
    </Section>
  );
}

function ClientBusinessCabinetBlock({ authInfo, openRestaurantDashboard }) {
  const businesses = getBusinessCabinetBusinesses(authInfo);
  const businessUsers = getBusinessCabinetUsers(authInfo);
  const activeAccess = getActiveAccess(authInfo);

  if (!isTelegramAccessMode(authInfo)) {
    return (
      <Section title="Кабинет клиента" subtitle="то, что видит ресторатор">
        <EmptyState title="В браузере кабинет клиента не привязывается" text="Открой Mini App из Telegram, чтобы увидеть бизнесы и роли конкретного пользователя." />
      </Section>
    );
  }

  if (!businesses.length) {
    return (
      <Section title="Кабинет клиента" subtitle="бизнесы текущего пользователя">
        <EmptyState title="Бизнесов пока нет" text="Если это владелец ресторана, сначала добавь его в кабинете платформы как business_owner." />
      </Section>
    );
  }

  return (
    <>
      <Section title="Кабинет клиента" subtitle="экран ресторатора: только его бизнесы">
        {businesses.map((business) => {
          const restaurants = Array.isArray(business.restaurants) ? business.restaurants : [];
          const users = businessUsers.filter((item) => item.business_id === business.id);
          const businessAccess = activeAccess.filter((item) => restaurants.map((restaurant) => restaurant.id).includes(item.restaurant_id));
          return (
            <div className="business-card" key={business.id}>
              <div className="business-card-head">
                <div>
                  <b>{business.name}</b>
                  <p>{business.city || 'Город'} · {subscriptionStatusLabel(business.subscription_status)} · {business.plan_name || 'pilot'}</p>
                </div>
                <span className={`status-pill ${subscriptionTone(business.subscription_status)}`}>{subscriptionStatusLabel(business.subscription_status)}</span>
              </div>
              <div className="mini-grid">
                <div className="mini-card"><small>Рестораны</small><b>{restaurants.length}</b></div>
                <div className="mini-card"><small>Команда</small><b>{users.length}</b></div>
                <div className="mini-card"><small>Доступы</small><b>{businessAccess.length}</b></div>
              </div>
              <p className="muted-line">Рестораны: {businessRestaurantsText(business)}</p>
              <p className="muted-line">Владелец: {business.owner_username ? `@${normalizeInputUsername(business.owner_username)}` : 'не назначен'}</p>
              {restaurants.length ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  {restaurants.map((restaurant) => (
                    <button key={`client-open-${business.id}-${restaurant.id}`} onClick={() => openRestaurantDashboard?.(restaurant.id, 'today')}>Открыть {restaurant.name || restaurant.id}</button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </Section>

      <BusinessTeamManager authInfo={authInfo} />

      <Section title="Права клиента" subtitle="что сможет делать ресторатор">
        <div className="event-row good"><span>✓</span><div><b>Видит свой бизнес</b><p>Не видит других клиентов платформы.</p></div></div>
        <div className="event-row good"><span>✓</span><div><b>Управляет своими ресторанами</b><p>Сможет добавлять сотрудников и выдавать роли внутри своего бизнеса.</p></div></div>
        <div className="event-row warn"><span>!</span><div><b>Жёсткая блокировка пока выключена</b><p>Сначала проверяем роли, потом закрываем дашборд от чужих пользователей.</p></div></div>
      </Section>
    </>
  );
}


function BusinessTeamManager({ authInfo }) {
  const businesses = getBusinessCabinetBusinesses(authInfo);
  const [selectedBusinessId, setSelectedBusinessId] = useState(businesses[0]?.id || '');
  const [data, setData] = useState({ members: [], invites: [], access: [], restaurants: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('viewer');
  const [restaurantIds, setRestaurantIds] = useState([]);
  const [sections, setSections] = useState(['today', 'reports', 'risks']);

  const selectedBusiness = businesses.find((item) => item.id === selectedBusinessId) || businesses[0] || null;
  const restaurants = Array.isArray(selectedBusiness?.restaurants) ? selectedBusiness.restaurants : [];
  const canManage = canManageBusinessEmployees(authInfo);

  useEffect(() => {
    if (!selectedBusinessId && businesses[0]?.id) setSelectedBusinessId(businesses[0].id);
  }, [businesses, selectedBusinessId]);

  useEffect(() => {
    if (selectedBusiness && !restaurantIds.length) setRestaurantIds(restaurants.map((item) => item.id));
  }, [selectedBusinessId]);

  useEffect(() => {
    if (selectedBusinessId && canManage) loadMembers();
  }, [selectedBusinessId, canManage]);

  function toggleRestaurantId(id) {
    setRestaurantIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleSection(id) {
    setSections((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function loadMembers() {
    if (!selectedBusinessId) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/business/members?business_id=${encodeURIComponent(selectedBusinessId)}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: telegramAuthHeaders()
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось загрузить сотрудников');
      setData(result);
    } catch (error) {
      setMessage(error.message || 'Ошибка загрузки сотрудников.');
    } finally {
      setLoading(false);
    }
  }

  async function addMember() {
    const normalized = normalizeInputUsername(username);
    if (!selectedBusinessId || !normalized) {
      setMessage('Выбери бизнес и введи Telegram username сотрудника.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/business/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...telegramAuthHeaders() },
        body: JSON.stringify({
          action: 'add_member',
          business_id: selectedBusinessId,
          username: normalized,
          role,
          restaurant_ids: restaurantIds,
          permissions: { sections, can_manage_employees: ['business_owner', 'business_admin'].includes(role) }
        })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось добавить сотрудника');
      setUsername('');
      setData(result);
      setMessage('Сотрудник добавлен. Если он ещё не заходил в Mini App, доступ активируется после первого входа.');
    } catch (error) {
      setMessage(error.message || 'Ошибка добавления сотрудника.');
    } finally {
      setLoading(false);
    }
  }

  async function removeMember(member) {
    if (!member?.id) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/business/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...telegramAuthHeaders() },
        body: JSON.stringify({ action: 'remove_member', business_id: member.business_id, member_id: member.id })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось удалить сотрудника');
      setData(result);
      setMessage('Сотрудник отключён от бизнеса и ресторанов этого бизнеса.');
    } catch (error) {
      setMessage(error.message || 'Ошибка удаления сотрудника.');
    } finally {
      setLoading(false);
    }
  }

  if (!businesses.length) return null;

  if (!canManage) {
    return (
      <Section title="Сотрудники" subtitle="управление командой">
        <EmptyState title="Недостаточно прав" text="Смотреть дашборд можно, но добавлять и удалять сотрудников может только владелец бизнеса или администратор бизнеса." />
      </Section>
    );
  }

  return (
    <Section title="Сотрудники бизнеса" subtitle="владелец сам выдаёт доступы и выбирает, что видит сотрудник">
      {businesses.length > 1 ? (
        <label>
          <span>Бизнес</span>
          <select value={selectedBusinessId} onChange={(e) => setSelectedBusinessId(e.target.value)}>
            {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
          </select>
        </label>
      ) : null}

      <div className="business-card">
        <div className="business-card-head">
          <div>
            <b>{selectedBusiness?.name || 'Бизнес'}</b>
            <p>{businessRestaurantsText(selectedBusiness)} · сотрудники видят только выбранные рестораны и разделы</p>
          </div>
          <span className="status-pill good">клиентский кабинет</span>
        </div>
        <label>
          <span>Telegram username сотрудника</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" />
        </label>
        <div className="control-row">
          <div><b>Роль</b><p>От роли зависит базовый набор прав</p></div>
          <select value={role} onChange={(e) => {
            const nextRole = e.target.value;
            setRole(nextRole);
            setSections(defaultSectionsForRole(nextRole));
          }}>
            <option value="business_admin">Администратор бизнеса</option>
            <option value="manager">Управляющий</option>
            <option value="accountant">Бухгалтер</option>
            <option value="viewer">Просмотр</option>
            <option value="employee">Сотрудник</option>
          </select>
        </div>

        <div className="checkbox-grid">
          {restaurants.map((restaurant) => (
            <label key={restaurant.id}><input type="checkbox" checked={restaurantIds.includes(restaurant.id)} onChange={() => toggleRestaurantId(restaurant.id)} /> {restaurant.name}</label>
          ))}
        </div>

        <div className="checkbox-grid">
          {SECTION_PERMISSION_OPTIONS.map((item) => (
            <label key={item.id}><input type="checkbox" checked={sections.includes(item.id)} onChange={() => toggleSection(item.id)} /> {item.label}</label>
          ))}
        </div>
        <button className="primary-btn" onClick={addMember} disabled={loading || !username.trim()}>{loading ? 'Сохраняю…' : 'Добавить / обновить сотрудника'}</button>
      </div>

      {message ? <p className="muted-line">{message}</p> : null}

      <div className="mini-grid">
        <div className="mini-card"><small>Активные</small><b>{(data.members || []).length}</b><p>в бизнесе</p></div>
        <div className="mini-card"><small>Ожидают входа</small><b>{(data.invites || []).length}</b><p>pending</p></div>
        <div className="mini-card"><small>Рестораны</small><b>{restaurants.length}</b><p>в этом бизнесе</p></div>
      </div>

      {(data.members || []).length ? data.members.map((member) => {
        const permissions = normalizePermissions(member.permissions, member.role);
        const memberRestaurants = Array.isArray(member.restaurant_ids) && member.restaurant_ids.length ? member.restaurant_ids : restaurants.map((item) => item.id);
        return (
          <div className="control-row" key={member.id}>
            <div>
              <b>{member.username || member.username_normalized || member.telegram_id}</b>
              <p>{businessRoleLabel(member.role)} · рестораны: {memberRestaurants.join(', ')} · разделы: {(permissions.sections || []).map(permissionLabel).join(', ')}</p>
            </div>
            <button onClick={() => removeMember(member)} disabled={loading}>Удалить</button>
          </div>
        );
      }) : <EmptyState title="Сотрудников пока нет" text="Добавь сотрудника по Telegram username. Если он ещё не входил, появится pending-доступ." />}
    </Section>
  );
}


function PlatformAdminBlock({ authInfo, openRestaurantDashboard }) {
  const [adminKey, setAdminKey] = useState('');
  const [data, setData] = useState({ businesses: [], restaurants: [], admins: [], payments: [], business_users: [], access: [], invites: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState('overview');
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [clientFilter, setClientFilter] = useState('all');

  const [newBusinessName, setNewBusinessName] = useState('');
  const [newBusinessCity, setNewBusinessCity] = useState('Тюмень');
  const [newOwnerUsername, setNewOwnerUsername] = useState('');
  const [newPlanName, setNewPlanName] = useState('pilot');
  const [newSubscriptionStatus, setNewSubscriptionStatus] = useState('trial');
  const [newBusinessStatus, setNewBusinessStatus] = useState('active');
  const [newBusinessNotes, setNewBusinessNotes] = useState('');
  const [selectedRestaurantIds, setSelectedRestaurantIds] = useState([]);

  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerRole, setOwnerRole] = useState('business_owner');
  const [ownerRestaurantIds, setOwnerRestaurantIds] = useState([]);

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [paymentPlan, setPaymentPlan] = useState('pilot');
  const [paymentNote, setPaymentNote] = useState('');

  const [quickSubStatus, setQuickSubStatus] = useState('active');
  const [quickBusinessStatus, setQuickBusinessStatus] = useState('active');

  const businesses = Array.isArray(data.businesses) ? data.businesses : [];
  const restaurants = Array.isArray(data.restaurants) ? data.restaurants : [];
  const admins = Array.isArray(data.admins) ? data.admins : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const businessUsers = Array.isArray(data.business_users) ? data.business_users : [];
  const access = Array.isArray(data.access) ? data.access : [];
  const invites = Array.isArray(data.invites) ? data.invites : [];
  const canLoadWithTelegram = isTelegramAccessMode(authInfo) && isPlatformOwnerUser(authInfo);
  const hasPlatformGate = canLoadWithTelegram || Boolean(adminKey.trim());

  const selectedBusiness = businesses.find((item) => item.id === selectedBusinessId) || businesses[0] || null;
  const selectedBusinessRestaurants = Array.isArray(selectedBusiness?.restaurants) ? selectedBusiness.restaurants : [];
  const selectedBusinessRestaurantIds = selectedBusinessRestaurants.map((item) => item.id);
  const selectedBusinessUsers = Array.isArray(selectedBusiness?.users) ? selectedBusiness.users : businessUsers.filter((item) => item.business_id === selectedBusiness?.id);
  const selectedBusinessPayments = Array.isArray(selectedBusiness?.payments) ? selectedBusiness.payments : payments.filter((item) => item.business_id === selectedBusiness?.id);
  const selectedBusinessAccess = access.filter((item) => selectedBusinessRestaurantIds.includes(item.restaurant_id));
  const selectedBusinessInvites = invites.filter((item) => selectedBusinessRestaurantIds.includes(item.restaurant_id));

  const activeBusinesses = businesses.filter((item) => item.status === 'active').length;
  const paidBusinesses = businesses.filter((item) => item.subscription_status === 'active').length;
  const trialBusinesses = businesses.filter((item) => item.subscription_status === 'trial').length;
  const overdueBusinesses = businesses.filter((item) => item.subscription_status === 'overdue').length;
  const totalPaid = businesses.reduce((total, item) => total + Number(item.paid_total || 0), 0);
  const pendingTotal = businesses.reduce((total, item) => total + Number(item.pending_total || 0), 0);

  const filteredBusinesses = businesses.filter((business) => {
    if (clientFilter === 'all') return true;
    if (clientFilter === 'paid') return business.subscription_status === 'active';
    if (clientFilter === 'trial') return business.subscription_status === 'trial';
    if (clientFilter === 'overdue') return business.subscription_status === 'overdue';
    if (clientFilter === 'paused') return business.status !== 'active';
    return true;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(ACCESS_ADMIN_STORAGE_KEY) || '';
    if (stored) setAdminKey(stored);
  }, []);

  useEffect(() => {
    if (!selectedBusinessId && businesses[0]?.id) setSelectedBusinessId(businesses[0].id);
  }, [businesses, selectedBusinessId]);

  useEffect(() => {
    if (selectedBusiness && !ownerRestaurantIds.length) {
      setOwnerRestaurantIds(selectedBusinessRestaurantIds);
    }
    if (selectedBusiness) {
      setQuickSubStatus(selectedBusiness.subscription_status || 'trial');
      setQuickBusinessStatus(selectedBusiness.status || 'active');
      setPaymentPlan(selectedBusiness.plan_name || 'pilot');
      if (!ownerUsername && selectedBusiness.owner_username) setOwnerUsername(selectedBusiness.owner_username);
    }
  }, [selectedBusinessId, businesses.length]);

  function saveAdminKey(nextKey) {
    setAdminKey(nextKey);
    if (typeof window !== 'undefined') localStorage.setItem(ACCESS_ADMIN_STORAGE_KEY, nextKey);
  }

  async function callPlatform(payload = {}, successText = 'Готово') {
    if (!hasPlatformGate) {
      setMessage('Открой Mini App как владелец платформы или вставь ACCESS_ADMIN_KEY.');
      return null;
    }
    setLoading(true);
    setMessage('');
    try {
      const body = canLoadWithTelegram ? payload : { admin_key: adminKey.trim(), ...payload };
      const response = await fetch('/api/platform/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...telegramAuthHeaders() },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось выполнить действие');
      setData(result);
      setMessage(successText);
      return result;
    } catch (error) {
      setMessage(error.message || 'Ошибка кабинета платформы.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadPlatform() {
    if (!hasPlatformGate) {
      setMessage('Открой Mini App как владелец платформы или вставь ACCESS_ADMIN_KEY.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const url = canLoadWithTelegram
        ? `/api/platform/businesses?t=${Date.now()}`
        : `/api/platform/businesses?admin_key=${encodeURIComponent(adminKey.trim())}&t=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-store', headers: telegramAuthHeaders() });
      const next = await response.json();
      if (!next.ok) throw new Error(next.error || 'Не удалось загрузить кабинет платформы');
      setData(next);
      setMessage(canLoadWithTelegram ? 'Кабинет платформы загружен по Telegram-роли.' : 'Кабинет платформы загружен.');
    } catch (error) {
      setMessage(error.message || 'Ошибка загрузки кабинета платформы.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canLoadWithTelegram && !businesses.length && !loading) {
      loadPlatform();
    }
  }, [canLoadWithTelegram]);

  function toggleRestaurant(restaurantId, setter = setSelectedRestaurantIds) {
    setter((current) => current.includes(restaurantId)
      ? current.filter((item) => item !== restaurantId)
      : [...current, restaurantId]);
  }

  async function addBusiness() {
    const name = newBusinessName.trim();
    if (!name) {
      setMessage('Введи название бизнеса клиента.');
      return;
    }
    const result = await callPlatform({
      action: 'upsert_business',
      name,
      city: newBusinessCity.trim() || 'Тюмень',
      owner_username: normalizeInputUsername(newOwnerUsername),
      plan_name: newPlanName.trim() || 'pilot',
      status: newBusinessStatus,
      subscription_status: newSubscriptionStatus,
      notes: newBusinessNotes.trim(),
      restaurant_ids: selectedRestaurantIds
    }, 'Бизнес добавлен или обновлён.');
    if (result?.business?.id) {
      setNewBusinessName('');
      setNewOwnerUsername('');
      setNewBusinessNotes('');
      setSelectedRestaurantIds([]);
      setSelectedBusinessId(result.business.id);
      setTab('business');
    }
  }

  async function updateSelectedBusiness() {
    if (!selectedBusiness) return;
    await callPlatform({
      action: 'update_business',
      id: selectedBusiness.id,
      name: selectedBusiness.name,
      city: selectedBusiness.city || 'Тюмень',
      owner_username: selectedBusiness.owner_username,
      owner_telegram_id: selectedBusiness.owner_telegram_id,
      plan_name: selectedBusiness.plan_name || 'pilot',
      status: quickBusinessStatus,
      subscription_status: quickSubStatus,
      notes: selectedBusiness.notes || '',
      restaurant_ids: selectedBusinessRestaurantIds
    }, 'Статусы бизнеса обновлены.');
  }

  async function saveBusinessRestaurants() {
    if (!selectedBusiness) return;
    await callPlatform({
      action: 'link_restaurants',
      business_id: selectedBusiness.id,
      restaurant_ids: selectedRestaurantIds.length ? selectedRestaurantIds : selectedBusinessRestaurantIds
    }, 'Рестораны бизнеса обновлены.');
  }

  async function addOwnerOrUser() {
    if (!selectedBusiness) return;
    const username = normalizeInputUsername(ownerUsername);
    if (!username) {
      setMessage('Введи Telegram username владельца или сотрудника.');
      return;
    }
    await callPlatform({
      action: ownerRole === 'business_owner' ? 'assign_owner' : 'add_business_user',
      business_id: selectedBusiness.id,
      username,
      business_role: ownerRole,
      restaurant_role: ownerRole === 'business_owner' ? 'owner' : ownerRole === 'business_admin' ? 'admin' : ownerRole === 'accountant' ? 'viewer' : 'viewer',
      restaurant_ids: ownerRestaurantIds.length ? ownerRestaurantIds : selectedBusinessRestaurantIds
    }, 'Пользователь добавлен. После входа в Telegram Mini App доступ станет активным.');
  }

  async function addPayment() {
    if (!selectedBusiness) return;
    const amount = Number(paymentAmount || 0);
    if (!amount) {
      setMessage('Введи сумму платежа.');
      return;
    }
    const result = await callPlatform({
      action: 'add_payment',
      business_id: selectedBusiness.id,
      amount,
      currency: 'RUB',
      status: paymentStatus,
      plan_name: paymentPlan,
      notes: paymentNote.trim()
    }, 'Платёж добавлен в кабинет платформы.');
    if (result?.ok) {
      setPaymentAmount('');
      setPaymentNote('');
      setTab('subscriptions');
    }
  }

  function openBusiness(business) {
    setSelectedBusinessId(business.id);
    setSelectedRestaurantIds((business.restaurants || []).map((item) => item.id));
    setOwnerRestaurantIds((business.restaurants || []).map((item) => item.id));
    setOwnerUsername(business.owner_username || '');
    setTab('business');
  }

  return (
    <Section title="Кабинет платформы" subtitle="внутренний экран КЛИК: клиенты, рестораны, подписки, владельцы и платежи">
      {canLoadWithTelegram ? (
        <div className="control-row">
          <div><b>Доступ владельца платформы активен</b><p>Кабинет загружается по Telegram ID, ключ в интерфейсе не нужен.</p></div>
          <span>@{authInfo?.user?.username || 'telegram'}</span>
        </div>
      ) : (
        <label>
          <span>Админ-ключ платформы</span>
          <input type="password" value={adminKey} onChange={(e) => saveAdminKey(e.target.value)} placeholder="ACCESS_ADMIN_KEY из Vercel" />
        </label>
      )}
      <button className="primary-btn" onClick={loadPlatform} disabled={loading || !hasPlatformGate}>{loading ? 'Загружаю…' : 'Загрузить кабинет платформы'}</button>
      {message ? <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: 13 }}>{message}</p> : null}

      <div className="mini-grid" style={{ marginTop: 16 }}>
        <div className="mini-card"><small>Клиенты</small><b>{businesses.length}</b><p>{activeBusinesses} активных</p></div>
        <div className="mini-card"><small>Оплачено</small><b>{paidBusinesses}</b><p>{trialBusinesses} trial · {overdueBusinesses} просрочено</p></div>
        <div className="mini-card"><small>Платежи</small><b>{money(totalPaid)}</b><p>{pendingTotal ? `${money(pendingTotal)} ожидается` : 'долгов не видно'}</p></div>
      </div>

      <div className="period-switch" style={{ marginTop: 16 }}>
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Обзор</button>
        <button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')}>Клиенты</button>
        <button className={tab === 'business' ? 'active' : ''} onClick={() => setTab('business')}>Бизнес</button>
        <button className={tab === 'restaurants' ? 'active' : ''} onClick={() => setTab('restaurants')}>Рестораны</button>
        <button className={tab === 'subscriptions' ? 'active' : ''} onClick={() => setTab('subscriptions')}>Подписки</button>
        <button className={tab === 'owners' ? 'active' : ''} onClick={() => setTab('owners')}>Владельцы</button>
      </div>

      {tab === 'overview' ? (
        <div style={{ marginTop: 14 }}>
          <div className="event-row neutral">
            <span>🏦</span>
            <div>
              <b>КЛИК работает как платформа</b>
              <p>Ты видишь все бизнесы. Ресторатор видит только свой бизнес. Сотрудник видит только назначенные точки.</p>
            </div>
          </div>
          <div className="mini-grid" style={{ marginTop: 12 }}>
            <div className="mini-card"><small>Все рестораны</small><b>{restaurants.length}</b><p>в базе платформы</p></div>
            <div className="mini-card"><small>Активные доступы</small><b>{access.length}</b><p>{invites.length} ожидают входа</p></div>
            <div className="mini-card"><small>Админы платформы</small><b>{admins.length}</b><p>внутренний доступ</p></div>
          </div>
          {selectedBusiness ? (
            <div className="control-row" style={{ marginTop: 14 }}>
              <div>
                <b>{selectedBusiness.name}</b>
                <p>{subscriptionStatusLabel(selectedBusiness.subscription_status)} · тариф {selectedBusiness.plan_name || 'pilot'} · {selectedBusiness.restaurants_count || 0} точек</p>
              </div>
              <button onClick={() => openBusiness(selectedBusiness)}>Открыть бизнес</button>
            </div>
          ) : <EmptyState title="Платформа пока не загружена" text="Нажми “Загрузить кабинет платформы”" />}
        </div>
      ) : null}

      {tab === 'clients' ? (
        <div style={{ marginTop: 14 }}>
          <div className="period-switch" style={{ marginBottom: 12 }}>
            <button className={clientFilter === 'all' ? 'active' : ''} onClick={() => setClientFilter('all')}>Все</button>
            <button className={clientFilter === 'paid' ? 'active' : ''} onClick={() => setClientFilter('paid')}>Оплачено</button>
            <button className={clientFilter === 'trial' ? 'active' : ''} onClick={() => setClientFilter('trial')}>Trial</button>
            <button className={clientFilter === 'overdue' ? 'active' : ''} onClick={() => setClientFilter('overdue')}>Просрочено</button>
          </div>
          {filteredBusinesses.length ? filteredBusinesses.map((business) => (
            <div className="control-row" key={business.id}>
              <div>
                <b>{business.name}</b>
                <p>{business.city || 'Город'} · {business.restaurants_count || 0} точек · @{business.owner_username || 'нет владельца'}</p>
                <p>{subscriptionStatusLabel(business.subscription_status)} · тариф {business.plan_name || 'pilot'} · платежи {money(business.paid_total || 0)}</p>
              </div>
              <button onClick={() => openBusiness(business)}>Открыть</button>
            </div>
          )) : <EmptyState title="Клиентов пока нет" text="Загрузи кабинет или добавь новый бизнес." />}
        </div>
      ) : null}

      {tab === 'business' ? (
        <div style={{ marginTop: 14 }}>
          {selectedBusiness ? (
            <>
              <div className="event-row good">
                <span>↳</span>
                <div>
                  <b>{selectedBusiness.name}</b>
                  <p>Статус бизнеса: {platformStatusLabel(selectedBusiness.status)} · подписка: {subscriptionStatusLabel(selectedBusiness.subscription_status)} · тариф: {selectedBusiness.plan_name || 'pilot'}</p>
                  <p>Владелец: @{selectedBusiness.owner_username || 'не назначен'} · Рестораны: {businessRestaurantsText(selectedBusiness)}</p>
                  {selectedBusiness.notes ? <p>{selectedBusiness.notes}</p> : null}
                </div>
              </div>

              <div className="mini-grid" style={{ marginTop: 12 }}>
                <div className="mini-card"><small>Точки</small><b>{selectedBusiness.restaurants_count || 0}</b><p>{businessRestaurantsText(selectedBusiness)}</p></div>
                <div className="mini-card"><small>Команда</small><b>{selectedBusiness.access_count || 0}</b><p>{selectedBusiness.invites_count || 0} ожидают входа</p></div>
                <div className="mini-card"><small>Платежи</small><b>{money(selectedBusiness.paid_total || 0)}</b><p>{selectedBusiness.pending_total ? `${money(selectedBusiness.pending_total)} ожидается` : 'нет долга'}</p></div>
              </div>

              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin: '0 0 10px' }}>Быстро изменить статус</h3>
                <div className="control-row"><div><b>Подписка</b><p>для контроля оплаты клиента</p></div><select value={quickSubStatus} onChange={(e) => setQuickSubStatus(e.target.value)}><option value="trial">trial</option><option value="active">оплачено</option><option value="overdue">просрочено</option><option value="cancelled">отключено</option></select></div>
                <div className="control-row"><div><b>Статус бизнеса</b><p>можно поставить на паузу</p></div><select value={quickBusinessStatus} onChange={(e) => setQuickBusinessStatus(e.target.value)}><option value="active">активен</option><option value="paused">пауза</option><option value="archived">архив</option></select></div>
                <button className="primary-btn" onClick={updateSelectedBusiness} disabled={loading}>Сохранить статусы</button>
              </div>

              <div style={{ marginTop: 18 }}>
                <h3 style={{ margin: '0 0 10px' }}>Назначить владельца / пользователя бизнеса</h3>
                <label><span>Telegram username</span><input value={ownerUsername} onChange={(e) => setOwnerUsername(e.target.value)} placeholder="@client_owner" /></label>
                <div className="control-row"><div><b>Роль в бизнесе</b><p>владелец бизнеса или сотрудник</p></div><select value={ownerRole} onChange={(e) => setOwnerRole(e.target.value)}><option value="business_owner">владелец бизнеса</option><option value="business_admin">администратор бизнеса</option><option value="accountant">бухгалтер / финансы</option><option value="viewer">только просмотр</option></select></div>
                {selectedBusinessRestaurants.length ? <div style={{ margin: '10px 0' }}><span style={{ color: 'var(--muted)', fontSize: 13 }}>Дать доступ к ресторанам</span>{selectedBusinessRestaurants.map((restaurant) => (
                  <div className="control-row" key={`owner-pick-${restaurant.id}`}><div><b>{restaurant.name || restaurant.id}</b><p>{restaurant.city || 'Город'} · id: {restaurant.id}</p></div><input type="checkbox" checked={ownerRestaurantIds.includes(restaurant.id)} onChange={() => toggleRestaurant(restaurant.id, setOwnerRestaurantIds)} /></div>
                ))}</div> : null}
                <button className="primary-btn" onClick={addOwnerOrUser} disabled={loading}>Добавить в бизнес и выдать доступ</button>
              </div>

              <div style={{ marginTop: 18 }}>
                <h3 style={{ margin: '0 0 10px' }}>Добавить платёж / оплату</h3>
                <label><span>Сумма</span><input value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="14900" inputMode="numeric" /></label>
                <div className="control-row"><div><b>Статус платежа</b><p>для вкладки подписок</p></div><select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}><option value="paid">оплачено</option><option value="pending">ожидается</option><option value="overdue">просрочено</option><option value="cancelled">отменено</option><option value="refunded">возврат</option></select></div>
                <div className="control-row"><div><b>Тариф</b><p>за что платёж</p></div><select value={paymentPlan} onChange={(e) => setPaymentPlan(e.target.value)}><option value="pilot">pilot</option><option value="basic">basic</option><option value="standard">standard</option><option value="network">network</option></select></div>
                <label><span>Заметка</span><textarea value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Например: оплата за июль" rows={2} /></label>
                <button className="primary-btn" onClick={addPayment} disabled={loading}>Добавить платёж</button>
              </div>
            </>
          ) : <EmptyState title="Бизнес не выбран" text="Открой клиента во вкладке Клиенты." />}
        </div>
      ) : null}

      {tab === 'restaurants' ? (
        <div style={{ marginTop: 14 }}>
          {businesses.length ? businesses.map((business) => (
            <div key={business.id} style={{ marginBottom: 12 }}>
              <h3 style={{ margin: '0 0 8px' }}>{business.name}</h3>
              {(business.restaurants || []).length ? business.restaurants.map((restaurant) => (
                <div className="control-row" key={`${business.id}-${restaurant.id}`}>
                  <div><b>{restaurant.name || restaurant.id}</b><p>{restaurant.city || business.city || 'Город'} · id: {restaurant.id}</p></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button onClick={() => openBusiness(business)}>Открыть бизнес</button>
                    <button onClick={() => openRestaurantDashboard?.(restaurant.id, 'today')}>Дашборд</button>
                  </div>
                </div>
              )) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>Рестораны ещё не привязаны.</p>}
            </div>
          )) : <EmptyState title="Рестораны не загружены" text="Сначала загрузи кабинет платформы." />}
        </div>
      ) : null}

      {tab === 'subscriptions' ? (
        <div style={{ marginTop: 14 }}>
          {businesses.length ? businesses.map((business) => (
            <div className={`event-row ${subscriptionTone(business.subscription_status)}`} key={business.id}>
              <span>{business.subscription_status === 'active' ? '✓' : business.subscription_status === 'overdue' ? '!' : '•'}</span>
              <div>
                <b>{business.name}</b>
                <p>{subscriptionStatusLabel(business.subscription_status)} · тариф {business.plan_name || 'pilot'} · оплачено {money(business.paid_total || 0)} · ожидается {money(business.pending_total || 0)}</p>
                {(business.payments || []).slice(0, 3).map((payment) => <p key={payment.id || `${business.id}-${payment.created_at}`}>Платёж: {money(payment.amount)} · {payment.status} · {payment.notes || payment.plan_name || 'без заметки'}</p>)}
              </div>
            </div>
          )) : <EmptyState title="Подписки не загружены" text="Сначала загрузи кабинет платформы." />}
        </div>
      ) : null}

      {tab === 'owners' ? (
        <div style={{ marginTop: 14 }}>
          {admins.length ? admins.map((admin) => (
            <div className="control-row" key={admin.telegram_id}>
              <div><b>@{admin.username || admin.telegram_id}</b><p>{admin.role} · {admin.status}</p></div>
              <span>платформа</span>
            </div>
          )) : null}
          {businesses.length ? businesses.map((business) => (
            <div className="control-row" key={`owner-${business.id}`}>
              <div><b>@{business.owner_username || 'нет владельца'}</b><p>{business.name} · владелец бизнеса · {business.access_count || 0} активных доступов</p></div>
              <button onClick={() => openBusiness(business)}>Открыть</button>
            </div>
          )) : <EmptyState title="Владельцы не загружены" text="Сначала загрузи кабинет платформы." />}
          {businessUsers.length ? businessUsers.map((user) => (
            <div className="control-row" key={user.id || `${user.business_id}-${user.username_normalized}`}>
              <div><b>@{user.username_normalized || user.username || 'user'}</b><p>{user.business_id} · {user.role} · {user.status}</p></div>
              <span>{user.telegram_id ? 'telegram_id есть' : 'ждёт входа'}</span>
            </div>
          )) : null}
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <h3 style={{ margin: '0 0 10px' }}>Добавить новый бизнес</h3>
        <label><span>Название бизнеса</span><input value={newBusinessName} onChange={(e) => setNewBusinessName(e.target.value)} placeholder="Например: Новый ресторан / сеть" /></label>
        <label><span>Город</span><input value={newBusinessCity} onChange={(e) => setNewBusinessCity(e.target.value)} placeholder="Тюмень" /></label>
        <label><span>Владелец Telegram</span><input value={newOwnerUsername} onChange={(e) => setNewOwnerUsername(e.target.value)} placeholder="@client_owner" /></label>
        <div className="control-row"><div><b>Тариф</b><p>для внутреннего контроля оплаты</p></div><select value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)}><option value="pilot">pilot</option><option value="basic">basic</option><option value="standard">standard</option><option value="network">network</option></select></div>
        <div className="control-row"><div><b>Подписка</b><p>trial, оплачено или просрочено</p></div><select value={newSubscriptionStatus} onChange={(e) => setNewSubscriptionStatus(e.target.value)}><option value="trial">trial</option><option value="active">оплачено</option><option value="overdue">просрочено</option><option value="cancelled">отключено</option></select></div>
        <div className="control-row"><div><b>Статус бизнеса</b><p>можно поставить на паузу</p></div><select value={newBusinessStatus} onChange={(e) => setNewBusinessStatus(e.target.value)}><option value="active">активен</option><option value="paused">пауза</option><option value="archived">архив</option></select></div>
        {restaurants.length ? <div style={{ margin: '10px 0' }}><span style={{ color: 'var(--muted)', fontSize: 13 }}>Привязать существующие рестораны</span>{restaurants.map((restaurant) => (
          <div className="control-row" key={`pick-${restaurant.id}`}><div><b>{restaurant.name || restaurant.id}</b><p>{restaurant.city || 'Город'} · id: {restaurant.id}</p></div><input type="checkbox" checked={selectedRestaurantIds.includes(restaurant.id)} onChange={() => toggleRestaurant(restaurant.id)} /></div>
        ))}</div> : null}
        <label><span>Заметка</span><textarea value={newBusinessNotes} onChange={(e) => setNewBusinessNotes(e.target.value)} placeholder="Например: оплатил пилот, iiko подключить позже" rows={3} /></label>
        <button className="primary-btn" onClick={addBusiness} disabled={loading || !hasPlatformGate}>Добавить бизнес</button>
      </div>
    </Section>
  );
}

function AccessAdminBlock({ summary, authInfo }) {
  const [adminKey, setAdminKey] = useState('');
  const [data, setData] = useState({ access: [], invites: [], restaurants: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('manager');
  const [newRestaurantName, setNewRestaurantName] = useState('');
  const [newRestaurantId, setNewRestaurantId] = useState('');
  const [newRestaurantCity, setNewRestaurantCity] = useState('Тюмень');

  const restaurants = (data.restaurants && data.restaurants.length ? data.restaurants : (summary?.network?.restaurants || []));
  const selectedRestaurant = restaurants.find((item) => item.id === restaurantId) || restaurants[0];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(ACCESS_ADMIN_STORAGE_KEY) || '';
    if (stored) setAdminKey(stored);
  }, []);

  useEffect(() => {
    if (!restaurantId && restaurants[0]?.id) setRestaurantId(restaurants[0].id);
  }, [restaurants, restaurantId]);

  function saveAdminKey(nextKey) {
    setAdminKey(nextKey);
    if (typeof window !== 'undefined') localStorage.setItem(ACCESS_ADMIN_STORAGE_KEY, nextKey);
  }

  async function loadAccess() {
    if (!adminKey.trim()) {
      setMessage('Вставь ACCESS_ADMIN_KEY из Vercel, чтобы открыть управление доступами.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/access/team?admin_key=${encodeURIComponent(adminKey.trim())}&t=${Date.now()}`, { cache: 'no-store' });
      const next = await response.json();
      if (!next.ok) throw new Error(next.error || 'Не удалось загрузить доступы');
      setData(next);
      setMessage('Доступы загружены.');
    } catch (error) {
      setMessage(error.message || 'Ошибка загрузки доступов.');
    } finally {
      setLoading(false);
    }
  }

  async function addMember() {
    const cleanUsername = normalizeInputUsername(username);
    if (!restaurantId || !cleanUsername) {
      setMessage('Выбери ресторан и введи Telegram username сотрудника.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/access/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: adminKey.trim(), restaurant_id: restaurantId, username: cleanUsername, role })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось добавить сотрудника');
      setUsername('');
      setMessage(result.message || `@${cleanUsername} добавлен в ожидание первого входа.`);
      await loadAccess();
    } catch (error) {
      setMessage(error.message || 'Ошибка добавления сотрудника.');
    } finally {
      setLoading(false);
    }
  }

  async function removeMember(item, type = 'access') {
    if (!adminKey.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      const payload = type === 'invite'
        ? { admin_key: adminKey.trim(), invite_id: item.id }
        : { admin_key: adminKey.trim(), id: item.id };
      const response = await fetch('/api/access/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось удалить доступ');
      setMessage('Доступ удалён.');
      await loadAccess();
    } catch (error) {
      setMessage(error.message || 'Ошибка удаления доступа.');
    } finally {
      setLoading(false);
    }
  }

  async function addRestaurant() {
    const name = newRestaurantName.trim();
    if (!name) {
      setMessage('Введи название ресторана.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/access/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_key: adminKey.trim(), id: newRestaurantId.trim(), name, city: newRestaurantCity.trim() || 'Город', is_active: true })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || 'Не удалось добавить ресторан');
      setNewRestaurantName('');
      setNewRestaurantId('');
      setMessage('Ресторан добавлен в справочник. Данные появятся после подключения iiko/n8n/Supabase.');
      await loadAccess();
    } catch (error) {
      setMessage(error.message || 'Ошибка добавления ресторана.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Section title="Управление доступами" subtitle="сотрудники, приглашения и рестораны">
        <label>
          <span>Админ-ключ</span>
          <input type="password" value={adminKey} onChange={(e) => saveAdminKey(e.target.value)} placeholder="ACCESS_ADMIN_KEY из Vercel" />
        </label>
        <button className="primary-btn" onClick={loadAccess} disabled={loading}>{loading ? 'Загружаю…' : 'Загрузить доступы'}</button>
        {message ? <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: 13 }}>{message}</p> : null}
        <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 12, lineHeight: 1.4 }}>
          Текущий дашборд пока не закрыт доступами. Это безопасный режим: сначала настраиваем кабинет, потом включаем ограничение просмотра.
        </p>
      </Section>

      <Section title="Мой доступ" subtitle="что видит текущий Telegram-аккаунт">
        {authInfo?.mode === 'telegram' ? (
          <>
            <div className="control-row"><div><b>@{authInfo?.user?.username || 'без username'}</b><p>Telegram ID: {authInfo?.user?.id || '—'}</p></div><span>{authInfo?.access?.length ? 'активен' : 'нет активного доступа'}</span></div>
            {(authInfo?.acceptedInvites || []).length ? <p style={{ margin: '10px 0 0', color: 'var(--ok)', fontSize: 13 }}>Приглашение принято, доступ активирован.</p> : null}
            {(authInfo?.access || []).length ? authInfo.access.map((item) => (
              <div className="control-row" key={item.id || `${item.restaurant_id}-${item.role}`}>
                <div><b>{item.restaurant?.name || item.restaurant_id}</b><p>{roleLabel(item.role)} · доступ активен</p></div>
                <span>{item.status || 'active'}</span>
              </div>
            )) : <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: 13 }}>Если username есть в приглашениях, открой Mini App из Telegram, и доступ привяжется автоматически.</p>}
          </>
        ) : (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>В браузере доступ не привязывается. Для активации сотрудник должен открыть Mini App из Telegram.</p>
        )}
      </Section>

      <Section title="Добавить сотрудника" subtitle="внешне через @username, технически позже привяжем telegram_id">
        <label>
          <span>Ресторан</span>
          <select value={restaurantId || selectedRestaurant?.id || ''} onChange={(e) => setRestaurantId(e.target.value)}>
            {restaurants.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
          </select>
        </label>
        <label>
          <span>Telegram username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@manager" />
        </label>
        <label>
          <span>Роль</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="owner">Владелец</option>
            <option value="admin">Администратор</option>
            <option value="manager">Управляющий</option>
            <option value="viewer">Только просмотр</option>
          </select>
        </label>
        <button className="primary-btn" onClick={addMember} disabled={loading || !adminKey.trim()}>Добавить сотрудника</button>
      </Section>

      <Section title="Сотрудники" subtitle="активные доступы и ожидающие приглашения">
        {(data.access || []).length ? data.access.map((item) => (
          <div className="control-row" key={item.id}>
            <div>
              <b>{item.username ? `@${item.username}` : item.telegram_id || 'Сотрудник'}</b>
              <p>{roleLabel(item.role)} · {restaurants.find((restaurant) => restaurant.id === item.restaurant_id)?.name || item.restaurant_id}</p>
            </div>
            <button onClick={() => removeMember(item, 'access')} disabled={loading}>Удалить</button>
          </div>
        )) : <EmptyState title="Активных сотрудников пока нет" text="Добавь сотрудника по Telegram username. После первого входа его доступ можно будет привязать к telegram_id." />}

        {(data.invites || []).length ? <h3 style={{ margin: '16px 0 10px' }}>Ожидают входа</h3> : null}
        {(data.invites || []).map((item) => (
          <div className="control-row" key={item.id}>
            <div>
              <b>{item.username || `@${item.username_normalized}`}</b>
              <p>{roleLabel(item.role)} · {restaurants.find((restaurant) => restaurant.id === item.restaurant_id)?.name || item.restaurant_id}</p>
            </div>
            <button onClick={() => removeMember(item, 'invite')} disabled={loading}>Отменить</button>
          </div>
        ))}
      </Section>

      <Section title="Рестораны" subtitle="справочник точек внутри продукта">
        {(restaurants || []).map((item) => (
          <div className="control-row" key={item.id}>
            <div>
              <b>{item.name || item.id}</b>
              <p>{item.city || 'Город'} · id: {item.id}</p>
            </div>
            <span>{item.is_active === false ? 'выкл.' : 'активен'}</span>
          </div>
        ))}
        <label>
          <span>Название нового ресторана</span>
          <input value={newRestaurantName} onChange={(e) => setNewRestaurantName(e.target.value)} placeholder="Например: Новый ресторан" />
        </label>
        <label>
          <span>ID ресторана, можно оставить пустым</span>
          <input value={newRestaurantId} onChange={(e) => setNewRestaurantId(e.target.value)} placeholder="new_restaurant" />
        </label>
        <label>
          <span>Город</span>
          <input value={newRestaurantCity} onChange={(e) => setNewRestaurantCity(e.target.value)} placeholder="Тюмень" />
        </label>
        <button className="primary-btn" onClick={addRestaurant} disabled={loading || !adminKey.trim()}>Добавить ресторан</button>
      </Section>
    </>
  );
}

function ControlScreen({ settings, setSettings, summary, reload, authInfo }) {
  const [saved, setSaved] = useState(false);

  function update(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 900);
  }

  function updateVisible(key, value) {
    const next = { ...settings, visible: { ...settings.visible, [key]: value } };
    setSettings(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 900);
  }

  return (
    <div className="screen-stack control-screen">
      <Section title="Управление" subtitle={saved ? 'изменения сразу применены' : 'редактирование интерфейса и целей'}>
        <label><span>План выручки на день</span><input type="number" value={settings.planDay} onChange={(e) => update('planDay', Number(e.target.value))} /></label>
        <label><span>План выручки на неделю</span><input type="number" value={settings.planWeek} onChange={(e) => update('planWeek', Number(e.target.value))} /></label>
        <label><span>План выручки на месяц</span><input type="number" value={settings.planMonth} onChange={(e) => update('planMonth', Number(e.target.value))} /></label>
        <label><span>Цель среднего чека</span><input type="number" value={settings.avgCheckTarget} onChange={(e) => update('avgCheckTarget', Number(e.target.value))} /></label>
        <label><span>Цель среднего чека гостя</span><input type="number" value={settings.avgGuestTarget} onChange={(e) => update('avgGuestTarget', Number(e.target.value))} /></label>
        <label><span>Лимит скидок</span><input type="number" value={settings.discountLimit} onChange={(e) => update('discountLimit', Number(e.target.value))} /></label>
      </Section>

      <Section title="Внешний вид" subtitle="клиентский режим без технички">
        <div className="control-row"><div><b>Тема</b><p>Светлая основная или тёмная классическая</p></div><select value={settings.theme} onChange={(e) => update('theme', e.target.value)}><option value="light">Светлая основная</option><option value="dark">Тёмная классическая</option></select></div>
        <div className="control-row"><div><b>Акцент</b><p>Золото или синий</p></div><select value={settings.accent} onChange={(e) => update('accent', e.target.value)}><option value="gold">Золото</option><option value="blue">Синий</option></select></div>
        <div className="control-row"><div><b>Фудкост</b><p>Включать только после себестоимости iiko</p></div><input type="checkbox" checked={settings.showFoodcostCard} onChange={(e) => update('showFoodcostCard', e.target.checked)} /></div>
        <div className="control-row"><div><b>Автообновление</b><p>Обновлять каждые 30 секунд</p></div><input type="checkbox" checked={settings.autoRefresh} onChange={(e) => update('autoRefresh', e.target.checked)} /></div>
      </Section>

      <Section title="Состояние продукта" subtitle="что уже готово в рабочей версии">
        <div className="event-row good">
          <span>✓</span>
          <div>
            <b>Основная аналитика не тронута</b>
            <p>Выручка, чеки, гости, средний чек, точки, каналы, скидки, фудкост, блюда, категории и почасовка остаются на реальных данных из iiko/Supabase.</p>
          </div>
        </div>
        <div className="mini-grid">
          <div className="mini-card"><small>Доступы</small><b>готовы</b><p>роли и кабинеты разделены</p></div>
          <div className="mini-card"><small>Без доступа</small><b>закрыто</b><p>Telegram без роли не видит дашборд</p></div>
          <div className="mini-card"><small>Данные</small><b>не трогали</b><p>iiko/n8n/Supabase без изменений</p></div>
        </div>
      </Section>



      <Section title="Защита данных API" subtitle="Stage 17: статистика и AI проверяют Telegram-доступ">
        <div className="event-row good">
          <span>⛨</span>
          <div>
            <b>/api/summary и /api/ai-chat закрыты для Telegram без доступа</b>
            <p>Обычный пользователь в Mini App не сможет получить статистику или AI-ответы по ресторану. Браузерный dev-режим пока открыт, чтобы не запереть рабочий MVP.</p>
          </div>
        </div>
        <div className="mini-grid">
          <div className="mini-card"><small>Mini App</small><b>защищён</b><p>проверка по Telegram initData</p></div>
          <div className="mini-card"><small>Рестораны</small><b>по доступу</b><p>чужой restaurant_id не отдаётся</p></div>
          <div className="mini-card"><small>AI</small><b>по роли</b><p>раздел Lumora AI проверяет права</p></div>
        </div>
      </Section>

      <AccessModeBlock authInfo={authInfo} />
      <SoftAccessPolicyBlock authInfo={authInfo} />
      {isPlatformOwnerUser(authInfo) || !isTelegramAccessMode(authInfo) ? <PlatformAdminBlock authInfo={authInfo} /> : null}
      {getBusinessCabinetBusinesses(authInfo).length ? <ClientBusinessCabinetBlock authInfo={authInfo} /> : null}
      {!isTelegramAccessMode(authInfo) ? <AccessAdminBlock summary={summary} authInfo={authInfo} /> : null}

      <Section title="Карточки на главном экране" subtitle="всё меняется сразу">
        {['revenue', 'avgCheck', 'checks', 'guests', 'avgGuest', 'foodcost', 'discounts'].map((key) => {
          const item = metric(summary, key);
          return <div className="control-row" key={key}><div><b>{item?.label || key}</b><p>{item?.value || '—'}</p></div><input type="checkbox" checked={settings.visible?.[key] !== false} onChange={(e) => updateVisible(key, e.target.checked)} /></div>;
        })}
      </Section>
      <DataReadinessBlock summary={summary} />
      <button className="primary-btn" onClick={reload}>Обновить данные из API</button>
    </div>
  );
}

function NotificationsModal({ summary, close }) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>Сигналы Lumora</h2><button onClick={close}>×</button></div>
        {(summary?.alerts || []).length ? summary.alerts.map((item, index) => (
          <div className={`event-row ${toneClass(item.level)}`} key={index}><span>⌁</span><div><b>{item.title}</b><p>{item.text}</p></div></div>
        )) : <EmptyState title="Сигналов пока нет" />}
      </div>
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState('today');
  const [period, setPeriod] = useState('day');
  const [date, setDate] = useState(getLocalDate());
  const [restaurantId, setRestaurantId] = useState('all');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [authInfo, setAuthInfo] = useState(null);

  const sourceRestaurants = authInfo?.restaurants?.length ? authInfo.restaurants : (summary?.network?.restaurants || []);
  const restaurants = filterRestaurantsByAccess(sourceRestaurants, authInfo);
  const canSelectAll = canUseAllRestaurants(authInfo);

  async function loadAuth() {
    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const headers = initData ? { Authorization: `tma ${initData}` } : {};
      const response = await fetch('/api/auth', { method: 'POST', headers, cache: 'no-store' });
      const data = await response.json();
      setAuthInfo(data);
    } catch {
      setAuthInfo({ ok: false, mode: 'auth-error' });
    }
  }

  async function loadSummary() {
    try {
      setError('');
      const response = await fetch(`/api/summary?restaurant_id=${restaurantId}&period=${period}&date=${date}&t=${Date.now()}`, { cache: 'no-store', headers: telegramAuthHeaders() });
      const data = await response.json();
      setSummary(data);
    } catch {
      setError('Не удалось загрузить данные. Проверь /api/summary и ENV в Vercel.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const next = loadSettings();
    setSettings(next);
    saveSettings(next);
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
    loadAuth();
  }, []);

  useEffect(() => {
    if (!isTelegramAccessMode(authInfo)) return;

    const allowedIds = getAllowedRestaurantIds(authInfo);
    if (!allowedIds.length) return;

    if (restaurantId === 'all' && !canUseAllRestaurants(authInfo)) {
      setRestaurantId(allowedIds[0]);
      return;
    }

    if (restaurantId !== 'all' && !allowedIds.includes(restaurantId)) {
      setRestaurantId(allowedIds[0]);
    }
  }, [authInfo, restaurantId]);


  useEffect(() => {
    if (!authInfo) return;
    const tabs = getVisibleTabs(authInfo);
    if (tabs.length && !tabs.some((item) => item.id === tab)) {
      setTab(tabs[0].id);
    }
  }, [authInfo, tab]);

  useEffect(() => { loadSummary(); }, [restaurantId, period, date]);

  useEffect(() => {
    if (!settings.autoRefresh) return undefined;
    const id = setInterval(loadSummary, 30000);
    return () => clearInterval(id);
  }, [settings.autoRefresh, restaurantId, period, date]);

  function openRestaurantDashboard(nextRestaurantId, nextTab = 'today') {
    if (!nextRestaurantId) return;
    setRestaurantId(nextRestaurantId);
    setPeriod('day');
    setTab(nextTab || 'today');
    setLoading(true);
  }

  const viewingRestaurantName = useMemo(() => {
    if (!restaurantId || restaurantId === 'all') return 'Вся доступная сеть';
    return restaurants.find((item) => item.id === restaurantId)?.name || restaurantId;
  }, [restaurantId, restaurants]);

  const screen = useMemo(() => {
    if (loading) return <div className="loading"><span />Загружаем Lumora…</div>;
    if (error) return <div className="loading error"><p>{error}</p><button onClick={loadSummary}>Повторить</button></div>;
    if (shouldBlockDashboard(authInfo, settings)) return <NoAccessScreen authInfo={authInfo} />;
    const visibleTabs = getVisibleTabs(authInfo);
    if (visibleTabs.length && !visibleTabs.some((item) => item.id === tab)) return <div className="loading"><span />Настраиваем доступ…</div>;
    if (tab === 'platform') return <PlatformAdminBlock authInfo={authInfo} openRestaurantDashboard={openRestaurantDashboard} />;
    if (tab === 'client') return <ClientBusinessCabinetBlock authInfo={authInfo} openRestaurantDashboard={openRestaurantDashboard} />;
    if (tab !== 'control' && !canSeeSection(authInfo, tab)) return <NoAccessScreen authInfo={authInfo} />;
    if (tab === 'reports') return <ReportsScreen summary={summary} period={period} setPeriod={setPeriod} />;
    if (tab === 'waiters') return <WaitersScreen summary={summary} period={period} setPeriod={setPeriod} />;
    if (tab === 'ai') return <AiScreen summary={summary} restaurantId={restaurantId} period={period} date={date} />;
    if (tab === 'analytics') return <AnalyticsScreen summary={summary} />;
    if (tab === 'plan') return <PlanScreen summary={summary} settings={settings} />;
    if (tab === 'risks') return <RisksScreen summary={summary} />;
    if (tab === 'control') return <ControlScreen settings={settings} setSettings={setSettings} summary={summary} reload={loadSummary} authInfo={authInfo} />;
    return <TodayScreen summary={summary} settings={settings} setTab={setTab} period={period} setPeriod={setPeriod} />;
  }, [tab, summary, loading, error, period, settings, restaurantId, date, authInfo]);

  return (
    <main className="lumora-shell">
      <div className="ambient one" />
      <div className="ambient two" />
      <div className="app-frame">
        {shouldBlockDashboard(authInfo, settings) ? (
          <div className="content no-access-only">{screen}</div>
        ) : (
          <>
            <TopBar summary={summary} settings={settings} setSettings={setSettings} restaurantId={restaurantId} setRestaurantId={setRestaurantId} restaurants={restaurants} canSelectAll={canSelectAll} date={date} setDate={setDate} openNotifications={() => setShowNotifications(true)} />
            <TopTabs tab={tab} setTab={setTab} authInfo={authInfo} />
            {(isPlatformOwnerUser(authInfo) || getBusinessCabinetBusinesses(authInfo).length) && tab !== 'platform' ? (
              <div style={{ margin: '0 18px 12px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 18, background: 'var(--panel-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <small>{isPlatformOwnerUser(authInfo) ? 'Режим владельца платформы' : 'Кабинет клиента'}</small>
                  <b>Открыт дашборд: {viewingRestaurantName}</b>
                </div>
                {isPlatformOwnerUser(authInfo) ? <button onClick={() => setTab('platform')}>Кабинет платформы</button> : <button onClick={() => setTab('client')}>Мой бизнес</button>}
              </div>
            ) : null}
            <div className="content">{screen}</div>
            {showNotifications ? <NotificationsModal summary={summary} close={() => setShowNotifications(false)} /> : null}
          </>
        )}
      </div>
    </main>
  );
}
