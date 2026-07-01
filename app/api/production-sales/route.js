import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../lib/supabaseServer';
import { assertApiAccess } from '../../../lib/saasAccessGuard';

const DEFAULT_RESTAURANT_ID = 'all';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatMoney(value) {
  return `${Math.round(toNumber(value)).toLocaleString('ru-RU')} ₽`;
}

function dateToUTC(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function addDays(dateString, days) {
  const date = dateToUTC(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStartMonday(dateString) {
  const date = dateToUTC(dateString);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function monthStart(dateString) {
  return `${dateString.slice(0, 8)}01`;
}

function getBusinessDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function getPeriodRange(date, period) {
  const selectedDate = date || getBusinessDate();
  if (period === 'week') {
    const startDate = weekStartMonday(selectedDate);
    return { startDate, endDate: addDays(startDate, 6) };
  }
  if (period === 'month') {
    return { startDate: monthStart(selectedDate), endDate: selectedDate };
  }
  return { startDate: selectedDate, endDate: selectedDate };
}

function normalizeProductionKey(row) {
  const key = String(row?.production_key || row?.production_name || 'other')
    .toLowerCase()
    .trim()
    .replace(/[^a-zа-яё0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'other';
}

function aggregateProductionRows(rows) {
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const revenue = toNumber(row?.revenue);
    if (revenue <= 0) continue;

    const key = normalizeProductionKey(row);
    const name = row?.production_name || row?.source_label || key;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        name,
        revenue: 0,
        grossRevenue: 0,
        discountSum: 0,
        checks: 0,
        guests: 0,
        sourceLabels: new Set()
      });
    }

    const current = grouped.get(key);
    current.name = name || current.name;
    current.revenue += revenue;
    current.grossRevenue += toNumber(row?.gross_revenue);
    current.discountSum += toNumber(row?.discount_sum);
    current.checks += toNumber(row?.checks_count);
    current.guests += toNumber(row?.guests_count);
    if (row?.source_label) current.sourceLabels.add(String(row.source_label));
  }

  const totalRevenue = [...grouped.values()].reduce((sum, item) => sum + item.revenue, 0);

  return [...grouped.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map((item) => ({
      key: item.key,
      name: item.name,
      revenue: Math.round(item.revenue * 100) / 100,
      revenueText: formatMoney(item.revenue),
      grossRevenue: Math.round(item.grossRevenue * 100) / 100,
      discountSum: Math.round(item.discountSum * 100) / 100,
      checks: Math.round(item.checks),
      guests: Math.round(item.guests),
      share: totalRevenue > 0 ? Math.round((item.revenue / totalRevenue) * 1000) / 10 : 0,
      sourceLabels: [...item.sourceLabels].slice(0, 4).map((label) => String(label).length > 90 ? `${String(label).slice(0, 87)}...` : String(label)),
      sourceLabelsText: [...item.sourceLabels].slice(0, 3).join(' / ')
    }));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || DEFAULT_RESTAURANT_ID;
  const period = searchParams.get('period') || 'day';
  const date = searchParams.get('date') || undefined;
  const { startDate, endDate } = getPeriodRange(date, period);

  const guard = await assertApiAccess(request, { restaurantId, section: 'reports' });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  try {
    const restaurantFilter = restaurantId && restaurantId !== 'all'
      ? `&restaurant_id=eq.${encodeURIComponent(restaurantId)}`
      : '';

    const rows = await supabaseFetch(
      `/rest/v1/production_sales?select=*&business_date=gte.${startDate}&business_date=lte.${endDate}${restaurantFilter}&order=revenue.desc`,
      { headers: { Prefer: 'return=representation' } }
    );

    const productionTypes = aggregateProductionRows(rows);
    const totalRevenue = productionTypes.reduce((sum, item) => sum + toNumber(item.revenue), 0);

    return NextResponse.json({
      ok: true,
      source: 'production_sales',
      selectedRestaurantId: restaurantId,
      period,
      startDate,
      endDate,
      hasProductionData: productionTypes.length > 0,
      totalRevenue,
      totalRevenueText: formatMoney(totalRevenue),
      productionTypes
    });
  } catch (error) {
    // Если таблица ещё не создана или n8n не загрузил строки, интерфейс просто не покажет виджет.
    console.error('production-sales error:', error);
    return NextResponse.json({
      ok: true,
      source: 'production_sales',
      selectedRestaurantId: restaurantId,
      period,
      startDate,
      endDate,
      hasProductionData: false,
      productionTypes: [],
      warning: error?.message || 'production_sales unavailable'
    });
  }
}
