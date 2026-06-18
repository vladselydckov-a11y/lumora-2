'use client';

import { useEffect, useMemo, useState } from 'react';

const DEFAULT_SETTINGS = {
  theme: 'dark',
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
  'Сделай отчёт владельцу'
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
    const stored = JSON.parse(localStorage.getItem('lumora_settings_v8') || 'null');
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
  localStorage.setItem('lumora_settings_v8', JSON.stringify(next));
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

function TopBar({ summary, settings, setSettings, restaurantId, setRestaurantId, restaurants, date, setDate, openNotifications }) {
  function toggleTheme() {
    const next = { ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' };
    setSettings(next);
    saveSettings(next);
  }

  return (
    <header className="topbar">
      <div className="brand-row">
        <button className="ghost-icon" aria-label="Меню">☰</button>
        <div className="brand-mark">✦</div>
        <div className="brand-copy">
          <strong>LUMORA</strong>
          <span>AI-аналитик ресторана</span>
        </div>
        <button className="ghost-icon" onClick={toggleTheme} aria-label="Тема">{settings.theme === 'dark' ? '☾' : '☀'}</button>
        <button className="notify-btn" onClick={openNotifications} aria-label="Уведомления">⌁</button>
      </div>

      <div className="filter-row">
        <select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)} aria-label="Ресторан">
          <option value="all">Вся сеть</option>
          {restaurants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Дата" />
      </div>
      <div className="data-note">{summary?.period?.title || 'Данные iiko'} · обновлено {summary?.generatedAt || '—'}</div>
    </header>
  );
}

function TopTabs({ tab, setTab }) {
  return (
    <nav className="top-tabs" aria-label="Разделы">
      {TABS.map((item) => (
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

function StatCard({ item, trend }) {
  if (!item || item.disabled) return null;
  return (
    <article className={`stat-card ${item.status || 'neutral'}`}>
      <div className="stat-top"><span>{item.label}</span><b>{item.delta || '—'}</b></div>
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
                <span>{item.status === 'good' ? 'норма' : 'фокус на выручку'} · чеки и гости по точке пока справочно</span>
              </div>
              <div><strong>{money(revenue)}</strong><em>{share}%</em></div>
            </div>
          );
        })}
      </div>
      <p className="soft-text">По точкам сейчас надёжно показываем выручку и долю. Чеки, гости и средний чек по отдельным точкам включим после калибровки.</p>
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

  if (!channels.length && !days.length) {
    return (
      <Section title="Скидки и потери" subtitle="контроль скидок по проценту от продаж">
        <EmptyState title="Скидок пока нет" text="После загрузки channel_sales Lumora покажет скидки по каналам и дням." />
      </Section>
    );
  }

  return (
    <Section title="Скидки и потери" subtitle="оцениваем по проценту от продаж, а не только по сумме">
      <div className="forecast-grid">
        <div><span>Всего скидок</span><b>{analytics.totalDiscountsText || money(0)}</b><p>{analytics.percentText || '0%'} от продаж</p></div>
        <div><span>Главный канал</span><b>{worstChannel?.name || '—'}</b><p>{worstChannel ? `${worstChannel.percentText} · ${worstChannel.discountsText}` : '—'}</p></div>
        <div><span>День проверки</span><b>{worstDay?.label || '—'}</b><p>{worstDay ? `${worstDay.percentText} · ${worstDay.discountsText}` : '—'}</p></div>
      </div>
      <p className="soft-text">{analytics.insight || 'Lumora анализирует скидки по каналам и дням.'}</p>

      <div className="event-list">
        {channels.slice(0, compact ? 3 : 5).map((item) => (
          <div className={`channel-row ${toneClass(item.status)}`} key={`discount-channel-${item.key || item.name}`}>
            <div><b>{item.name}</b><span>{item.statusText || 'статус'} · {item.revenueText} выручки</span></div>
            <div><strong>{item.discountsText}</strong><em>{item.percentText}</em></div>
          </div>
        ))}
      </div>

      {!compact ? (
        <>
          <div className="event-list">
            {days.slice(0, 7).map((item) => (
              <div className={`channel-row ${toneClass(item.status)}`} key={`discount-day-${item.date || item.label}`}>
                <div><b>{item.label || item.date}</b><span>{item.statusText || 'статус'} · {item.revenueText} выручки</span></div>
                <div><strong>{item.discountsText}</strong><em>{item.percentText}</em></div>
              </div>
            ))}
          </div>
          <p className="soft-text">{analytics.advice || 'Если процент скидок выше обычного, проверьте причины скидок, смену и канал продаж.'}</p>
        </>
      ) : null}
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
      <Section title="Выручка по официантам" subtitle="средний чек пока справочно">
        {waiters.length ? waiters.map((waiter, index) => (
          <div className="waiter-row" key={`${waiter.name}-${index}`}>
            <span className="rank">{index + 1}</span>
            <div><b>{waiter.name}</b><p>Выручка учтена · оценку допродаж включим после калибровки чеков</p></div>
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
        headers: { 'Content-Type': 'application/json' },
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

function PlanScreen({ summary, settings }) {
  const revenue = metricRaw(summary, 'revenue');
  const selectedPeriod = summary?.period?.type || 'day';
  const plan = activePlan(settings, selectedPeriod);
  const percent = plan ? Math.round((revenue / plan) * 100) : 0;
  return (
    <div className="screen-stack">
      <Section title={`План: ${periodTitle(selectedPeriod).toLowerCase()}`} subtitle="AI-фокус на рост выручки">
        <div className="plan-card">
          <span>Выполнение выбранного периода</span>
          <b>{percent}%</b>
          <p>{money(revenue)} из {money(plan)}</p>
        </div>
        {(summary?.actionPlan || []).map((item, index) => (
          <div className="plan-row" key={`${item.title}-${index}`}>
            <span>{index + 1}</span>
            <div><b>{item.title}</b><p>{item.text}</p></div>
          </div>
        ))}
      </Section>
    </div>
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
  const risks = summary?.problems?.length ? summary.problems : summary?.moneyLosses || [];
  return (
    <div className="screen-stack">
      <Section title="Риски" subtitle="что выше нормы, ниже нормы и требует внимания">
        {risks.length ? risks.map((item, index) => <RiskLine item={item} key={`${item.title}-${index}`} />) : <EmptyState title="Рисков пока нет" />}
      </Section>
      <Section title="Сигналы" subtitle="уведомления Lumora">
        {(summary?.alerts || []).map((item, index) => <div className={`event-row ${toneClass(item.level)}`} key={index}><span>⌁</span><div><b>{item.title}</b><p>{item.text}</p></div></div>)}
      </Section>
    </div>
  );
}

function ControlScreen({ settings, setSettings, summary, reload }) {
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
        <div className="control-row"><div><b>Тема</b><p>Тёмная или светлая</p></div><select value={settings.theme} onChange={(e) => update('theme', e.target.value)}><option value="dark">Тёмная</option><option value="light">Светлая</option></select></div>
        <div className="control-row"><div><b>Акцент</b><p>Золото или синий</p></div><select value={settings.accent} onChange={(e) => update('accent', e.target.value)}><option value="gold">Золото</option><option value="blue">Синий</option></select></div>
        <div className="control-row"><div><b>Фудкост</b><p>Включать только после себестоимости iiko</p></div><input type="checkbox" checked={settings.showFoodcostCard} onChange={(e) => update('showFoodcostCard', e.target.checked)} /></div>
        <div className="control-row"><div><b>Автообновление</b><p>Обновлять каждые 30 секунд</p></div><input type="checkbox" checked={settings.autoRefresh} onChange={(e) => update('autoRefresh', e.target.checked)} /></div>
      </Section>

      <Section title="Карточки на главном экране" subtitle="всё меняется сразу">
        {['revenue', 'avgCheck', 'checks', 'guests', 'avgGuest', 'foodcost', 'discounts'].map((key) => {
          const item = metric(summary, key);
          return <div className="control-row" key={key}><div><b>{item?.label || key}</b><p>{item?.value || '—'}</p></div><input type="checkbox" checked={settings.visible?.[key] !== false} onChange={(e) => updateVisible(key, e.target.checked)} /></div>;
        })}
      </Section>
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

  const restaurants = summary?.network?.restaurants || [];

  async function loadSummary() {
    try {
      setError('');
      const response = await fetch(`/api/summary?restaurant_id=${restaurantId}&period=${period}&date=${date}&t=${Date.now()}`, { cache: 'no-store' });
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
  }, []);

  useEffect(() => { loadSummary(); }, [restaurantId, period, date]);

  useEffect(() => {
    if (!settings.autoRefresh) return undefined;
    const id = setInterval(loadSummary, 30000);
    return () => clearInterval(id);
  }, [settings.autoRefresh, restaurantId, period, date]);

  const screen = useMemo(() => {
    if (loading) return <div className="loading"><span />Загружаем Lumora…</div>;
    if (error) return <div className="loading error"><p>{error}</p><button onClick={loadSummary}>Повторить</button></div>;
    if (tab === 'reports') return <ReportsScreen summary={summary} period={period} setPeriod={setPeriod} />;
    if (tab === 'waiters') return <WaitersScreen summary={summary} period={period} setPeriod={setPeriod} />;
    if (tab === 'ai') return <AiScreen summary={summary} restaurantId={restaurantId} period={period} date={date} />;
    if (tab === 'analytics') return <AnalyticsScreen summary={summary} />;
    if (tab === 'plan') return <PlanScreen summary={summary} settings={settings} />;
    if (tab === 'risks') return <RisksScreen summary={summary} />;
    if (tab === 'control') return <ControlScreen settings={settings} setSettings={setSettings} summary={summary} reload={loadSummary} />;
    return <TodayScreen summary={summary} settings={settings} setTab={setTab} period={period} setPeriod={setPeriod} />;
  }, [tab, summary, loading, error, period, settings, restaurantId, date]);

  return (
    <main className="lumora-shell">
      <div className="ambient one" />
      <div className="ambient two" />
      <div className="app-frame">
        <TopBar summary={summary} settings={settings} setSettings={setSettings} restaurantId={restaurantId} setRestaurantId={setRestaurantId} restaurants={restaurants} date={date} setDate={setDate} openNotifications={() => setShowNotifications(true)} />
        <TopTabs tab={tab} setTab={setTab} />
        <div className="content">{screen}</div>
        {showNotifications ? <NotificationsModal summary={summary} close={() => setShowNotifications(false)} /> : null}
      </div>
    </main>
  );
}
