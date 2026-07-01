import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../lib/supabaseServer';
import { assertApiAccess } from '../../../lib/saasAccessGuard';

const DEFAULT_RESTAURANT_ID = 'all';
const TYUMEN_TZ = 'Asia/Yekaterinburg';
const KNOWN_RESTAURANTS = ['aziatok', 'akvatoria'];
const GOOD_COVERAGE_PERCENT = 85;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatMoney(value) {
  return `${Math.round(toNumber(value)).toLocaleString('ru-RU')} ₽`;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
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
    timeZone: TYUMEN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour') || 0);
  return hour < 2 ? addDays(date, -1) : date;
}

function normalizePeriod(period) {
  return ['day', 'week', 'month'].includes(period) ? period : 'day';
}

function normalizeRequestedDate(date, period) {
  const selectedDate = String(date || getBusinessDate()).slice(0, 10);

  // Если UI месяца передал 2026-07-01, значит нужен закрытый июнь: 2026-06-01 — 2026-06-30.
  if (period === 'month' && /^\d{4}-\d{2}-01$/.test(selectedDate)) {
    return addDays(selectedDate, -1);
  }

  return selectedDate;
}

function getPeriodRange(date, periodInput) {
  const period = normalizePeriod(periodInput);
  const selectedDate = normalizeRequestedDate(date, period);

  if (period === 'week') {
    const startDate = weekStartMonday(selectedDate);
    return { period, startDate, endDate: selectedDate };
  }

  if (period === 'month') {
    return { period, startDate: monthStart(selectedDate), endDate: selectedDate };
  }

  return { period, startDate: selectedDate, endDate: selectedDate };
}

function restaurantFilterForKpi(restaurantId) {
  if (!restaurantId || restaurantId === 'all') return '&restaurant_id=eq.all';
  return `&restaurant_id=eq.${encodeURIComponent(restaurantId)}`;
}

function restaurantFilterForDetail(restaurantId) {
  if (!restaurantId || restaurantId === 'all') return `&restaurant_id=in.(${KNOWN_RESTAURANTS.join(',')})`;
  return `&restaurant_id=eq.${encodeURIComponent(restaurantId)}`;
}

function sum(rows, field) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => total + toNumber(row?.[field]), 0);
}

async function fetchRows(path) {
  const rows = await supabaseFetch(path, { headers: { Prefer: 'return=representation' } }).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function fetchKpiTotals({ restaurantId, startDate, endDate }) {
  const filter = restaurantFilterForKpi(restaurantId);
  let rows = await fetchRows(`/rest/v1/kpi_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count,avg_check&business_date=gte.${startDate}&business_date=lte.${endDate}${filter}&limit=5000`);

  // На случай если в базе нет строки restaurant_id=all, собираем сеть из боевых точек.
  if ((!rows.length || restaurantId === 'all') && restaurantId === 'all') {
    const networkRows = await fetchRows(`/rest/v1/kpi_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count,avg_check&business_date=gte.${startDate}&business_date=lte.${endDate}&restaurant_id=in.(${KNOWN_RESTAURANTS.join(',')})&limit=5000`);
    if (!rows.length && networkRows.length) rows = networkRows;
  }

  if (!rows.length) {
    const detailFilter = restaurantFilterForDetail(restaurantId);
    rows = await fetchRows(`/rest/v1/daily_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count,avg_check&business_date=gte.${startDate}&business_date=lte.${endDate}${detailFilter}&limit=5000`);
  }

  const revenue = sum(rows, 'revenue');
  const checks = sum(rows, 'checks_count');
  const guests = sum(rows, 'guests_count');
  const avgCheck = checks ? Math.round(revenue / checks) : Math.round((rows.reduce((total, row) => total + toNumber(row?.avg_check), 0) / (rows.length || 1)) || 0);

  return {
    rows,
    revenue: roundMoney(revenue),
    checks: Math.round(checks),
    guests: Math.round(guests),
    avgCheck,
    source: rows.length ? (rows[0]?.restaurant_id === 'all' || rows[0]?.source === 'kpi_sales' ? 'kpi_sales' : 'kpi_or_daily_sales') : 'none'
  };
}

function cleanText(value) {
  return String(value || '').toLowerCase().trim();
}

function normalizeProductionKeyFromText({ key, name, category, dish, source }) {
  const text = `${cleanText(key)} ${cleanText(name)} ${cleanText(category)} ${cleanText(dish)} ${cleanText(source)}`;

  if (text.includes('кальян') || text.includes('hookah')) return 'hookah';
  if (text.includes('бар') || text.includes('б/а') || text.includes('алког') || text.includes('коктейл') || text.includes('напит') || text.includes('лимонад') || text.includes('кофе') || text.includes('чай') || text.includes('вода') || text.includes('cola') || text.includes('coca') || text.includes('латте') || text.includes('капуч') || text.includes('americano') || text.includes('aperol')) return 'bar';
  if (text.includes('суп') || text.includes('горяч') || text.includes('том-ям') || text.includes('том ям') || text.includes('фобо') || text.includes('удон') || text.includes('тяхан') || text.includes('лапша') || text.includes('рис ') || text.includes('вок') || text.includes('hot')) return 'hot';
  if (text.includes('ролл') || text.includes('маки') || text.includes('сет ') || text.includes('сеты') || text.includes('салат') || text.includes('закуск') || text.includes('поке') || text.includes('десерт') || text.includes('холод') || text.includes('cold')) return 'cold';
  if (text.includes('кухн') || text.includes('модификатор') || text.includes('васаби') || text.includes('имбир') || text.includes('соев')) return 'kitchen';

  return 'other';
}

function productionNameForKey(key, fallback) {
  const map = {
    cold: 'Холодный цех',
    hot: 'Горячий цех',
    bar: 'Бар',
    hookah: 'Кальян',
    kitchen: 'Кухня',
    other: 'Другое',
    unallocated: 'Не распределено'
  };
  return map[key] || fallback || key;
}

function createBucket(key, name) {
  return {
    key,
    name: productionNameForKey(key, name),
    revenue: 0,
    grossRevenue: 0,
    discountSum: 0,
    checks: 0,
    guests: 0,
    sourceLabels: new Set(),
    rowCount: 0
  };
}

function pushToBucket(grouped, key, values = {}) {
  if (!grouped.has(key)) grouped.set(key, createBucket(key, values.name));
  const current = grouped.get(key);
  current.revenue += toNumber(values.revenue);
  current.grossRevenue += toNumber(values.grossRevenue);
  current.discountSum += toNumber(values.discountSum);
  current.checks += toNumber(values.checks);
  current.guests += toNumber(values.guests);
  current.rowCount += 1;
  if (values.sourceLabel) current.sourceLabels.add(String(values.sourceLabel));
}

function rowsToProductionTypes(grouped, denominatorRevenue) {
  const totalFromBuckets = [...grouped.values()].reduce((total, item) => total + item.revenue, 0);
  const denominator = denominatorRevenue > 0 ? denominatorRevenue : totalFromBuckets;

  return [...grouped.values()]
    .filter((item) => item.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .map((item) => ({
      key: item.key,
      name: item.name,
      revenue: roundMoney(item.revenue),
      revenueText: formatMoney(item.revenue),
      grossRevenue: roundMoney(item.grossRevenue || item.revenue),
      discountSum: roundMoney(item.discountSum),
      checks: Math.max(Math.round(item.checks), 0),
      guests: Math.max(Math.round(item.guests), 0),
      share: denominator > 0 ? Math.round((item.revenue / denominator) * 1000) / 10 : 0,
      sourceLabels: [...item.sourceLabels].slice(0, 4).map((label) => String(label).length > 90 ? `${String(label).slice(0, 87)}...` : String(label)),
      sourceLabelsText: [...item.sourceLabels].slice(0, 3).join(' / '),
      isUnallocated: item.key === 'unallocated',
      rowCount: item.rowCount
    }));
}

function aggregateProductionSales(rows) {
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const revenue = toNumber(row?.revenue);
    if (revenue <= 0) continue;

    const key = normalizeProductionKeyFromText({
      key: row?.production_key,
      name: row?.production_name,
      source: row?.source_label
    });

    pushToBucket(grouped, key, {
      name: productionNameForKey(key, row?.production_name || key),
      revenue,
      grossRevenue: toNumber(row?.gross_revenue) || revenue,
      discountSum: toNumber(row?.discount_sum),
      checks: toNumber(row?.checks_count),
      guests: toNumber(row?.guests_count),
      sourceLabel: row?.source_label || row?.production_name
    });
  }

  return grouped;
}

function isVisibleDish(row) {
  const category = cleanText(row?.category_name);
  const name = cleanText(row?.dish_name);
  if (!name) return false;
  if (category.includes('служеб') || category.includes('технич')) return false;
  if (name === 'доставка' || name === 'самовывоз' || name === 'delivery' || name === 'pickup') return false;
  if (name.includes('тест') || name.includes('сертификат')) return false;
  return true;
}

function aggregateDishSales(rows) {
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const revenue = toNumber(row?.revenue);
    if (revenue <= 0 || !isVisibleDish(row)) continue;

    const key = normalizeProductionKeyFromText({
      category: row?.category_name,
      dish: row?.dish_name
    });

    pushToBucket(grouped, key, {
      name: productionNameForKey(key),
      revenue,
      grossRevenue: revenue,
      discountSum: 0,
      checks: 0,
      guests: 0,
      sourceLabel: `${row?.category_name || 'Без категории'} / ${row?.dish_name || 'Блюдо'}`
    });
  }

  return grouped;
}

function addUnallocatedBucket(grouped, totals, allocatedRevenue) {
  const totalRevenue = toNumber(totals?.revenue);
  const missingRevenue = Math.max(totalRevenue - allocatedRevenue, 0);
  if (missingRevenue <= Math.max(totalRevenue * 0.01, 1)) return;

  const allocatedChecks = [...grouped.values()].reduce((total, item) => total + toNumber(item.checks), 0);
  const allocatedGuests = [...grouped.values()].reduce((total, item) => total + toNumber(item.guests), 0);

  pushToBucket(grouped, 'unallocated', {
    name: 'Не распределено',
    revenue: missingRevenue,
    grossRevenue: missingRevenue,
    discountSum: 0,
    checks: Math.max(toNumber(totals?.checks) - allocatedChecks, 0),
    guests: Math.max(toNumber(totals?.guests) - allocatedGuests, 0),
    sourceLabel: 'Есть в общей выручке KPI iiko, но не распределено по production_sales/dish_sales'
  });
}

function coverageStatus(percentValue) {
  if (percentValue >= GOOD_COVERAGE_PERCENT) return 'good';
  if (percentValue >= 50) return 'warn';
  return 'bad';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurant_id') || DEFAULT_RESTAURANT_ID;
  const { period, startDate, endDate } = getPeriodRange(searchParams.get('date') || undefined, searchParams.get('period') || 'day');

  const guard = await assertApiAccess(request, { restaurantId, section: 'reports' });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  try {
    const detailFilter = restaurantFilterForDetail(restaurantId);
    const totals = await fetchKpiTotals({ restaurantId, startDate, endDate });

    const productionRows = await fetchRows(
      `/rest/v1/production_sales?select=*&business_date=gte.${startDate}&business_date=lte.${endDate}${detailFilter}&order=business_date.desc&limit=20000`
    );

    const productionGrouped = aggregateProductionSales(productionRows);
    const productionAllocated = [...productionGrouped.values()].reduce((total, item) => total + item.revenue, 0);
    const productionCoverage = totals.revenue > 0 ? Math.round((productionAllocated / totals.revenue) * 1000) / 10 : (productionAllocated > 0 ? 100 : 0);

    let selectedSource = 'production_sales';
    let grouped = productionGrouped;
    let allocatedRevenue = productionAllocated;

    // Если production_sales содержит только кусок периода, берём более широкую картину из dish_sales.
    if (productionCoverage < GOOD_COVERAGE_PERCENT) {
      const dishRows = await fetchRows(
        `/rest/v1/dish_sales?select=business_date,restaurant_id,dish_name,category_name,revenue,cost,quantity&business_date=gte.${startDate}&business_date=lte.${endDate}${detailFilter}&order=business_date.desc&limit=20000`
      );
      const dishGrouped = aggregateDishSales(dishRows);
      const dishAllocated = [...dishGrouped.values()].reduce((total, item) => total + item.revenue, 0);

      if (dishAllocated > productionAllocated) {
        selectedSource = 'dish_sales_category_mapping';
        grouped = dishGrouped;
        allocatedRevenue = dishAllocated;
      }
    }

    const realCoverage = totals.revenue > 0 ? Math.min(Math.round((allocatedRevenue / totals.revenue) * 1000) / 10, 100) : (allocatedRevenue > 0 ? 100 : 0);
    addUnallocatedBucket(grouped, totals, allocatedRevenue);

    const productionTypes = rowsToProductionTypes(grouped, totals.revenue || allocatedRevenue);
    const unallocated = productionTypes.find((item) => item.key === 'unallocated') || null;

    return NextResponse.json({
      ok: true,
      source: selectedSource,
      selectedRestaurantId: restaurantId,
      period,
      startDate,
      endDate,
      hasProductionData: productionTypes.length > 0,
      totalRevenue: totals.revenue || roundMoney(productionTypes.reduce((total, item) => total + toNumber(item.revenue), 0)),
      totalRevenueText: formatMoney(totals.revenue || productionTypes.reduce((total, item) => total + toNumber(item.revenue), 0)),
      checks: totals.checks,
      guests: totals.guests,
      avgCheck: totals.avgCheck,
      allocatedRevenue: roundMoney(allocatedRevenue),
      allocatedRevenueText: formatMoney(allocatedRevenue),
      unallocatedRevenue: unallocated ? unallocated.revenue : 0,
      unallocatedRevenueText: unallocated ? unallocated.revenueText : '0 ₽',
      coveragePercent: realCoverage,
      coverageStatus: coverageStatus(realCoverage),
      coverageText: `${realCoverage}% распределено по цехам`,
      hasUnallocated: Boolean(unallocated),
      note: unallocated
        ? 'Общая выручка взята из KPI iiko. Нераспределённая часть показана отдельно, чтобы не размазывать её по цехам фейково.'
        : 'Цеха покрывают выручку периода.',
      dataTruth: {
        totalRevenueSource: totals.source,
        productionSource: selectedSource,
        rule: 'Не подставляем приблизительные цеха. Если детализация неполная, остаток идёт в Не распределено.'
      },
      productionTypes
    });
  } catch (error) {
    console.error('production-sales error:', error);
    return NextResponse.json({
      ok: true,
      source: 'production_sales',
      selectedRestaurantId: restaurantId,
      period,
      startDate,
      endDate,
      hasProductionData: false,
      totalRevenue: 0,
      totalRevenueText: '0 ₽',
      productionTypes: [],
      warning: error?.message || 'production_sales unavailable'
    });
  }
}
