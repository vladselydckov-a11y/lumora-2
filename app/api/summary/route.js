import { NextResponse } from 'next/server';
import { getSupabaseSummary } from '../../../lib/supabaseServer';
import { assertApiAccess } from '../../../lib/saasAccessGuard';

function formatMoney(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₽`;
}

function metric(label, key, raw, delta, status, formatter = formatMoney, extra = {}) {
  return { key, label, value: formatter(raw), raw, delta, status, ...extra };
}

function buildNoDataSummary({ restaurantId, date, period, reason = 'Supabase не вернул реальные данные' }) {
  const plan = period === 'month' ? 3000000 : period === 'week' ? 500000 : 150000;
  const selectedDate = date || new Date().toISOString().slice(0, 10);
  const title = reason.includes('ENV') || reason.includes('Supabase')
    ? 'Нет подключения к реальным данным'
    : 'Продаж за выбранный период пока нет';

  return {
    dataMode: 'strict_no_demo_data',
    isEmptyPeriod: true,
    generatedAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    selectedRestaurantId: restaurantId || 'all',
    restaurant: { id: restaurantId || 'all', name: restaurantId === 'all' ? 'Вся сеть' : 'Ресторан', city: 'Тюмень', currency: '₽', revenue: 0, plan, avgCheck: 0, checks: 0, guests: 0 },
    period: { date: selectedDate, startDate: selectedDate, endDate: selectedDate, type: period || 'day', title: period === 'week' ? 'Неделя' : period === 'month' ? 'Месяц' : 'Сегодня', compareTitle: 'к предыдущему периоду', range30: selectedDate },
    dataRange: { currentDate: selectedDate, start30: selectedDate, start90: selectedDate, waiters: 'нет данных', dishes: 'нет данных', audit: 'нет данных' },
    plan: { dailyRevenue: 150000, weeklyRevenue: 500000, monthlyRevenue: 3000000, avgCheck: 2200, foodcostMax: 30, discountMax: 9000, activeRevenue: plan },
    metrics: [
      metric('Выручка', 'revenue', 0, '0% плана', 'neutral'),
      metric('Чеки', 'checks', 0, 'нет чеков', 'neutral', (value) => String(Math.round(value))),
      metric('Средний чек', 'avgCheck', 0, 'нет чеков', 'neutral'),
      metric('Гости', 'guests', 0, 'нет гостей', 'neutral', (value) => String(Math.round(value))),
      metric('Средний чек гостя', 'avgGuest', 0, 'нет гостей', 'neutral'),
      metric('Фудкост', 'foodcost', 0, 'не подключено', 'neutral', () => 'не подключено', { disabled: true }),
      metric('Скидки', 'discounts', 0, 'нет скидок', 'neutral')
    ],
    salesChannels: [],
    channels: [],
    topDishes: [],
    topDishes30Days: [],
    lowDishes: [],
    categories: [],
    waiters: [],
    waiters30Days: [],
    week: [],
    network: { selectedRestaurantId: restaurantId || 'all', restaurants: [], totals: { revenue: 0, plan, percent: 0, avgCheck: 0, checks: 0, weakPoints: 0 }, ai: title },
    moments: [],
    moneyLosses: [{ title, amount: 0, reason, action: 'Проверь ENV в Vercel и таблицы Supabase. Фейковые цифры отключены.', level: 'neutral' }],
    totalLoss: 0,
    actionPlan: [{ role: 'Lumora', title, text: 'Lumora не подставляет демо-цифры. После подключения Supabase появятся реальные данные.' }],
    teamScript: 'Реальные данные пока не получены. Демо-цифры отключены.',
    forecast: { current: 0, plan, projected: 0, risk: title, gap: plan, confidence: 0, recommendations: ['Проверить SUPABASE_URL.', 'Проверить SUPABASE_SERVICE_ROLE_KEY.', 'Проверить USE_SUPABASE=true.'] },
    kpiSettings: [
      { name: 'План дня', value: formatMoney(150000), status: 'редактируется в Управлении' },
      { name: 'План недели', value: formatMoney(500000), status: 'редактируется в Управлении' },
      { name: 'План месяца', value: formatMoney(3000000), status: 'редактируется в Управлении' }
    ],
    alerts: [{ level: 'warn', title, text: reason }],
    problems: [],
    dataSources: [{ name: 'iiko → n8n → Supabase', status: 'нет реального ответа', hint: reason }],
    ai: { summary: title, recommendations: ['Подключить реальные ENV.', 'Проверить /api/summary.', 'Не показывать клиенту до появления реальных данных.'], exampleQuestions: ['Почему нет данных?', 'Что проверить в подключении?', 'Какие таблицы нужны?'] }
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || 'all';
  const date = searchParams.get('date') || undefined;
  const period = searchParams.get('period') || 'day';

  const guard = await assertApiAccess(request, { restaurantId, section: 'today' });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  if (process.env.USE_SUPABASE === 'true') {
    const realSummary = await getSupabaseSummary({ restaurantId, date, period }).catch((error) => {
      console.error('Supabase summary error:', error);
      return { __error: error?.message || 'Supabase error' };
    });

    if (realSummary && !realSummary.__error) return NextResponse.json(realSummary);
    return NextResponse.json(buildNoDataSummary({ restaurantId, date, period, reason: realSummary?.__error || 'Supabase не вернул реальные данные' }));
  }

  return NextResponse.json(buildNoDataSummary({
    restaurantId,
    date,
    period,
    reason: 'USE_SUPABASE не равен true. Демо-цифры отключены, чтобы не показывать выдуманные показатели.'
  }));
}
