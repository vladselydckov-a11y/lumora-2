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

function levelForRow(row) {
  const loss = toNumber(row?.estimated_loss);
  const minutes = toNumber(row?.minutes_in_stop);
  if (loss >= 5000 || minutes >= 360) return 'bad';
  if (loss > 0 || minutes >= 60) return 'warn';
  return 'neutral';
}

function formatDuration(row) {
  const minutes = toNumber(row?.minutes_in_stop);
  if (!minutes) return row?.duration_text || '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} ч ${rest} мин в стопе`;
  if (hours) return `${hours} ч в стопе`;
  return `${minutes} мин в стопе`;
}

function normalizeStopRows(rows) {
  const items = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: row.id,
      businessDate: row.business_date,
      restaurantId: row.restaurant_id,
      itemName: row.item_name || row.name || 'Позиция без названия',
      category: row.category || row.group_name || 'Меню',
      status: row.status || 'active',
      reason: row.reason || formatDuration(row) || 'Позиция сейчас недоступна для продажи.',
      startedAt: row.started_at,
      startedAtText: row.started_at ? String(row.started_at).slice(11, 16) : '',
      minutesInStop: toNumber(row.minutes_in_stop),
      durationText: formatDuration(row),
      estimatedLoss: toNumber(row.estimated_loss),
      estimatedLossText: formatMoney(row.estimated_loss),
      level: row.level || levelForRow(row),
      source: row.source || 'stop_list_items',
      updatedAt: row.updated_at
    }))
    .filter((row) => row.status !== 'hidden')
    .sort((a, b) => b.estimatedLoss - a.estimatedLoss);

  const totalLoss = items.reduce((sum, item) => sum + toNumber(item.estimatedLoss), 0);
  const activeCount = items.filter((item) => item.status !== 'resolved').length;

  return {
    items,
    activeCount,
    totalLoss,
    totalLossText: formatMoney(totalLoss),
    criticalCount: items.filter((item) => item.level === 'bad').length
  };
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
      `/rest/v1/stop_list_items?select=*&business_date=gte.${startDate}&business_date=lte.${endDate}${restaurantFilter}&order=estimated_loss.desc`,
      { headers: { Prefer: 'return=representation' } }
    );

    const normalized = normalizeStopRows(rows);

    return NextResponse.json({
      ok: true,
      source: 'stop_list_items',
      selectedRestaurantId: restaurantId,
      period,
      startDate,
      endDate,
      hasStopListData: normalized.items.length > 0,
      ...normalized
    });
  } catch (error) {
    console.error('stop-list error:', error);
    return NextResponse.json({
      ok: true,
      source: 'stop_list_items',
      selectedRestaurantId: restaurantId,
      period,
      startDate,
      endDate,
      hasStopListData: false,
      items: [],
      activeCount: 0,
      totalLoss: 0,
      totalLossText: formatMoney(0),
      warning: error?.message || 'stop_list_items unavailable'
    });
  }
}
