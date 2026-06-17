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

function daysBetweenInclusive(startDate, endDate) {
  const start = dateToUTC(startDate);
  const end = dateToUTC(endDate);
  return Math.max(Math.round((end - start) / 86400000) + 1, 1);
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
  if (normalized === 'week') return { period: normalized, startDate: dateMinusDays(endDate, 6), endDate };
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

async function getRows(table, restaurantIds, startDate) {
  const filter = buildInFilter('restaurant_id', restaurantIds);
  const startFilter = startDate ? `&business_date=gte.${startDate}` : '';
  const rows = await supabaseFetch(`/rest/v1/${table}?select=*${filter}${startFilter}&order=business_date.desc&limit=6000`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function aggregateDishes(rows) {
  const grouped = groupBy(rows, (row) => `${row.dish_name || 'Без названия'}|||${row.category_name || 'Меню'}`);
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
      ai: cost ? (foodcost > 35 ? 'Проверить себестоимость' : quantity < 20 ? 'Продвинуть в скриптах' : 'Норма') : 'Нужна себестоимость из iiko'
    };
  }).sort((a, b) => b.rawRevenue - a.rawRevenue);
}

function aggregateCategories(rows) {
  const grouped = groupBy(rows, (row) => row.category_name || 'Меню');
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
  const grouped = groupBy(rows, (row) => row.waiter_name || 'Без имени');
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
      upsell: avgCheck >= avgCheckTarget ? 'сильная' : avgCheck >= avgCheckTarget * 0.9 ? 'средняя' : 'слабая',
      status: avgCheck >= avgCheckTarget ? 'Лидер / норма' : 'Нужна работа',
      advice: avgCheck >= avgCheckTarget ? 'Закрепить как пример для смены' : 'Дать скрипт допродажи напитков и десертов'
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
    const channel = list[0] || {};
    return {
      key,
      name: channel.channel_name || 'Канал',
      revenue,
      revenueText: formatMoney(revenue),
      discounts,
      discountsText: formatMoney(discounts),
      checks,
      guests,
      avgCheck: checks ? Math.round(revenue / checks) : Math.round(average(list, 'avg_check')),
      share: revenueBase ? Math.round((revenue / revenueBase) * 100) : 0,
      source: channel.source || 'iiko'
    };
  }).filter((item) => item.revenue || item.checks || item.guests).sort((a, b) => b.revenue - a.revenue);
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

function buildRestaurantCards(restaurants, dailyRows, kpis, currentDate) {
  return restaurants.map((restaurant) => {
    const row = dailyRows.find((item) => item.restaurant_id === restaurant.id && item.business_date === currentDate) || {};
    const kpi = kpis.find((item) => item.restaurant_id === restaurant.id) || {};
    const revenue = toNumber(row.revenue);
    const checks = toNumber(row.checks_count);
    const guests = toNumber(row.guests_count);
    const avgCheck = checks ? Math.round(revenue / checks) : Math.round(toNumber(row.avg_check));
    const plan = toNumber(row.plan_revenue) || toNumber(kpi.daily_revenue_plan) || DEFAULT_DAILY_PLAN;
    const avgTarget = toNumber(kpi.avg_check_target) || 2200;
    const percentPlan = plan ? Math.round((revenue / plan) * 100) : 0;
    const status = percentPlan < 60 || avgCheck < avgTarget * 0.85 ? 'bad' : percentPlan < 85 || avgCheck < avgTarget ? 'warn' : 'good';
    const problem = status === 'good' ? 'норма' : avgCheck < avgTarget ? 'средний чек' : 'выручка';
    return { id: restaurant.id, name: restaurant.name, city: restaurant.city || 'Город', revenue, plan, avgCheck, checks, guests, problem, status };
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
  const restaurantCards = buildRestaurantCards(restaurants, allDailyRows, allKpis, range.endDate);
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
    network: { selectedRestaurantId: activeRestaurant.id, restaurants: restaurantCards, totals: { revenue: 0, plan: planRevenue, percent: 0, avgCheck: 0, checks: 0, weakPoints: 0 }, ai: title },
    moneyLosses: [{ title, amount: 0, reason: 'Lumora ждёт первые чеки из iiko.', action: 'После первого чека n8n запишет данные, и экран обновится автоматически.', level: 'neutral' }],
    totalLoss: 0,
    actionPlan: [{ role: 'Lumora', title, text: 'Пока можно проверить готовность смены, цели по среднему чеку и план на день.' }],
    teamScript: 'Продаж пока нет. После первого чека Lumora сформирует скрипт для смены на основе фактических данных.',
    forecast: { current: 0, plan: planRevenue, projected: 0, risk: 'Продаж пока нет', gap: planRevenue, confidence: 0, recommendations: ['Дождаться первых чеков.', 'Проверить план и цель среднего чека в Управлении.'] },
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
  const [allKpis, allDailyRows, dishRows, waiterRows, channelRows] = await Promise.all([
    getKpiSettings(allRestaurantIds),
    getRows('daily_sales', allRestaurantIds, queryStart),
    getRows('dish_sales', activeRestaurantIds, queryStart),
    getRows('waiter_sales', activeRestaurantIds, queryStart),
    getChannelRows(queryStart)
  ]);

  const kpis = allKpis.filter((item) => activeRestaurantIds.includes(item.restaurant_id));
  const dailyRows = allDailyRows.filter((item) => activeRestaurantIds.includes(item.restaurant_id));

  const periodRows = dailyRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const previousRows = dailyRows.filter((row) => inDateRange(row, previousStart, previousEnd));
  const periodDishes = dishRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const periodWaiters = waiterRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const periodChannels = channelRows.filter((row) => inDateRange(row, range.startDate, range.endDate));
  const previousChannels = channelRows.filter((row) => inDateRange(row, previousStart, previousEnd));

  const hasAnyPeriodData = periodRows.length || periodDishes.length || periodWaiters.length || periodChannels.length;
  if (!hasAnyPeriodData) {
    return buildZeroSummary({ restaurantId, restaurants, selectedRestaurants, range, allDailyRows, allKpis });
  }

  const revenue = sum(periodRows, 'revenue');
  const prevRevenue = sum(previousRows, 'revenue');
  const checksFromChannels = sum(periodChannels, 'checks_count');
  const prevChecksFromChannels = sum(previousChannels, 'checks_count');
  const guestsFromChannels = sum(periodChannels, 'guests_count');
  const discountsFromChannels = sum(periodChannels, 'discount_sum');
  const prevDiscountsFromChannels = sum(previousChannels, 'discount_sum');
  const checks = checksFromChannels || sum(periodRows, 'checks_count');
  const prevChecks = prevChecksFromChannels || sum(previousRows, 'checks_count');
  const guests = guestsFromChannels || sum(periodRows, 'guests_count');
  const discounts = discountsFromChannels || sum(periodRows, 'discount_sum');
  const prevDiscounts = prevDiscountsFromChannels || sum(previousRows, 'discount_sum');
  const avgCheck = checks ? Math.round(revenue / checks) : Math.round(average(periodRows, 'avg_check'));
  const prevAvgCheck = prevChecks ? Math.round(prevRevenue / prevChecks) : Math.round(average(previousRows, 'avg_check'));
  const avgGuest = guests ? Math.round(revenue / guests) : 0;

  const foodcostAvailable = periodRows.some((row) => toNumber(row.foodcost_percent) > 0) || periodDishes.some((row) => toNumber(row.cost) > 0);
  const foodcost = foodcostAvailable ? Number(weightedPercent(periodRows).toFixed(1)) : 0;
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

  const allRestaurantCards = buildRestaurantCards(restaurants, allDailyRows, allKpis, range.endDate);
  const networkRevenue = allRestaurantCards.reduce((total, item) => total + item.revenue, 0);
  const networkPlan = allRestaurantCards.reduce((total, item) => total + item.plan, 0);
  const networkChecks = allRestaurantCards.reduce((total, item) => total + item.checks, 0);
  const networkAvgCheck = networkChecks ? Math.round(networkRevenue / networkChecks) : 0;
  const activeRestaurant = restaurantId === 'all'
    ? { id: 'all', name: 'Вся сеть', city: selectedRestaurants[0]?.city || 'Город', revenue, plan: planRevenue, avgCheck, checks, guests }
    : { id: selectedRestaurants[0].id, name: selectedRestaurants[0].name, city: selectedRestaurants[0].city || 'Город', revenue, plan: planRevenue, avgCheck, checks, guests };

  const topDishes = aggregateDishes(periodDishes).slice(0, 8);
  const lowDishes = [...aggregateDishes(periodDishes)].filter((item) => item.rawRevenue > 0).sort((a, b) => a.rawRevenue - b.rawRevenue).slice(0, 5).map((item) => ({ ...item, issue: 'низкая выручка за выбранный период' }));
  const categories = aggregateCategories(periodDishes).slice(0, 8);
  const waiters = aggregateWaiters(periodWaiters, avgCheckTarget).slice(0, 12);
  const weakWaiter = waiters.length ? [...waiters].sort((a, b) => a.rawAvgCheck - b.rawAvgCheck)[0] : null;
  const salesChannels = aggregateChannels(periodChannels, revenue);
  const week = buildTrend(dailyRows, range.period === 'day' ? dateMinusDays(range.endDate, 6) : range.startDate, range.endDate);

  const avgCheckLoss = Math.max((avgCheckTarget - avgCheck) * checks, 0);
  const foodcostLoss = foodcostAvailable ? Math.max(Math.round(revenue * ((foodcost - foodcostTarget) / 100)), 0) : 0;
  const discountLoss = Math.max(discounts - discountMax, 0);
  const planGap = Math.max(planRevenue - revenue, 0);
  const totalLoss = avgCheckLoss + foodcostLoss + discountLoss;
  const projected = range.period === 'day' ? Math.round(revenue * 1.12) : Math.round(revenue * 1.04);

  const metrics = [
    metric('Выручка', 'revenue', revenue, `${planPercent}% плана`, planPercent >= 85 ? 'good' : planPercent >= 60 ? 'warn' : 'bad'),
    metric('Чеки', 'checks', checks, percent(checksDelta), statusFromDelta(checksDelta), (value) => String(Math.round(value))),
    metric('Средний чек', 'avgCheck', avgCheck, percent(avgCheckDelta), avgCheck >= avgCheckTarget ? 'good' : 'bad'),
    metric('Гости', 'guests', guests, 'из iiko', guests ? 'good' : 'neutral', (value) => String(Math.round(value))),
    metric('Средний чек гостя', 'avgGuest', avgGuest, guests ? 'из гостей' : 'нет гостей', guests ? 'good' : 'neutral'),
    metric('Фудкост', 'foodcost', foodcost, foodcostAvailable ? `${(foodcost - foodcostTarget).toFixed(1)} п.п.` : 'не подключено', foodcostAvailable ? (foodcost <= foodcostTarget ? 'good' : 'bad') : 'neutral', foodcostAvailable ? (value) => `${Number(value).toFixed(1)}%` : () => 'не подключено', { disabled: !foodcostAvailable }),
    metric('Скидки', 'discounts', discounts, percent(discountDelta), discounts <= discountMax ? 'good' : 'bad')
  ];

  const bestTrendDay = [...week].sort((a, b) => b.revenue - a.revenue)[0];
  const weakTrendDay = [...week].filter((item) => item.revenue > 0).sort((a, b) => a.revenue - b.revenue)[0];
  const bestChannel = salesChannels[0];

  return {
    dataMode: 'supabase_lumora_v8_periods',
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
    network: { selectedRestaurantId: activeRestaurant.id, restaurants: allRestaurantCards, totals: { revenue: networkRevenue, plan: networkPlan, percent: networkPlan ? Math.round((networkRevenue / networkPlan) * 100) : 0, avgCheck: networkAvgCheck, checks: networkChecks, weakPoints: allRestaurantCards.filter((item) => item.status !== 'good').length }, ai: `Lumora анализирует период ${range.startDate} — ${range.endDate}.` },
    moments: [
      bestTrendDay ? { title: 'Лучший день/пик периода', text: `${bestTrendDay.day}: ${formatMoney(bestTrendDay.revenue)}`, level: 'good' } : null,
      weakTrendDay ? { title: 'Слабый день периода', text: `${weakTrendDay.day}: ${formatMoney(weakTrendDay.revenue)}`, level: 'warn' } : null,
      bestChannel ? { title: 'Главный источник выручки', text: `${bestChannel.name}: ${bestChannel.revenueText}, ${bestChannel.share}%`, level: 'good' } : null,
      avgCheck < avgCheckTarget ? { title: 'Средний чек ниже цели', text: `${formatMoney(avgCheck)} против цели ${formatMoney(avgCheckTarget)}`, level: 'bad' } : { title: 'Средний чек держится', text: `${formatMoney(avgCheck)} при цели ${formatMoney(avgCheckTarget)}`, level: 'good' }
    ].filter(Boolean),
    moneyLosses: [
      { title: 'План-факт выручки', amount: planGap, reason: `${planPercent}% от плана ${formatMoney(planRevenue)}`, action: 'Проверить прогноз и каналы продаж.', level: planGap > 0 ? 'warn' : 'good' },
      { title: 'Средний чек ниже цели', amount: avgCheckLoss, reason: `${checks} чеков × недобор ${formatMoney(Math.max(avgCheckTarget - avgCheck, 0))}`, action: 'Допродажа напитков, десертов и комбо.', level: avgCheckLoss > 0 ? 'bad' : 'good' },
      { title: 'Фудкост выше нормы', amount: foodcostLoss, reason: foodcostAvailable ? `${foodcost}% против нормы ${foodcostTarget}%` : 'Себестоимость iiko ещё не подключена', action: 'Подключить себестоимость/списания из iiko.', level: foodcostLoss > 0 ? 'bad' : 'neutral' },
      { title: 'Скидки выше лимита', amount: discountLoss, reason: `${formatMoney(discounts)} против лимита ${formatMoney(discountMax)}`, action: 'Разобрать скидки по сменам и сотрудникам.', level: discountLoss > 0 ? 'warn' : 'good' }
    ],
    totalLoss,
    actionPlan: [
      { role: 'Владелец', title: 'Проверить план-факт', text: `План выполнен на ${planPercent}%. Текущая выручка: ${formatMoney(revenue)}.` },
      { role: 'Управляющий', title: 'Поднять средний чек', text: `Факт ${formatMoney(avgCheck)}, цель ${formatMoney(avgCheckTarget)}. Дать смене скрипт допродажи.` },
      { role: 'Команда', title: weakWaiter ? `Разобрать ${weakWaiter.name}` : 'Проверить официантов', text: weakWaiter ? `Средний чек ${weakWaiter.avgCheck}. ${weakWaiter.advice}.` : 'Нет данных по официантам за период.' },
      { role: 'Меню', title: topDishes[0] ? `Продвигать ${topDishes[0].name}` : 'Проверить меню', text: topDishes[0] ? `Лидер периода: ${topDishes[0].revenue}.` : 'Нет данных по блюдам за период.' }
    ],
    teamScript: `Фокус периода: выручка ${formatMoney(revenue)}, средний чек ${formatMoney(avgCheck)} при цели ${formatMoney(avgCheckTarget)}. Предлагать напиток/десерт к каждому второму чеку, контролировать скидки ${formatMoney(discounts)}.`,
    forecast: { current: revenue, plan: planRevenue, projected, risk: projected < planRevenue ? 'Риск не выполнить план' : 'План можно выполнить', gap: planRevenue - projected, confidence: week.length >= 7 ? 78 : 55, recommendations: ['Проверить план-факт.', 'Поставить фокус на средний чек.', 'Разобрать скидки и слабые блюда.'] },
    kpiSettings: [
      { name: 'План дня', value: formatMoney(DEFAULT_DAILY_PLAN), status: 'редактируется в Управлении' },
      { name: 'План недели', value: formatMoney(DEFAULT_WEEKLY_PLAN), status: 'редактируется в Управлении' },
      { name: 'План месяца', value: formatMoney(DEFAULT_MONTHLY_PLAN), status: 'редактируется в Управлении' },
      { name: 'Цель среднего чека', value: formatMoney(avgCheckTarget), status: avgCheck >= avgCheckTarget ? 'выполнена' : 'ниже цели' }
    ],
    alerts: [
      { level: planPercent < 80 ? 'warn' : 'good', title: 'План-факт', text: `Выручка ${formatMoney(revenue)} из ${formatMoney(planRevenue)}: ${planPercent}% плана.` },
      { level: avgCheck >= avgCheckTarget ? 'good' : 'bad', title: 'Средний чек', text: `${formatMoney(avgCheck)} против цели ${formatMoney(avgCheckTarget)}.` },
      { level: foodcostAvailable ? (foodcost <= foodcostTarget ? 'good' : 'bad') : 'neutral', title: 'Фудкост', text: foodcostAvailable ? `${foodcost}% против нормы ${foodcostTarget}%.` : 'Себестоимость iiko ещё не подключена.' },
      { level: discounts <= discountMax ? 'good' : 'warn', title: 'Скидки', text: `${formatMoney(discounts)} против лимита ${formatMoney(discountMax)}.` }
    ],
    problems: [
      { level: avgCheckLoss > 0 ? 'bad' : 'good', title: 'Средний чек', impact: `-${formatMoney(avgCheckLoss)}`, reason: `Факт ${formatMoney(avgCheck)}, цель ${formatMoney(avgCheckTarget)}.`, actions: ['Скрипт допродажи напитков и десертов.', 'Разобрать слабых официантов.', 'Проверить средний чек по сменам.'] },
      { level: foodcostLoss > 0 ? 'bad' : 'neutral', title: 'Фудкост', impact: foodcostAvailable ? `-${formatMoney(foodcostLoss)}` : 'нет себестоимости', reason: foodcostAvailable ? `Факт ${foodcost}%, норма ${foodcostTarget}%.` : 'Нужно поле себестоимости iiko.', actions: ['Найти OLAP-поле себестоимости.', 'Проверить списания.', 'Сравнить закупки.'] },
      { level: discountLoss > 0 ? 'warn' : 'good', title: 'Скидки', impact: `-${formatMoney(discountLoss)}`, reason: `Скидки ${formatMoney(discounts)}, лимит ${formatMoney(discountMax)}.`, actions: ['Проверить ручные скидки.', 'Разобрать скидки по сотрудникам.', 'Ограничить скидки без причины.'] }
    ],
    dataSources: [
      { name: 'iiko → n8n → Supabase', status: 'подключено', hint: 'Основные продажи, блюда, официанты и каналы.' },
      { name: 'Себестоимость / фудкост', status: foodcostAvailable ? 'подключено' : 'ожидает поля iiko', hint: 'Без себестоимости фудкост не рисуется фейково.' }
    ],
    ai: { summary: `Lumora видит ${formatMoney(revenue)} выручки за ${rangeLabel(range.period, range.startDate, range.endDate)}. План выполнен на ${planPercent}%, средний чек ${formatMoney(avgCheck)}, чеки ${checks}, гости ${guests}.`, recommendations: ['Проверить план-факт.', 'Поднять средний чек через скрипты.', 'Разобрать слабые блюда и официантов.', 'Подключить себестоимость для точной маржи.'], exampleQuestions: ['Где мы теряем деньги?', 'Что сделать сегодня?', 'Какие блюда продвигать?', 'Кто из официантов просел?', 'Сформируй план на неделю', 'Какие риски сейчас?', 'Сделай отчёт владельцу'] }
  };
}
