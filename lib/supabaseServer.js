import { formatMoney } from './sampleData';

const TYUMEN_TZ = 'Asia/Yekaterinburg';
const DEFAULT_DAILY_PLAN = 150000;
const DEFAULT_WEEKLY_PLAN = 500000;
const DEFAULT_MONTHLY_PLAN = 3000000;

export async function supabaseFetch(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE key is missing');

  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase error ${response.status}: ${text}`);
  }
  return response.json();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sum(list, field) {
  return (Array.isArray(list) ? list : []).reduce((total, item) => total + toNumber(item?.[field]), 0);
}

function average(list, field) {
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) return 0;
  return rows.reduce((total, item) => total + toNumber(item?.[field]), 0) / rows.length;
}

function weightedPercent(rows, percentField = 'foodcost_percent', weightField = 'revenue') {
  const list = Array.isArray(rows) ? rows : [];
  const totalWeight = sum(list, weightField);
  if (!totalWeight) return average(list, percentField);
  return list.reduce((total, row) => total + toNumber(row?.[percentField]) * toNumber(row?.[weightField]), 0) / totalWeight;
}

function percent(value) {
  return `${value > 0 ? '+' : ''}${Number(value || 0).toFixed(1)}%`;
}

function statusFromDelta(value, goodWhenPositive = true) {
  if (Math.abs(value) < 0.05) return 'neutral';
  return goodWhenPositive ? (value > 0 ? 'good' : 'bad') : (value > 0 ? 'bad' : 'good');
}

function buildInFilter(field, values) {
  const unique = [...new Set((values || []).filter(Boolean))];
  if (!unique.length) return '';
  return `&${field}=in.(${unique.join(',')})`;
}

function dateToUTC(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function addDays(dateString, days) {
  const date = dateToUTC(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateMinusDays(dateString, days) {
  return addDays(dateString, -days);
}

function monthStart(dateString) {
  return `${dateString.slice(0, 8)}01`;
}

function weekStartMonday(dateString) {
  const date = dateToUTC(dateString);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startDate, endDate) {
  const start = dateToUTC(startDate);
  const end = dateToUTC(endDate);
  return Math.max(Math.round((end - start) / 86400000) + 1, 1);
}

function daysInMonth(dateString) {
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inDateRange(row, startDate, endDate) {
  const value = row?.business_date;
  return value >= startDate && value <= endDate;
}

function getLocalDateParts(timeZone = TYUMEN_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour') || 0)
  };
}

function getDefaultOperationalDate() {
  const local = getLocalDateParts();
  return local.hour < 2 ? dateMinusDays(local.date, 1) : local.date;
}

function normalizePeriod(period) {
  return ['day', 'week', 'month'].includes(period) ? period : 'day';
}

function getRange({ date, period }) {
  const normalized = normalizePeriod(period);
  const endDate = date || getDefaultOperationalDate();
  // Week is a calendar business week: Monday -> selected date.
  // Before this fix, week used a rolling last-7-days range, which inflated weekly revenue.
  if (normalized === 'week') return { period: normalized, startDate: weekStartMonday(endDate), endDate };
  if (normalized === 'month') return { period: normalized, startDate: monthStart(endDate), endDate };
  return { period: normalized, startDate: endDate, endDate };
}

function getPreviousRange({ startDate, endDate }) {
  const days = daysBetweenInclusive(startDate, endDate);
  const previousEnd = dateMinusDays(startDate, 1);
  const previousStart = dateMinusDays(previousEnd, days - 1);
  return { previousStart, previousEnd };
}

function ruDay(dateString) {
  const names = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const day = dateToUTC(dateString).getUTCDay();
  return names[day] || dateString;
}

function groupBy(list, keyFn) {
  return (Array.isArray(list) ? list : []).reduce((map, item) => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
    return map;
  }, new Map());
}

function metric(label, key, raw, delta, status, formatter = formatMoney, extra = {}) {
  return { key, label, value: formatter(raw), raw, delta, status, ...extra };
}

async function getKpiSettings(restaurantIds) {
  const filter = buildInFilter('restaurant_id', restaurantIds);
  const rows = await supabaseFetch(`/rest/v1/kpi_settings?select=restaurant_id,daily_revenue_plan,avg_check_target,foodcost_max,discount_max${filter}`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function getChannelRows(startDate) {
  const startFilter = startDate ? `&business_date=gte.${startDate}` : '';
  const rows = await supabaseFetch(`/rest/v1/channel_sales?select=*${startFilter}&order=business_date.desc&limit=6000`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function getKpiSalesRows(startDate) {
  const startFilter = startDate ? `&business_date=gte.${startDate}` : '';
  const rows = await supabaseFetch(`/rest/v1/kpi_sales?select=*${startFilter}&order=business_date.desc&limit=2000`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function getHourlyRows(startDate) {
  const startFilter = startDate ? `&business_date=gte.${startDate}` : '';
  const rows = await supabaseFetch(`/rest/v1/hourly_sales?select=*${startFilter}&order=business_date.desc,hour.asc&limit=6000`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function getRows(table, restaurantIds, startDate) {
  const filter = buildInFilter('restaurant_id', restaurantIds);
  const startFilter = startDate ? `&business_date=gte.${startDate}` : '';
  const rows = await supabaseFetch(`/rest/v1/${table}?select=*${filter}${startFilter}&order=business_date.desc&limit=6000`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function isVisibleMenuItem(row) {
  const category = String(row?.category_name || '').toLowerCase().trim();
  const name = String(row?.dish_name || '').toLowerCase().trim();

  const badCategories = [
    'модификаторы',
    'без категории',
    'допы',
    'долы'
  ];

  if (badCategories.includes(category)) return false;

  const badNameParts = [
    'доставка',
    'сироп',
    'доп',
    'модификатор'
  ];

  return !badNameParts.some((part) => name.includes(part));
}

function cleanDishRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isVisibleMenuItem);
}

function aggregateDishes(rows) {
  const visibleRows = cleanDishRows(rows);
  const grouped = groupBy(visibleRows, (row) => `${row.dish_name || 'Без названия'}|||${row.category_name || 'Меню'}`);
  return [...grouped.entries()].map(([key, list]) => {
    const [name, category] = key.split('|||');
    const revenue = sum(list, 'revenue');
    const cost = sum(list, 'cost');
    const quantity = sum(list, 'quantity');
    const foodcost = revenue && cost ? Math.round((cost / revenue) * 100) : 0;
    const margin = revenue && cost ? Math.max(Math.round(((revenue - cost) / revenue) * 100), 0) : 0;
    return {
      name,
      category,
      amount: `${Math.round(quantity)} шт.`,
      rawAmount: quantity,
      revenue: formatMoney(revenue),
      rawRevenue: revenue,
      cost: formatMoney(cost),
      rawCost: cost,
      foodcost: cost ? `${foodcost}%` : 'не подключено',
      rawFoodcost: foodcost,
      margin: cost ? `${margin}%` : 'не подключено',
      rawMargin: margin,
      ai: cost ? (foodcost > 35 ? 'Проверить себестоимость' : quantity < 20 ? 'Продвинуть в скриптах' : 'Норма') : (revenue >= 5000 ? 'Сильная позиция по выручке' : quantity <= 1 ? 'Низкий спрос, проверить актуальность' : 'Продажи есть, маржу подключим после себестоимости')
    };
  }).sort((a, b) => b.rawRevenue - a.rawRevenue);
}

function aggregateCategories(rows) {
  const visibleRows = cleanDishRows(rows);
  const grouped = groupBy(visibleRows, (row) => row.category_name || 'Меню');
  return [...grouped.entries()].map(([name, list]) => {
    const revenue = sum(list, 'revenue');
    const cost = sum(list, 'cost');
    const quantity = sum(list, 'quantity');
    const foodcost = revenue && cost ? Math.round((cost / revenue) * 100) : 0;
    const margin = revenue && cost ? Math.max(Math.round(((revenue - cost) / revenue) * 100), 0) : 0;
    return { name, revenue, revenueText: formatMoney(revenue), cost, costText: formatMoney(cost), quantity, foodcost, margin, foodcostText: cost ? `${foodcost}%` : 'не подключено', marginText: cost ? `${margin}%` : 'не подключено' };
  }).sort((a, b) => b.revenue - a.revenue);
}

function aggregateWaiters(rows, avgCheckTarget) {
  const sourceRows = Array.isArray(rows) ? rows : [];

  function isRealWaiterName(value) {
    const name = String(value || '').trim().toLowerCase();
    if (!name) return false;
    if (name === 'без имени') return false;
    if (name === 'null' || name === 'undefined') return false;
    return true;
  }

  const namedRows = sourceRows.filter((row) => isRealWaiterName(row?.waiter_name));
  const safeRows = namedRows.length ? namedRows : sourceRows;

  const grouped = groupBy(safeRows, (row) => isRealWaiterName(row?.waiter_name) ? row.waiter_name : 'Без имени');

  return [...grouped.entries()].map(([name, list]) => {
    const revenue = sum(list, 'revenue');
    const checks = sum(list, 'checks_count');
    const avgCheck = checks ? Math.round(revenue / checks) : Math.round(average(list, 'avg_check'));
    return {
      name,
      checks,
      avgCheck: formatMoney(avgCheck),
      rawAvgCheck: avgCheck,
      revenue: formatMoney(revenue),
      rawRevenue: revenue,
      upsell: 'на калибровке',
      status: 'Выручка учтена',
      advice: 'Средний чек по официанту показывается справочно: количество чеков в waiter_sales требует калибровки.',
      note: 'Оценку допродаж включим после калибровки чеков по официантам.',
      isCalibrated: false
    };
  }).sort((a, b) => b.rawRevenue - a.rawRevenue);
}

function aggregateChannels(rows, revenueBase) {
  const grouped = groupBy(rows, (row) => row.channel_key || row.channel_name || 'other');

  return [...grouped.entries()].map(([key, list]) => {
    const revenue = sum(list, 'revenue');
    const checks = sum(list, 'checks_count');
    const guests = sum(list, 'guests_count');
    const discounts = sum(list, 'discount_sum');
    const bonuses = sum(list, 'bonus_sum');
    const bonusOrders = sum(list, 'bonus_orders_count');
    const loyaltyOrders = sum(list, 'loyalty_orders_count');
    const channel = list[0] || {};

    return {
      key,
      name: channel.channel_name || 'Канал',
      revenue,
      revenueText: formatMoney(revenue),
      discounts,
      discountsText: formatMoney(discounts),
      bonuses,
      bonusesText: formatMoney(bonuses),
      bonusOrders: Math.round(bonusOrders),
      loyaltyOrders: Math.round(loyaltyOrders),
      checks,
      guests,
      avgCheck: checks ? Math.round(revenue / checks) : Math.round(average(list, 'avg_check')),
      share: revenueBase ? Math.round((revenue / revenueBase) * 100) : 0,
      source: channel.source || 'iiko'
    };
  })
    .filter((item) => item.revenue || item.checks || item.guests || item.discounts || item.bonuses || item.loyaltyOrders)
    .sort((a, b) => b.revenue - a.revenue);
}

function discountStatusFromPercent(value) {
  const number = toNumber(value);
  if (number <= 5) return 'good';
  if (number <= 8) return 'warn';
  return 'bad';
}

function discountStatusText(status) {
  if (status === 'good') return 'норма';
  if (status === 'warn') return 'проверить';
  return 'зона риска';
}

function buildDiscountAnalytics(rows, startDate, endDate, revenueBase = 0) {
  const periodRows = Array.isArray(rows) ? rows : [];

  const totalRevenue = sum(periodRows, 'revenue');
  const totalDiscounts = sum(periodRows, 'discount_sum');
  const totalBonuses = sum(periodRows, 'bonus_sum');
  const bonusOrdersCount = sum(periodRows, 'bonus_orders_count');
  const loyaltyOrdersCount = sum(periodRows, 'loyalty_orders_count');
  const totalChecks = sum(periodRows, 'checks_count');

  const grossRevenue = totalRevenue + totalDiscounts;
  const totalPercent = grossRevenue ? Number(((totalDiscounts * 100) / grossRevenue).toFixed(1)) : 0;
  const bonusPercent = grossRevenue ? Number(((totalBonuses * 100) / grossRevenue).toFixed(1)) : 0;
  const loyaltyShare = totalChecks ? Math.round((loyaltyOrdersCount / totalChecks) * 100) : 0;
  const status = discountStatusFromPercent(totalPercent);

  const channelGroups = groupBy(periodRows, (row) => row.channel_key || row.channel_name || 'other');
  const channels = [...channelGroups.entries()].map(([key, list]) => {
    const revenue = sum(list, 'revenue');
    const discounts = sum(list, 'discount_sum');
    const bonuses = sum(list, 'bonus_sum');
    const bonusOrders = sum(list, 'bonus_orders_count');
    const loyaltyOrders = sum(list, 'loyalty_orders_count');
    const checks = sum(list, 'checks_count');
    const gross = revenue + discounts;
    const discountPercent = gross ? Number(((discounts * 100) / gross).toFixed(1)) : 0;
    const bonusPercentChannel = gross ? Number(((bonuses * 100) / gross).toFixed(1)) : 0;
    const loyaltyShareChannel = checks ? Math.round((loyaltyOrders / checks) * 100) : 0;
    const channel = list[0] || {};
    const channelStatus = discountStatusFromPercent(discountPercent);

    return {
      key,
      name: channel.channel_name || 'Канал',
      revenue,
      revenueText: formatMoney(revenue),
      discounts,
      discountsText: formatMoney(discounts),
      bonuses,
      bonusesText: formatMoney(bonuses),
      bonusOrders: Math.round(bonusOrders),
      loyaltyOrders: Math.round(loyaltyOrders),
      checks: Math.round(checks),
      grossRevenue: gross,
      grossRevenueText: formatMoney(gross),
      percent: discountPercent,
      percentText: `${discountPercent}%`,
      bonusPercent: bonusPercentChannel,
      bonusPercentText: `${bonusPercentChannel}%`,
      loyaltyShare: loyaltyShareChannel,
      loyaltyShareText: `${loyaltyShareChannel}%`,
      share: totalDiscounts ? Math.round((discounts / totalDiscounts) * 100) : 0,
      status: channelStatus,
      statusText: discountStatusText(channelStatus)
    };
  })
    .filter((item) => item.revenue || item.discounts || item.bonuses || item.loyaltyOrders)
    .sort((a, b) => b.discounts - a.discounts || b.bonuses - a.bonuses || b.revenue - a.revenue);

  const days = [];
  let current = startDate;
  while (current <= endDate) {
    const list = periodRows.filter((row) => row.business_date === current);
    const revenue = sum(list, 'revenue');
    const discounts = sum(list, 'discount_sum');
    const bonuses = sum(list, 'bonus_sum');
    const bonusOrders = sum(list, 'bonus_orders_count');
    const loyaltyOrders = sum(list, 'loyalty_orders_count');
    const checks = sum(list, 'checks_count');
    const gross = revenue + discounts;
    const discountPercent = gross ? Number(((discounts * 100) / gross).toFixed(1)) : 0;
    const bonusPercentDay = gross ? Number(((bonuses * 100) / gross).toFixed(1)) : 0;
    const loyaltyShareDay = checks ? Math.round((loyaltyOrders / checks) * 100) : 0;
    const dayStatus = discountStatusFromPercent(discountPercent);

    days.push({
      date: current,
      day: ruDay(current),
      label: `${ruDay(current)} · ${current.slice(5)}`,
      revenue,
      revenueText: formatMoney(revenue),
      discounts,
      discountsText: formatMoney(discounts),
      bonuses,
      bonusesText: formatMoney(bonuses),
      bonusOrders: Math.round(bonusOrders),
      loyaltyOrders: Math.round(loyaltyOrders),
      checks: Math.round(checks),
      grossRevenue: gross,
      grossRevenueText: formatMoney(gross),
      percent: discountPercent,
      percentText: `${discountPercent}%`,
      bonusPercent: bonusPercentDay,
      bonusPercentText: `${bonusPercentDay}%`,
      loyaltyShare: loyaltyShareDay,
      loyaltyShareText: `${loyaltyShareDay}%`,
      status: dayStatus,
      statusText: discountStatusText(dayStatus)
    });
    current = addDays(current, 1);
  }

  const worstChannel = channels[0] || null;
  const worstDay = [...days]
    .filter((item) => item.discounts > 0)
    .sort((a, b) => b.percent - a.percent || b.discounts - a.discounts)[0] || null;
  const topBonusChannel = [...channels]
    .filter((item) => item.bonuses > 0 || item.loyaltyOrders > 0)
    .sort((a, b) => b.bonuses - a.bonuses || b.loyaltyOrders - a.loyaltyOrders)[0] || null;
  const topBonusDay = [...days]
    .filter((item) => item.bonuses > 0 || item.loyaltyOrders > 0)
    .sort((a, b) => b.bonuses - a.bonuses || b.loyaltyOrders - a.loyaltyOrders)[0] || null;
  const riskyDays = [...days]
    .filter((item) => item.percent > 5)
    .sort((a, b) => b.percent - a.percent || b.discounts - a.discounts)
    .slice(0, 5);
  const topDaysByAmount = [...days]
    .filter((item) => item.discounts > 0)
    .sort((a, b) => b.discounts - a.discounts)
    .slice(0, 5);

  const bonusInsight = totalBonuses > 0
    ? `Списания бонусов: ${formatMoney(totalBonuses)}. ${topBonusChannel ? `Больше всего по каналу ${topBonusChannel.name}: ${topBonusChannel.bonusesText}.` : ''}`.trim()
    : loyaltyOrdersCount > 0
      ? `Списаний бонусов нет, но заказы с картой/лояльностью есть: ${Math.round(loyaltyOrdersCount)}.`
      : 'Списаний бонусов и заказов с картой за период не видно.';

  const insight = totalDiscounts
    ? `Скидки ${formatMoney(totalDiscounts)} — ${totalPercent}% от продаж. ${worstChannel ? `Больше всего скидок в канале ${worstChannel.name}: ${worstChannel.discountsText}.` : ''} ${worstDay ? `Самый высокий процент по дням: ${worstDay.label}, ${worstDay.percentText}.` : ''} ${bonusInsight}`.trim()
    : `Скидок за выбранный период нет. ${bonusInsight}`;

  const advice = status === 'good'
    ? 'Скидки выглядят нормально. Бонусы показываются отдельно: если Bonus.Sum = 0, значит iiko не отдал списания бонусов за период.'
    : status === 'warn'
      ? 'Скидки выше комфортного уровня. Проверить дни, каналы и отдельно посмотреть бонусные/карточные заказы.'
      : 'Скидки в зоне риска. Нужна разборка причин, каналов, ручных скидок и бонусной активности.';

  return {
    totalDiscounts,
    totalDiscountsText: formatMoney(totalDiscounts),
    totalBonuses,
    totalBonusesText: formatMoney(totalBonuses),
    bonusOrdersCount: Math.round(bonusOrdersCount),
    loyaltyOrdersCount: Math.round(loyaltyOrdersCount),
    bonusPercent,
    bonusPercentText: `${bonusPercent}%`,
    loyaltyShare,
    loyaltyShareText: `${loyaltyShare}%`,
    hasBonusData: totalBonuses > 0 || bonusOrdersCount > 0 || loyaltyOrdersCount > 0,
    revenue: totalRevenue || revenueBase,
    revenueText: formatMoney(totalRevenue || revenueBase),
    grossRevenue,
    grossRevenueText: formatMoney(grossRevenue),
    percent: totalPercent,
    percentText: `${totalPercent}%`,
    status,
    statusText: discountStatusText(status),
    channels,
    days,
    topChannels: channels.slice(0, 3),
    topDaysByAmount,
    riskyDays,
    worstChannel,
    worstDay,
    topBonusChannel,
    topBonusDay,
    insight,
    bonusInsight,
    advice
  };
}

function formatHourLabel(hour) {
  const normalized = Math.max(0, Math.min(23, Math.trunc(toNumber(hour))));
  return `${String(normalized).padStart(2, '0')}:00`;
}

function aggregateHourlyRows(rows, revenueBase = 0) {
  const grouped = groupBy(rows, (row) => String(Math.trunc(toNumber(row.hour))));

  const rawHours = [...grouped.entries()].map(([hour, list]) => {
    const rawHour = Math.trunc(toNumber(hour));
    const revenue = sum(list, 'revenue');
    const checks = sum(list, 'checks_count');
    const guests = sum(list, 'guests_count');

    return {
      hour: rawHour,
      label: formatHourLabel(rawHour),
      revenue,
      checks,
      guests
    };
  }).filter((item) => item.hour >= 0 && item.hour <= 23 && (item.revenue || item.checks || item.guests)).sort((a, b) => a.hour - b.hour);

  const rawHourlyRevenue = rawHours.reduce((total, item) => total + toNumber(item.revenue), 0);

  // Safety for client view:
  // sometimes hourly_sales contains duplicated OLAP rows and the sum by hours becomes higher than the KPI revenue.
  // In that case we keep the hourly proportions, but bring the total hourly revenue back to the trusted KPI revenue.
  const shouldNormalize = revenueBase > 0 && rawHourlyRevenue > revenueBase * 1.05;
  const normalizationFactor = shouldNormalize ? revenueBase / rawHourlyRevenue : 1;

  return rawHours.map((item) => {
    const revenue = item.revenue * normalizationFactor;
    const checks = shouldNormalize ? item.checks * normalizationFactor : item.checks;
    const guests = shouldNormalize ? item.guests * normalizationFactor : item.guests;
    const avgCheck = checks ? Math.round(revenue / checks) : 0;

    return {
      hour: item.hour,
      label: item.label,
      revenue,
      rawRevenue: item.revenue,
      revenueText: formatMoney(revenue),
      checks: Math.round(checks),
      rawChecks: item.checks,
      guests: Math.round(guests),
      rawGuests: item.guests,
      avgCheck,
      avgCheckText: formatMoney(avgCheck),
      share: revenueBase ? Math.round((revenue / revenueBase) * 100) : 0,
      isNormalized: shouldNormalize,
      normalizationFactor
    };
  });
}

function buildHourlyAnalytics(rows, revenueBase = 0) {
  const hours = aggregateHourlyRows(rows, revenueBase);
  const peaks = [...hours].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const weakHours = [...hours].filter((item) => item.revenue > 0).sort((a, b) => a.revenue - b.revenue).slice(0, 5);
  const best = peaks[0] || null;
  const weak = weakHours[0] || null;
  const lunchRevenue = hours.filter((item) => item.hour >= 12 && item.hour <= 15).reduce((total, item) => total + item.revenue, 0);
  const eveningRevenue = hours.filter((item) => item.hour >= 18 && item.hour <= 22).reduce((total, item) => total + item.revenue, 0);
  const lunchShare = revenueBase ? Math.min(Math.round((lunchRevenue / revenueBase) * 100), 100) : 0;
  const eveningShare = revenueBase ? Math.min(Math.round((eveningRevenue / revenueBase) * 100), 100) : 0;
  const isNormalized = hours.some((item) => item.isNormalized);
  const mainPeakText = best ? `Главный пик продаж: ${best.label}, ${best.revenueText}.` : 'Почасовых продаж за выбранный период пока нет.';
  const shiftAdvice = eveningRevenue >= lunchRevenue
    ? `Основной вклад даёт вечерний слот 18:00–22:00: ${formatMoney(eveningRevenue)}, около ${eveningShare}% выручки периода.`
    : `Сильнее всего работает дневной слот 12:00–15:00: ${formatMoney(lunchRevenue)}, около ${lunchShare}% выручки периода.`;

  return {
    hours,
    peaks,
    weakHours,
    bestHour: best,
    weakHour: weak,
    lunchRevenue,
    lunchRevenueText: formatMoney(lunchRevenue),
    lunchShare,
    eveningRevenue,
    eveningRevenueText: formatMoney(eveningRevenue),
    eveningShare,
    isNormalized,
    normalizationNote: isNormalized ? 'Почасовая выручка приведена к KPI-выручке периода, чтобы не показывать сумму часов выше дневной выручки.' : '',
    insight: best ? `${mainPeakText} ${shiftAdvice}` : mainPeakText,
    advice: best ? 'Усилить смену, заготовки и контроль кухни в часы пика; слабые часы использовать для подготовки и точечных акций.' : 'Данные появятся после загрузки hourly_sales.'
  };
}

function buildTrend(rows, startDate, endDate) {
  const days = [];
  let date = startDate;
  while (date <= endDate) {
    const list = rows.filter((row) => row.business_date === date);
    const revenue = sum(list, 'revenue');
    const checks = sum(list, 'checks_count');
    days.push({ day: ruDay(date), date, revenue, checks, avgCheck: checks ? Math.round(revenue / checks) : Math.round(average(list, 'avg_check')) });
    date = addDays(date, 1);
  }
  return days;
}

function normalizeKpiRestaurantId(value) {
  const text = String(value || '').toLowerCase().trim();

  if (text === 'all' || text === 'все' || text === 'вся сеть') return 'all';
  if (text.includes('akvatoria') || text.includes('akvatory') || text.includes('акват')) return 'akvatoria';
  if (text.includes('aziatok') || text.includes('азиат') || text.includes('96')) return 'aziatok';

  return text;
}

function getChannelRestaurantId(row) {
  const explicit = normalizeKpiRestaurantId(row?.restaurant_id || row?.restaurantId || row?.restaurant);

  if (explicit && explicit !== 'all' && explicit !== 'unknown') {
    if (explicit.includes('akvatoria') || explicit.includes('akvatory') || explicit.includes('акват')) return 'akvatoria';
    if (explicit.includes('aziatok') || explicit.includes('азиат') || explicit.includes('96')) return 'aziatok';
  }

  const id = String(row?.id || '').toLowerCase();
  const text = `${id} ${String(row?.channel_name || '').toLowerCase()} ${String(row?.source || '').toLowerCase()}`;

  if (text.includes('_akvatoria_') || text.includes('_akvatory_') || text.includes('akvatoria') || text.includes('акват')) return 'akvatoria';
  if (text.includes('_aziatok_') || text.includes('aziatok') || text.includes('азиат') || text.includes('бар 96')) return 'aziatok';

  return 'all';
}

function getDefaultPlanForPeriod(period) {
  if (period === 'month') return DEFAULT_MONTHLY_PLAN;
  if (period === 'week') return DEFAULT_WEEKLY_PLAN;
  return DEFAULT_DAILY_PLAN;
}

function buildRestaurantCards(restaurants, dailyRows, kpis, range, kpiRows = []) {
  const safeRestaurants = Array.isArray(restaurants) ? restaurants : [];
  const periodPlanBase = getDefaultPlanForPeriod(range?.period);
  const pointPlanFallback = safeRestaurants.length ? Math.round(periodPlanBase / safeRestaurants.length) : periodPlanBase;

  return safeRestaurants.map((restaurant) => {
    const normalizedRestaurantId = normalizeKpiRestaurantId(restaurant.id);
    const kpiPeriodRows = kpiRows.filter((item) => normalizeKpiRestaurantId(item.restaurant_id) === normalizedRestaurantId && inDateRange(item, range.startDate, range.endDate));
    const dailyPeriodRows = dailyRows.filter((item) => item.restaurant_id === restaurant.id && inDateRange(item, range.startDate, range.endDate));
    const kpi = kpis.find((item) => item.restaurant_id === restaurant.id) || {};

    const revenueFromKpi = sum(kpiPeriodRows, 'revenue');
    const checksFromKpi = sum(kpiPeriodRows, 'checks_count');
    const guestsFromKpi = sum(kpiPeriodRows, 'guests_count');

    const revenueFromDaily = sum(dailyPeriodRows, 'revenue');
    const checksFromDaily = sum(dailyPeriodRows, 'checks_count');
    const guestsFromDaily = sum(dailyPeriodRows, 'guests_count');

    const revenue = revenueFromKpi || revenueFromDaily;
    const checks = checksFromKpi || checksFromDaily;
    const guests = guestsFromKpi || guestsFromDaily;
    const avgCheck = checks
      ? Math.round(revenue / checks)
      : Math.round(average(kpiPeriodRows.length ? kpiPeriodRows : dailyPeriodRows, 'avg_check'));

    const planFromRows = sum(dailyPeriodRows, 'plan_revenue');
    const plan = planFromRows || pointPlanFallback || toNumber(kpi.daily_revenue_plan) || DEFAULT_DAILY_PLAN;
    const percentPlan = plan ? Math.round((revenue / plan) * 100) : 0;
    const status = percentPlan < 60 ? 'bad' : percentPlan < 85 ? 'warn' : 'good';
    const problem = status === 'good' ? 'норма' : 'выручка';
    const hasKpiRows = kpiPeriodRows.length > 0;

    return {
      id: restaurant.id,
      name: restaurant.name,
      city: restaurant.city || 'Город',
      revenue,
      plan,
      avgCheck,
      checks,
      guests,
      problem,
      status,
      dataQuality: hasKpiRows ? 'kpi_sales_ready_by_restaurant_section_period' : 'revenue_ready_checks_guests_need_calibration',
      note: hasKpiRows
        ? 'По точке выручка, чеки, гости и средний чек идут из kpi_sales за выбранный период.'
        : 'По точке выручка корректна; чеки, гости и средний чек требуют отдельной калибровки.'
    };
  });
}

function rangeLabel(period, startDate, endDate) {
  if (period === 'day') return `День: ${endDate}`;
  if (period === 'week') return `Неделя: ${startDate} — ${endDate}`;
  return `Месяц: ${startDate} — ${endDate}`;
}

function buildZeroSummary({ restaurantId, restaurants, selectedRestaurants, range, allDailyRows, allKpis }) {
  const activeRestaurant = restaurantId === 'all'
    ? { id: 'all', name: 'Вся сеть', city: selectedRestaurants[0]?.city || 'Город' }
    : { id: selectedRestaurants[0].id, name: selectedRestaurants[0].name, city: selectedRestaurants[0].city || 'Город' };
  const restaurantCards = buildRestaurantCards(restaurants, allDailyRows, allKpis, range, []);
  const planRevenue = range.period === 'month' ? DEFAULT_MONTHLY_PLAN : range.period === 'week' ? DEFAULT_WEEKLY_PLAN : DEFAULT_DAILY_PLAN;
  const title = range.period === 'day' ? 'Продаж за выбранный день пока нет' : 'За выбранный период пока нет продаж';
  return {
    dataMode: 'supabase_zero_period',
    isEmptyPeriod: true,
    generatedAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    selectedRestaurantId: activeRestaurant.id,
    restaurant: { ...activeRestaurant, currency: '₽', revenue: 0, plan: planRevenue, avgCheck: 0, checks: 0, guests: 0 },
    period: { date: range.endDate, startDate: range.startDate, endDate: range.endDate, type: range.period, title: rangeLabel(range.period, range.startDate, range.endDate), compareTitle: 'к предыдущему периоду', range30: `${dateMinusDays(range.endDate, 89)} — ${range.endDate}` },
    plan: { dailyRevenue: DEFAULT_DAILY_PLAN, weeklyRevenue: DEFAULT_WEEKLY_PLAN, monthlyRevenue: DEFAULT_MONTHLY_PLAN, avgCheck: 2200, foodcostMax: 30, discountMax: 9000, activeRevenue: planRevenue },
    metrics: [
      metric('Выручка', 'revenue', 0, '0% плана', 'neutral'),
      metric('Чеки', 'checks', 0, 'нет чеков', 'neutral', (value) => String(Math.round(value))),
      metric('Средний чек', 'avgCheck', 0, 'нет чеков', 'neutral'),
      metric('Гости', 'guests', 0, 'нет гостей', 'neutral', (value) => String(Math.round(value))),
      metric('Средний чек гостя', 'avgGuest', 0, 'нет гостей', 'neutral'),
      metric('Фудкост', 'foodcost', 0, 'не подключено', 'neutral', () => 'не подключено', { disabled: true }),
      metric('Скидки', 'discounts', 0, 'нет скидок', 'neutral')
    ],
    salesChannels: [], channels: [], topDishes: [], topDishes30Days: [], lowDishes: [], categories: [], waiters: [], waiters30Days: [],
    week: buildTrend(allDailyRows, dateMinusDays(range.endDate, 6), range.endDate),
    hourly: [],
    hourlyAnalytics: buildHourlyAnalytics([], 0),
    hourlyPeaks: [],
    weakHours: [],
    discountAnalytics: buildDiscountAnalytics([], range.startDate, range.endDate, 0),
    discountByChannels: [],
    discountByDays: [],
    network: { selectedRestaurantId: activeRestaurant.id, restaurants: restaurantCards, totals: { revenue: 0, plan: planRevenue, percent: 0, avgCheck: 0, checks: 0, weakPoints: 0 }, ai: title },
    moneyLosses: [{ title, amount: 0, reason: 'Lumora ждёт первые чеки из iiko.', action: 'После первого чека n8n запишет данные, и экран обновится автоматически.', level: 'neutral' }],
    totalLoss: 0,
    actionPlan: [{ role: 'Lumora', title, text: 'Пока можно проверить готовность смены, цели по среднему чеку и план на день.' }],
    teamScript: 'Продаж пока нет. После первого чека Lumora сформирует скрипт для смены на основе фактических данных.',
    forecast: {
      current: 0,
      plan: planRevenue,
      projected: 0,
      risk: 'Продаж пока нет',
      gap: planRevenue,
      confidence: 0,
      weeklyTempo: 0,
      projectedWeek: 0,
      weekPlan: DEFAULT_WEEKLY_PLAN,
      weekGap: DEFAULT_WEEKLY_PLAN,
      weekRisk: 'Продаж пока нет',
      weekElapsedDays: 0,
      weekTotalDays: 7,
      weekRevenueActual: 0,
      monthlyTempo: 0,
      projectedMonth: 0,
      monthPlan: DEFAULT_MONTHLY_PLAN,
      monthGap: DEFAULT_MONTHLY_PLAN,
      monthRisk: 'Продаж пока нет',
      recommendations: ['Дождаться первых чеков.', 'Проверить план и цель среднего чека в Управлении.']
    },
    kpiSettings: [
      { name: 'План дня', value: formatMoney(DEFAULT_DAILY_PLAN), status: 'редактируется в Управлении' },
      { name: 'План недели', value: formatMoney(DEFAULT_WEEKLY_PLAN), status: 'редактируется в Управлении' },
      { name: 'План месяца', value: formatMoney(DEFAULT_MONTHLY_PLAN), status: 'редактируется в Управлении' }
    ],
    alerts: [{ level: 'neutral', title, text: 'Показатели не смешиваются с прошлыми днями.' }],
    problems: [],
    ai: { summary: title, recommendations: ['Проверить готовность смены.', 'После первых чеков открыть аналитику повторно.'], exampleQuestions: ['Что сделать сегодня?', 'Какой план на неделю?', 'Какие риски есть сейчас?'] }
  };
}

export async function getSupabaseSummary({ restaurantId = 'all', date, period = 'day' } = {}) {
  const restaurants = await supabaseFetch('/rest/v1/restaurants?select=id,name,city,is_active&is_active=eq.true').catch(() => null);
  if (!Array.isArray(restaurants) || !restaurants.length) return null;

  const range = getRange({ date: date && date !== 'today' ? date : undefined, period });
  const { previousStart, previousEnd } = getPreviousRange(range);
  const start90 = dateMinusDays(range.endDate, 89);
  const queryStart = previousStart < start90 ? previousStart : start90;

  const activeRestaurantIds = restaurantId === 'all' ? restaurants.map((item) => item.id) : [restaurantId];
  const selectedRestaurants = restaurantId === 'all' ? restaurants : restaurants.filter((item) => item.id === restaurantId);
  if (!selectedRestaurants.length) return null;

  const allRestaurantIds = restaurants.map((item) => item.id);
  const [allKpis, allDailyRows, dishRows, waiterRows, channelRows, kpiSalesRows, hourlyRows] = await Promise.all([
    getKpiSettings(allRestaurantIds),
    getRows('daily_sales', allRestaurantIds, queryStart),
    getRows('dish_sales', activeRestaurantIds, queryStart),
    getRows('waiter_sales', activeRestaurantIds, queryStart),
    getChannelRows(queryStart),
    getKpiSalesRows(queryStart),
    getHourlyRows(queryStart)
  ]);

  const kpis = allKpis.filter((item) => activeRestaurantIds.includes(item.restaurant_id));
  const dailyRows = allDailyRows.filter((item) => activeRestaurantIds.includes(item.restaurant_id));

  const periodRows = dailyRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const previousRows = dailyRows.filter((row) => inDateRange(row, previousStart, previousEnd));
  const periodDishes = dishRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const periodWaiters = waiterRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const selectedKpiRestaurantId = normalizeKpiRestaurantId(restaurantId);
  const channelRowsForSelection = selectedKpiRestaurantId === 'all'
    ? channelRows
    : channelRows.filter((row) => getChannelRestaurantId(row) === selectedKpiRestaurantId);

  const periodChannels = channelRowsForSelection.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const previousChannels = channelRowsForSelection.filter((row) => inDateRange(row, previousStart, previousEnd));
  const hourlyRowsForSelection = restaurantId === 'all'
    ? hourlyRows
    : hourlyRows.filter((row) => !row.restaurant_id || row.restaurant_id === restaurantId || activeRestaurantIds.includes(row.restaurant_id));
  const periodHourly = hourlyRowsForSelection.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const periodKpiBaseRows = kpiSalesRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const previousKpiBaseRows = kpiSalesRows.filter((row) => inDateRange(row, previousStart, previousEnd));

  const periodKpiSales = periodKpiBaseRows.filter((row) => {
    const id = normalizeKpiRestaurantId(row.restaurant_id);

    if (selectedKpiRestaurantId === 'all') return id === 'all';
    return id === selectedKpiRestaurantId;
  });

  const previousKpiSales = previousKpiBaseRows.filter((row) => {
    const id = normalizeKpiRestaurantId(row.restaurant_id);

    if (selectedKpiRestaurantId === 'all') return id === 'all';
    return id === selectedKpiRestaurantId;
  });

  const shouldUseKpiSales = periodKpiSales.length > 0;
  const hasAnyPeriodData = periodKpiSales.length || periodRows.length || periodDishes.length || periodWaiters.length || periodChannels.length || periodHourly.length;
  if (!hasAnyPeriodData) {
    return buildZeroSummary({ restaurantId, restaurants, selectedRestaurants, range, allDailyRows, allKpis });
  }

  const revenueFromKpi = sum(periodKpiSales, 'revenue');
  const prevRevenueFromKpi = sum(previousKpiSales, 'revenue');

  const checksFromKpi = sum(periodKpiSales, 'checks_count');
  const prevChecksFromKpi = sum(previousKpiSales, 'checks_count');

  const guestsFromKpi = sum(periodKpiSales, 'guests_count');
  const prevGuestsFromKpi = sum(previousKpiSales, 'guests_count');

  const avgCheckFromKpi = checksFromKpi
    ? Math.round(revenueFromKpi / checksFromKpi)
    : Math.round(average(periodKpiSales, 'avg_check'));

  const prevAvgCheckFromKpi = prevChecksFromKpi
    ? Math.round(prevRevenueFromKpi / prevChecksFromKpi)
    : Math.round(average(previousKpiSales, 'avg_check'));

  const avgGuestFromKpi = guestsFromKpi
    ? Math.round(revenueFromKpi / guestsFromKpi)
    : Math.round(average(periodKpiSales, 'avg_guest'));

  const revenue = revenueFromKpi || sum(periodRows, 'revenue');
  const prevRevenue = prevRevenueFromKpi || sum(previousRows, 'revenue');

  const checksFromChannels = sum(periodChannels, 'checks_count');
  const prevChecksFromChannels = sum(previousChannels, 'checks_count');

  const guestsFromChannels = sum(periodChannels, 'guests_count');

  const discountsFromChannels = sum(periodChannels, 'discount_sum');
  const prevDiscountsFromChannels = sum(previousChannels, 'discount_sum');

  const checks = checksFromKpi || checksFromChannels || sum(periodRows, 'checks_count');
  const prevChecks = prevChecksFromKpi || prevChecksFromChannels || sum(previousRows, 'checks_count');

  const guests = guestsFromKpi || guestsFromChannels || sum(periodRows, 'guests_count');

  const discounts = discountsFromChannels || sum(periodRows, 'discount_sum');
  const prevDiscounts = prevDiscountsFromChannels || sum(previousRows, 'discount_sum');

  const avgCheck = avgCheckFromKpi || (checks ? Math.round(revenue / checks) : Math.round(average(periodRows, 'avg_check')));
  const prevAvgCheck = prevAvgCheckFromKpi || (prevChecks ? Math.round(prevRevenue / prevChecks) : Math.round(average(previousRows, 'avg_check')));
  const avgGuest = avgGuestFromKpi || (guests ? Math.round(revenue / guests) : 0);

  const foodcostDishRows = cleanDishRows(periodDishes).filter((row) => toNumber(row.revenue) > 0 && toNumber(row.cost) > 0);
  const foodcostDishRevenue = sum(foodcostDishRows, 'revenue');
  const foodcostDishCost = sum(foodcostDishRows, 'cost');
  const foodcostFromDishes = foodcostDishRevenue ? (foodcostDishCost / foodcostDishRevenue) * 100 : 0;
  const foodcostFromDailyRows = weightedPercent(periodRows);
  const foodcostAvailable = foodcostFromDishes > 0 || periodRows.some((row) => toNumber(row.foodcost_percent) > 0);
  const foodcost = foodcostAvailable ? Number((foodcostFromDishes || foodcostFromDailyRows || 0).toFixed(1)) : 0;
  const kpiBase = kpis[0] || {};
  const avgCheckTarget = toNumber(kpiBase.avg_check_target) || 2200;
  const foodcostTarget = toNumber(kpiBase.foodcost_max) || 30;
  const discountMax = toNumber(kpiBase.discount_max) || 9000;
  const defaultPlan = range.period === 'month' ? DEFAULT_MONTHLY_PLAN : range.period === 'week' ? DEFAULT_WEEKLY_PLAN : DEFAULT_DAILY_PLAN;
  const planRevenue = sum(periodRows, 'plan_revenue') || defaultPlan;

  const revenueDelta = prevRevenue ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
  const checksDelta = prevChecks ? ((checks - prevChecks) / prevChecks) * 100 : 0;
  const avgCheckDelta = prevAvgCheck ? ((avgCheck - prevAvgCheck) / prevAvgCheck) * 100 : ((avgCheck - avgCheckTarget) / avgCheckTarget) * 100;
  const discountDelta = prevDiscounts ? ((discounts - prevDiscounts) / prevDiscounts) * 100 : 0;
  const planPercent = planRevenue ? Math.round((revenue / planRevenue) * 100) : 0;

  const allRestaurantCards = buildRestaurantCards(restaurants, allDailyRows, allKpis, range, kpiSalesRows);
  const networkRevenue = allRestaurantCards.reduce((total, item) => total + item.revenue, 0);
  const networkPlan = allRestaurantCards.reduce((total, item) => total + item.plan, 0);
  const networkChecks = allRestaurantCards.reduce((total, item) => total + item.checks, 0);
  const networkAvgCheck = networkChecks ? Math.round(networkRevenue / networkChecks) : 0;
  const activeRestaurant = restaurantId === 'all'
    ? { id: 'all', name: 'Вся сеть', city: selectedRestaurants[0]?.city || 'Город', revenue, plan: planRevenue, avgCheck, checks, guests }
    : { id: selectedRestaurants[0].id, name: selectedRestaurants[0].name, city: selectedRestaurants[0].city || 'Город', revenue, plan: planRevenue, avgCheck, checks, guests };

  const topDishes = aggregateDishes(periodDishes).slice(0, 8);
  const lowDishes = [...aggregateDishes(periodDishes)]
    .filter((item) => item.rawRevenue >= 500 && item.rawAmount >= 2)
    .sort((a, b) => a.rawRevenue - b.rawRevenue)
    .slice(0, 5)
    .map((item) => ({ ...item, issue: 'низкая выручка за выбранный период' }));
  const categories = aggregateCategories(periodDishes).slice(0, 10);
  const waiters = aggregateWaiters(periodWaiters, avgCheckTarget).slice(0, 12);
  const weakWaiter = waiters.length ? [...waiters].sort((a, b) => a.rawRevenue - b.rawRevenue)[0] : null;
  const salesChannels = aggregateChannels(periodChannels, revenue);
  const trendRows = shouldUseKpiSales
    ? kpiSalesRows.filter((row) => {
        const id = normalizeKpiRestaurantId(row.restaurant_id);

        if (selectedKpiRestaurantId === 'all') return id === 'all';
        return id === selectedKpiRestaurantId;
      })
    : dailyRows;
  const week = buildTrend(trendRows, range.period === 'day' ? dateMinusDays(range.endDate, 6) : range.startDate, range.endDate);
  const hourlyAnalytics = buildHourlyAnalytics(periodHourly, revenue);
  const discountAnalytics = buildDiscountAnalytics(periodChannels, range.startDate, range.endDate, revenue);

  const avgCheckLoss = Math.max((avgCheckTarget - avgCheck) * checks, 0);
  const foodcostLoss = foodcostAvailable ? Math.max(Math.round(revenue * ((foodcost - foodcostTarget) / 100)), 0) : 0;
  const discountPercent = discountAnalytics.percent;
  const discountPercentStatus = discountAnalytics.status;
  const discountComfortPercent = 5;
  const discountLoss = discountPercentStatus === 'good'
    ? 0
    : Math.max(Math.round(revenue * ((discountPercent - discountComfortPercent) / 100)), 0);
  const planGap = Math.max(planRevenue - revenue, 0);
  const totalLoss = avgCheckLoss + foodcostLoss + discountLoss;

  const weekStartDate = weekStartMonday(range.endDate);
  const weekKpiRows = kpiSalesRows.filter((row) => {
    const id = normalizeKpiRestaurantId(row.restaurant_id);
    if (!inDateRange(row, weekStartDate, range.endDate)) return false;
    if (selectedKpiRestaurantId === 'all') return id === 'all';
    return id === selectedKpiRestaurantId;
  });
  const weekFallbackRows = dailyRows.filter((row) => inDateRange(row, weekStartDate, range.endDate));
  const weekRevenueActual = range.period === 'week'
    ? revenue
    : (sum(weekKpiRows, 'revenue') || sum(weekFallbackRows, 'revenue') || 0);
  const elapsedWeekDays = Math.min(daysBetweenInclusive(weekStartDate, range.endDate), 7);
  const totalWeekDays = 7;
  const weeklyTempo = elapsedWeekDays ? Math.round(weekRevenueActual / elapsedWeekDays) : 0;
  const projectedWeek = Math.round(weeklyTempo * totalWeekDays);
  const weekPlan = DEFAULT_WEEKLY_PLAN;
  const weekGap = Math.max(weekPlan - projectedWeek, 0);
  const weekRisk = projectedWeek < weekPlan ? 'Риск не выполнить недельный план' : 'Недельный план можно выполнить';

  const monthStartDate = monthStart(range.endDate);
  const monthKpiRows = kpiSalesRows.filter((row) => {
    const id = normalizeKpiRestaurantId(row.restaurant_id);
    if (!inDateRange(row, monthStartDate, range.endDate)) return false;
    if (selectedKpiRestaurantId === 'all') return id === 'all';
    return id === selectedKpiRestaurantId;
  });
  const monthFallbackRows = dailyRows.filter((row) => inDateRange(row, monthStartDate, range.endDate));
  const monthRevenueActual = sum(monthKpiRows, 'revenue') || sum(monthFallbackRows, 'revenue') || (range.period === 'month' ? revenue : 0);
  const elapsedMonthDays = daysBetweenInclusive(monthStartDate, range.endDate);
  const totalMonthDays = daysInMonth(range.endDate);
  const monthlyTempo = elapsedMonthDays ? Math.round(monthRevenueActual / elapsedMonthDays) : 0;
  const projectedMonth = Math.round(monthlyTempo * totalMonthDays);
  const monthPlan = DEFAULT_MONTHLY_PLAN;
  const monthGap = Math.max(monthPlan - projectedMonth, 0);
  const monthRisk = projectedMonth < monthPlan ? 'Риск не выполнить месячный план' : 'Месячный план можно выполнить';

  const projected = range.period === 'month'
    ? projectedMonth
    : range.period === 'week'
      ? projectedWeek
      : Math.round(revenue * 1.12);
  const avgCheckIsOnTarget = avgCheck >= avgCheckTarget;
  const avgCheckGap = Math.max(avgCheckTarget - avgCheck, 0);
  const avgCheckFocusText = avgCheckIsOnTarget
    ? `Средний чек ${formatMoney(avgCheck)} выше цели ${formatMoney(avgCheckTarget)}. Фокус: удержать уровень, а не давить на команду лишними допродажами.`
    : `Средний чек ${formatMoney(avgCheck)} ниже цели ${formatMoney(avgCheckTarget)}. Фокус: допродажа напитков, десертов и комбо.`;
  const waiterCautionText = 'По официантам сейчас безопасно смотреть выручку. Средний чек официантов требует калибровки, потому что waiter_sales может завышать количество чеков.';
  const forecastRecommendations = [
    'Проверить план-факт выручки.',
    hourlyAnalytics.bestHour ? `Усилить смену и кухню в главный пик ${hourlyAnalytics.bestHour.label}.` : 'После загрузки почасовки проверить пики продаж.',
    avgCheckIsOnTarget ? 'Удерживать текущий средний чек и не ломать рабочие связки продаж.' : 'Поставить фокус на средний чек через напитки, десерты и комбо.',
    discounts ? (discountAnalytics.worstChannel ? `Проверить скидки в канале ${discountAnalytics.worstChannel.name}: ${discountAnalytics.worstChannel.percentText}.` : 'Разобрать скидки по дням и каналам, особенно если процент выше обычного.') : 'Продолжать отслеживать скидки.',
    foodcostAvailable ? 'Сравнить фудкост с нормой.' : 'Подключить себестоимость iiko отдельно, без фейковых процентов.'
  ];
  const aiRecommendations = [
    'Проверить план-факт и прогноз до конца периода.',
    hourlyAnalytics.bestHour ? `Проверить пик ${hourlyAnalytics.bestHour.label}: ${hourlyAnalytics.bestHour.revenueText}.` : 'Подключить/проверить почасовую аналитику.',
    avgCheckIsOnTarget ? 'Сохранить текущий средний чек выше цели.' : 'Поднять средний чек через точечные допродажи.',
    discountAnalytics.worstDay ? `Разобрать скидки по дням: максимум ${discountAnalytics.worstDay.label}, ${discountAnalytics.worstDay.percentText}.` : 'Разобрать скидки по дням и каналам.',
    'Использовать рейтинг блюд для продвижения сильных позиций без обещаний по марже до подключения себестоимости.',
    'Подключить себестоимость для точной маржи и фудкоста.'
  ];

  const metrics = [
    metric('Выручка', 'revenue', revenue, `${planPercent}% плана`, planPercent >= 85 ? 'good' : planPercent >= 60 ? 'warn' : 'bad'),
    metric('Чеки', 'checks', checks, percent(checksDelta), statusFromDelta(checksDelta), (value) => String(Math.round(value))),
    metric('Средний чек', 'avgCheck', avgCheck, percent(avgCheckDelta), avgCheck >= avgCheckTarget ? 'good' : 'bad'),
    metric('Гости', 'guests', guests, 'из iiko', guests ? 'good' : 'neutral', (value) => String(Math.round(value))),
    metric('Средний чек гостя', 'avgGuest', avgGuest, guests ? 'из гостей' : 'нет гостей', guests ? 'good' : 'neutral'),
    metric('Фудкост', 'foodcost', foodcost, foodcostAvailable ? `${(foodcost - foodcostTarget).toFixed(1)} п.п.` : 'не подключено', foodcostAvailable ? (foodcost <= foodcostTarget ? 'good' : 'bad') : 'neutral', foodcostAvailable ? (value) => `${Number(value).toFixed(1)}%` : () => 'не подключено', { disabled: !foodcostAvailable }),
    metric('Скидки', 'discounts', discounts, `${discountPercent}% от продаж`, discountPercentStatus)
  ];

  const periodTrend = buildTrend(trendRows, range.startDate, range.endDate);
  const bestTrendDay = [...periodTrend].sort((a, b) => b.revenue - a.revenue)[0];
  const weakTrendDay = [...periodTrend].filter((item) => item.revenue > 0).sort((a, b) => a.revenue - b.revenue)[0];
  const bestChannel = salesChannels[0];
  const isDayPeriod = range.period === 'day';

  return {
    dataMode: 'supabase_lumora_v8_discount_analytics_ready',
    isEmptyPeriod: false,
    generatedAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    selectedRestaurantId: activeRestaurant.id,
    restaurant: { id: activeRestaurant.id, name: activeRestaurant.name, city: activeRestaurant.city, currency: '₽', revenue, plan: planRevenue, avgCheck, checks, guests },
    period: { date: range.endDate, startDate: range.startDate, endDate: range.endDate, type: range.period, title: rangeLabel(range.period, range.startDate, range.endDate), compareTitle: 'к предыдущему периоду', range30: `${start90} — ${range.endDate}` },
    dataRange: { currentDate: range.endDate, start30: dateMinusDays(range.endDate, 29), start90, waiters: 'выбранный период', dishes: 'выбранный период', audit: `${start90} — ${range.endDate}` },
    plan: { dailyRevenue: DEFAULT_DAILY_PLAN, weeklyRevenue: DEFAULT_WEEKLY_PLAN, monthlyRevenue: DEFAULT_MONTHLY_PLAN, avgCheck: avgCheckTarget, foodcostMax: foodcostTarget, discountMax, activeRevenue: planRevenue },
    metrics,
    salesChannels,
    channels: salesChannels,
    topDishes,
    topDishes30Days: aggregateDishes(dishRows.filter((row) => inDateRange(row, dateMinusDays(range.endDate, 29), range.endDate))).slice(0, 10),
    lowDishes,
    categories,
    waiters,
    waiters30Days: aggregateWaiters(waiterRows.filter((row) => inDateRange(row, dateMinusDays(range.endDate, 29), range.endDate)), avgCheckTarget).slice(0, 10),
    week,
    hourly: hourlyAnalytics.hours,
    hourlyAnalytics,
    hourlyPeaks: hourlyAnalytics.peaks,
    weakHours: hourlyAnalytics.weakHours,
    discountAnalytics,
    discountByChannels: discountAnalytics.channels,
    discountByDays: discountAnalytics.days,
    discountRiskDays: discountAnalytics.riskyDays,
    network: { selectedRestaurantId: activeRestaurant.id, restaurants: allRestaurantCards, totals: { revenue: networkRevenue, plan: networkPlan, percent: networkPlan ? Math.round((networkRevenue / networkPlan) * 100) : 0, avgCheck: networkAvgCheck, checks: networkChecks, weakPoints: allRestaurantCards.filter((item) => item.status !== 'good').length }, ai: `Lumora анализирует период ${range.startDate} — ${range.endDate}.` },
    moments: [
      isDayPeriod
        ? { title: 'Выручка дня', text: `${formatMoney(revenue)} за ${range.endDate}`, level: planPercent >= 85 ? 'good' : planPercent >= 60 ? 'warn' : 'bad' }
        : bestTrendDay ? { title: 'Лучший день периода', text: `${bestTrendDay.day}: ${formatMoney(bestTrendDay.revenue)}`, level: 'good' } : null,

      !isDayPeriod && weakTrendDay
        ? { title: 'Слабый день периода', text: `${weakTrendDay.day}: ${formatMoney(weakTrendDay.revenue)}`, level: 'warn' }
        : null,

      bestChannel
        ? { title: 'Главный источник выручки', text: `${bestChannel.name}: ${bestChannel.revenueText}, ${bestChannel.share}%`, level: 'good' }
        : null,

      hourlyAnalytics.bestHour
        ? { title: 'Пик продаж по часам', text: `${hourlyAnalytics.bestHour.label}: ${hourlyAnalytics.bestHour.revenueText}`, level: 'good' }
        : null,

      hourlyAnalytics.weakHour && isDayPeriod
        ? { title: 'Слабый час дня', text: `${hourlyAnalytics.weakHour.label}: ${hourlyAnalytics.weakHour.revenueText}`, level: 'warn' }
        : null,

      avgCheck < avgCheckTarget
        ? { title: 'Средний чек ниже цели', text: `${formatMoney(avgCheck)} против цели ${formatMoney(avgCheckTarget)}`, level: 'bad' }
        : { title: 'Средний чек держится', text: `${formatMoney(avgCheck)} при цели ${formatMoney(avgCheckTarget)}`, level: 'good' }
    ].filter(Boolean),
    moneyLosses: [
      { title: 'План-факт выручки', amount: planGap, reason: `${planPercent}% от плана ${formatMoney(planRevenue)}`, action: 'Проверить прогноз, пики продаж и каналы.', level: planGap > 0 ? 'warn' : 'good' },
      avgCheckLoss > 0
        ? { title: 'Средний чек ниже цели', amount: avgCheckLoss, reason: `${checks} чеков × недобор ${formatMoney(avgCheckGap)}`, action: 'Точечно усиливать допродажу напитков, десертов и комбо.', level: 'bad' }
        : { title: 'Средний чек выше цели', amount: 0, reason: `${formatMoney(avgCheck)} при цели ${formatMoney(avgCheckTarget)}`, action: 'Удерживать текущий уровень и не давить на команду лишними допродажами.', level: 'good' },
      foodcostAvailable
        ? { title: foodcostLoss > 0 ? 'Фудкост выше нормы' : 'Фудкост в норме', amount: foodcostLoss, reason: `${foodcost}% против нормы ${foodcostTarget}%`, action: foodcostLoss > 0 ? 'Разобрать себестоимость, списания и закупки.' : 'Продолжать контроль себестоимости.', level: foodcostLoss > 0 ? 'bad' : 'good' }
        : { title: 'Фудкост не подключён', amount: 0, reason: 'Себестоимость iiko ещё не загружена', action: 'Позже найти поле себестоимости/списаний в iiko и подключить отдельно.', level: 'neutral' },
      { title: discountPercentStatus === 'bad' ? 'Скидки в зоне риска' : discountPercentStatus === 'warn' ? 'Скидки требуют контроля' : 'Скидки в норме', amount: discountLoss, reason: `${formatMoney(discounts)} скидок, около ${discountPercent}% от продаж`, action: discountPercentStatus !== 'good' ? (discountAnalytics.worstChannel ? `Проверить канал ${discountAnalytics.worstChannel.name} и день ${discountAnalytics.worstDay?.label || 'с максимальными скидками'}.` : 'Проверить дни и каналы с максимальными скидками.') : 'Продолжать отслеживать процент скидок.', level: discountPercentStatus }
    ],
    totalLoss,
    actionPlan: [
      { role: 'Владелец', title: 'Проверить план-факт', text: `План выполнен на ${planPercent}%. Текущая выручка: ${formatMoney(revenue)}.` },
      { role: 'Управляющий', title: avgCheckIsOnTarget ? 'Удержать средний чек' : 'Поднять средний чек', text: avgCheckFocusText },
      { role: 'Смена', title: hourlyAnalytics.bestHour ? `Усилить пик ${hourlyAnalytics.bestHour.label}` : 'Проверить часы продаж', text: hourlyAnalytics.insight },
      { role: 'Команда', title: 'Официанты: смотреть осторожно', text: weakWaiter ? `${waiterCautionText} По выручке внизу периода: ${weakWaiter.name}.` : waiterCautionText },
      { role: 'Меню', title: topDishes[0] ? `Держать в фокусе ${topDishes[0].name}` : 'Проверить меню', text: topDishes[0] ? `Лидер периода: ${topDishes[0].revenue}. Использовать как сильную позицию недели; маржу подключим после себестоимости.` : 'Нет данных по блюдам за период.' }
    ],
    teamScript: avgCheckIsOnTarget
      ? `Фокус периода: выручка ${formatMoney(revenue)}, средний чек ${formatMoney(avgCheck)} выше цели ${formatMoney(avgCheckTarget)}. Удерживаем качество продаж, не просаживаем скидки, продвигаем сильные блюда: ${topDishes[0]?.name || 'топ позиции меню'}.`
      : `Фокус периода: выручка ${formatMoney(revenue)}, средний чек ${formatMoney(avgCheck)} ниже цели ${formatMoney(avgCheckTarget)}. Предлагать напиток/десерт к каждому второму чеку, контролировать скидки ${formatMoney(discounts)}.`,
    forecast: {
      current: revenue,
      plan: planRevenue,
      projected,
      risk: projected < planRevenue ? 'Риск не выполнить план' : 'План можно выполнить',
      gap: Math.max(planRevenue - projected, 0),
      confidence: week.length >= 7 ? 78 : 55,
      weeklyTempo,
      projectedWeek,
      weekPlan,
      weekGap,
      weekRisk,
      weekElapsedDays: elapsedWeekDays,
      weekTotalDays: totalWeekDays,
      weekRevenueActual,
      monthlyTempo,
      projectedMonth,
      monthPlan,
      monthGap,
      monthRisk,
      monthElapsedDays: elapsedMonthDays,
      monthTotalDays: totalMonthDays,
      monthRevenueActual,
      recommendations: forecastRecommendations
    },
    kpiSettings: [
      { name: 'План дня', value: formatMoney(DEFAULT_DAILY_PLAN), status: 'редактируется в Управлении' },
      { name: 'План недели', value: formatMoney(DEFAULT_WEEKLY_PLAN), status: 'редактируется в Управлении' },
      { name: 'План месяца', value: formatMoney(DEFAULT_MONTHLY_PLAN), status: 'редактируется в Управлении' },
      { name: 'Цель среднего чека', value: formatMoney(avgCheckTarget), status: avgCheck >= avgCheckTarget ? 'выполнена' : 'ниже цели' }
    ],
    alerts: [
      { level: planPercent < 80 ? 'warn' : 'good', title: 'План-факт', text: `Выручка ${formatMoney(revenue)} из ${formatMoney(planRevenue)}: ${planPercent}% плана.` },
      hourlyAnalytics.bestHour ? { level: 'good', title: 'Пик продаж', text: `${hourlyAnalytics.bestHour.label}: ${hourlyAnalytics.bestHour.revenueText}.` } : null,
      { level: avgCheckIsOnTarget ? 'good' : 'bad', title: 'Средний чек', text: avgCheckIsOnTarget ? `${formatMoney(avgCheck)} выше цели ${formatMoney(avgCheckTarget)}.` : `${formatMoney(avgCheck)} ниже цели ${formatMoney(avgCheckTarget)}.` },
      { level: foodcostAvailable ? (foodcost <= foodcostTarget ? 'good' : 'bad') : 'neutral', title: foodcostAvailable ? 'Фудкост' : 'Фудкост не подключён', text: foodcostAvailable ? `${foodcost}% против нормы ${foodcostTarget}%.` : 'Себестоимость iiko ещё не подключена.' },
      { level: discountPercentStatus, title: 'Скидки', text: `${formatMoney(discounts)} — около ${discountPercent}% от продаж.` }
    ].filter(Boolean),
    problems: [
      avgCheckLoss > 0 ? { level: 'bad', title: 'Средний чек ниже цели', impact: `-${formatMoney(avgCheckLoss)}`, reason: `Факт ${formatMoney(avgCheck)}, цель ${formatMoney(avgCheckTarget)}.`, actions: ['Скрипт допродажи напитков и десертов.', 'Проверить средний чек по сменам.', 'Не делать выводы по официантам до калибровки чеков.'] } : null,
      foodcostAvailable
        ? { level: foodcostLoss > 0 ? 'bad' : 'good', title: foodcostLoss > 0 ? 'Фудкост выше нормы' : 'Фудкост в норме', impact: foodcostLoss > 0 ? `-${formatMoney(foodcostLoss)}` : '0 ₽', reason: `Факт ${foodcost}%, норма ${foodcostTarget}%.`, actions: ['Проверить себестоимость по категориям.', 'Сравнить закупки и списания.', 'Найти блюда с высокой себестоимостью.'] }
        : { level: 'neutral', title: 'Фудкост не подключён', impact: 'нет себестоимости', reason: 'Нужно поле себестоимости iiko.', actions: ['Найти OLAP-поле себестоимости.', 'Проверить отчёт по списаниям.', 'Подключить закупки/себестоимость отдельным этапом.'] },
      discountLoss > 0 ? { level: 'warn', title: 'Скидки требуют контроля', impact: `-${formatMoney(discountLoss)}`, reason: `Скидки ${formatMoney(discounts)}, около ${discountPercent}% от продаж.`, actions: ['Проверить дни с высоким процентом скидок.', 'Разобрать скидки по каналам.', 'Позже считать статус скидок по проценту от продаж.'] } : null
    ].filter(Boolean),
    dataQuality: {
      kpi: 'готово: выручка, чеки, гости и средние чеки по всей сети идут из kpi_sales',
      channels: 'готово: выручка по залу, доставке и самовывозу сходится с KPI',
      menu: 'готово: блюда и категории очищены от доставки, модификаторов и служебных позиций',
      hourly: hourlyAnalytics.bestHour ? `готово: главный пик ${hourlyAnalytics.bestHour.label}, ${hourlyAnalytics.bestHour.revenueText}` : 'готово: выручка по часам сходится с KPI',
      discounts: discountAnalytics.worstChannel ? `готово: скидки ${discountAnalytics.percentText}, максимум по каналу ${discountAnalytics.worstChannel.name}` : 'готово: скидки считаются по проценту от продаж',
      waiters: 'частично: выручка по официантам есть, средний чек справочный до калибровки чеков',
      restaurants: 'готово: выручка, чеки, гости и средний чек по точкам идут из kpi_sales через RestaurantSection',
      foodcost: foodcostAvailable ? 'подключено' : 'не подключено: себестоимость iiko нужно добавить отдельным этапом'
    },
    dataSources: [
      { name: 'iiko → n8n → Supabase', status: 'подключено', hint: 'Основные продажи, блюда, официанты и каналы.' },
      { name: 'Себестоимость / фудкост', status: foodcostAvailable ? 'подключено' : 'ожидает поля iiko', hint: 'Без себестоимости фудкост не рисуется фейково.' }
    ],
    ai: { summary: `Lumora видит ${formatMoney(revenue)} выручки за ${rangeLabel(range.period, range.startDate, range.endDate)}. План выполнен на ${planPercent}%, средний чек ${formatMoney(avgCheck)}, чеки ${checks}, гости ${guests}. ${hourlyAnalytics.bestHour ? `Пик продаж: ${hourlyAnalytics.bestHour.label}. ` : ''}${avgCheckIsOnTarget ? 'Средний чек выше цели, главный фокус — план-факт и скидки.' : 'Средний чек ниже цели, нужен фокус на допродажи.'}`, recommendations: aiRecommendations, exampleQuestions: ['Где мы теряем деньги?', 'Что сделать сегодня?', 'Какие блюда продвигать?', 'Кто из официантов просел?', 'Сформируй план на неделю', 'Какие риски сейчас?', 'Сделай отчёт владельцу'] }
  };
}
