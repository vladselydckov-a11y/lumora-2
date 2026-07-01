import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../lib/supabaseServer';

const DEFAULT_RESTAURANT_ID = 'all';
const TYUMEN_TZ = 'Asia/Yekaterinburg';
const KNOWN_RESTAURANTS = ['aziatok', 'akvatoria'];
const GOOD_COVERAGE_PERCENT = 85;

const PRODUCTION_ORDER = ['cold', 'hot', 'bar', 'hookah', 'kitchen', 'other'];
const PRODUCTION_NAMES = {
  cold: 'Холодный цех',
  hot: 'Горячий цех',
  bar: 'Бар',
  hookah: 'Кальян',
  kitchen: 'Кухня',
  other: 'Другое'
};

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function formatMoney(value) {
  return `${Math.round(toNumber(value)).toLocaleString('ru-RU')} ₽`;
}

function compactText(value, maxLength = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
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

function monthEnd(dateString) {
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function getTyumenDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TYUMEN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function getRange(period, selectedDate) {
  const date = selectedDate || getTyumenDate();

  if (period === 'month') {
    return {
      startDate: monthStart(date),
      endDate: monthEnd(date)
    };
  }

  if (period === 'week') {
    const startDate = weekStartMonday(date);
    return {
      startDate,
      endDate: addDays(startDate, 6)
    };
  }

  return {
    startDate: date,
    endDate: date
  };
}

function restaurantFilter(selectedRestaurantId, field = 'restaurant_id') {
  if (!selectedRestaurantId || selectedRestaurantId === 'all') {
    return `&${field}=in.(${KNOWN_RESTAURANTS.join(',')})`;
  }

  return `&${field}=eq.${encodeURIComponent(selectedRestaurantId)}`;
}

function kpiRestaurantFilter(selectedRestaurantId) {
  if (!selectedRestaurantId || selectedRestaurantId === 'all') {
    return '&restaurant_id=eq.all';
  }

  return `&restaurant_id=eq.${encodeURIComponent(selectedRestaurantId)}`;
}

async function fetchAll(path, pageSize = 1000) {
  const result = [];
  let offset = 0;

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const rows = await supabaseFetch(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    const list = Array.isArray(rows) ? rows : [];

    result.push(...list);

    if (list.length < pageSize) break;

    offset += pageSize;

    if (offset > 20000) break;
  }

  return result;
}

function sumRows(rows, field) {
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
    return total + toNumber(row?.[field]);
  }, 0);
}

function normalizeKpiRows(rows) {
  const list = Array.isArray(rows) ? rows : [];

  const revenue = roundMoney(sumRows(list, 'revenue'));
  const checks = Math.round(sumRows(list, 'checks_count') || sumRows(list, 'checks'));
  const guests = Math.round(sumRows(list, 'guests_count') || sumRows(list, 'guests'));
  const avgCheck = checks > 0 ? Math.round(revenue / checks) : 0;

  return {
    revenue,
    checks,
    guests,
    avgCheck
  };
}

async function fetchKpiTotal({ selectedRestaurantId, startDate, endDate }) {
  const select = 'business_date,restaurant_id,revenue,checks_count,guests_count,avg_check';

  const directPath = `/rest/v1/kpi_sales?select=${select}&business_date=gte.${startDate}&business_date=lte.${endDate}${kpiRestaurantFilter(selectedRestaurantId)}`;
  const directRows = await fetchAll(directPath);
  const direct = normalizeKpiRows(directRows);

  if (direct.revenue > 0 || selectedRestaurantId !== 'all') {
    return {
      ...direct,
      source: 'kpi_sales'
    };
  }

  const fallbackPath = `/rest/v1/kpi_sales?select=${select}&business_date=gte.${startDate}&business_date=lte.${endDate}${restaurantFilter('all')}`;
  const fallbackRows = await fetchAll(fallbackPath);
  const fallback = normalizeKpiRows(fallbackRows);

  return {
    ...fallback,
    source: 'kpi_sales_restaurants_sum'
  };
}

function mapProductionFromLabel(value = '') {
  const text = String(value || '').toLowerCase();

  if (text.includes('кальян')) return 'hookah';

  if (
    text.includes('бар б/а') ||
    text.includes('склад бар') ||
    text.includes('алкоголь') ||
    text.includes('коктей') ||
    text.includes('напит') ||
    text.includes('лимонад') ||
    text.includes('вода') ||
    text.includes('морс') ||
    text.includes('сок') ||
    text.includes('сидр') ||
    text.includes('пиво') ||
    text.includes('вино') ||
    text.includes('чай') ||
    text.includes('кофе') ||
    text.includes('американо') ||
    text.includes('капучино') ||
    text.includes('латте') ||
    text.includes('бабл') ||
    text.includes('байкал') ||
    text.includes('сакура') ||
    text.includes('lapochka')
  ) {
    return 'bar';
  }

  if (
    text.includes('горяч') ||
    text.includes('суп') ||
    text.includes('том-ям') ||
    text.includes('том ям') ||
    text.includes('фобо') ||
    text.includes('удон') ||
    text.includes('тяхан') ||
    text.includes('рис') ||
    text.includes('лапша') ||
    text.includes('вок') ||
    text.includes('кацу') ||
    text.includes('темпур') ||
    text.includes('запечен') ||
    text.includes('запечён')
  ) {
    return 'hot';
  }

  if (
    text.includes('ролл') ||
    text.includes('маки') ||
    text.includes('филадельф') ||
    text.includes('канада') ||
    text.includes('суш') ||
    text.includes('сашими') ||
    text.includes('салат') ||
    text.includes('закуск') ||
    text.includes('поке') ||
    text.includes('десерт') ||
    text.includes('сладк') ||
    text.includes('манго') ||
    text.includes('лосос') ||
    text.includes('тунец') ||
    text.includes('угор') ||
    text.includes('угрем') ||
    text.includes('кревет')
  ) {
    return 'cold';
  }

  if (
    text.includes('модификатор') ||
    text.includes('допы') ||
    text.includes('васаби') ||
    text.includes('имбир') ||
    text.includes('соев') ||
    text.includes('без категории') ||
    text.includes('доставка')
  ) {
    return 'kitchen';
  }

  return 'other';
}

function buildProductionItem({ key, row, totalForShare }) {
  const revenue = roundMoney(row.revenue);
  const grossRevenue = roundMoney(row.grossRevenue || row.revenue);
  const discountSum = roundMoney(row.discountSum || 0);
  const checks = Math.round(toNumber(row.checks));
  const guests = Math.round(toNumber(row.guests));
  const sourceLabels = [...row.labels].filter(Boolean).slice(0, 4);
  const sourceLabelsText = [...row.labels].filter(Boolean).slice(0, 20).join(' / ');

  return {
    key,
    name: PRODUCTION_NAMES[key] || 'Другое',
    revenue,
    revenueText: formatMoney(revenue),
    grossRevenue,
    discountSum,
    checks,
    guests,
    share: totalForShare > 0 ? Math.round((revenue / totalForShare) * 1000) / 10 : 0,
    sourceLabels: sourceLabels.map((label) => compactText(label)),
    sourceLabelsText,
    isUnallocated: false,
    rowCount: row.rowCount || 0
  };
}

function sortProductionItems(items) {
  return [...items].sort((a, b) => {
    const orderA = PRODUCTION_ORDER.indexOf(a.key);
    const orderB = PRODUCTION_ORDER.indexOf(b.key);
    const safeA = orderA === -1 ? 999 : orderA;
    const safeB = orderB === -1 ? 999 : orderB;

    if (a.revenue !== b.revenue) return b.revenue - a.revenue;
    return safeA - safeB;
  });
}

function groupProductionRows(rows, totalForShare) {
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(
      row?.production_key || mapProductionFromLabel(`${row?.production_name || ''} ${row?.source_label || ''}`)
    );

    if (!grouped.has(key)) {
      grouped.set(key, {
        revenue: 0,
        grossRevenue: 0,
        discountSum: 0,
        checks: 0,
        guests: 0,
        labels: new Set(),
        rowCount: 0
      });
    }

    const bucket = grouped.get(key);

    bucket.revenue += toNumber(row?.revenue);
    bucket.grossRevenue += toNumber(row?.gross_revenue, toNumber(row?.revenue));
    bucket.discountSum += toNumber(row?.discount_sum);
    bucket.checks += toNumber(row?.checks_count);
    bucket.guests += toNumber(row?.guests_count);
    bucket.rowCount += 1;

    if (row?.source_label) bucket.labels.add(row.source_label);
    if (row?.production_name) bucket.labels.add(row.production_name);
  }

  const items = [];

  for (const [key, row] of grouped.entries()) {
    if (roundMoney(row.revenue) <= 0 && key !== 'hookah') continue;
    items.push(buildProductionItem({ key, row, totalForShare }));
  }

  return sortProductionItems(items);
}

function groupDishRows(rows, totalForShare) {
  const grouped = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const categoryName = String(row?.category_name || 'Без категории');
    const dishName = String(row?.dish_name || 'Позиция');
    const key = mapProductionFromLabel(`${categoryName} ${dishName}`);

    if (!grouped.has(key)) {
      grouped.set(key, {
        revenue: 0,
        grossRevenue: 0,
        discountSum: 0,
        checks: 0,
        guests: 0,
        labels: new Set(),
        rowCount: 0
      });
    }

    const bucket = grouped.get(key);
    const revenue = toNumber(row?.revenue);

    bucket.revenue += revenue;
    bucket.grossRevenue += revenue;
    bucket.rowCount += 1;
    bucket.labels.add(`${categoryName} / ${dishName}`);
  }

  const items = [];

  for (const [key, row] of grouped.entries()) {
    if (roundMoney(row.revenue) <= 0) continue;
    items.push(buildProductionItem({ key, row, totalForShare }));
  }

  return sortProductionItems(items);
}

async function fetchProductionRows({ selectedRestaurantId, startDate, endDate }) {
  const select = [
    'business_date',
    'restaurant_id',
    'production_key',
    'production_name',
    'source_label',
    'revenue',
    'gross_revenue',
    'discount_sum',
    'checks_count',
    'guests_count',
    'updated_at'
  ].join(',');

  const path = `/rest/v1/production_sales?select=${select}&business_date=gte.${startDate}&business_date=lte.${endDate}${restaurantFilter(selectedRestaurantId)}&order=business_date.asc`;

  return fetchAll(path);
}

async function fetchDishRows({ selectedRestaurantId, startDate, endDate }) {
  const select = [
    'business_date',
    'restaurant_id',
    'dish_name',
    'category_name',
    'quantity',
    'revenue',
    'cost',
    'foodcost_percent',
    'updated_at'
  ].join(',');

  const path = `/rest/v1/dish_sales?select=${select}&business_date=gte.${startDate}&business_date=lte.${endDate}${restaurantFilter(selectedRestaurantId)}&order=business_date.asc`;

  return fetchAll(path);
}

function buildResponse({
  selectedRestaurantId,
  period,
  startDate,
  endDate,
  kpi,
  source,
  productionTypes,
  allocatedRevenue,
  productionRowsCount,
  dishRowsCount
}) {
  const totalRevenue = roundMoney(kpi.revenue || allocatedRevenue);
  const safeAllocated = roundMoney(allocatedRevenue);
  const missing = Math.max(0, roundMoney(totalRevenue - safeAllocated));
  const coveragePercent = totalRevenue > 0
    ? Math.min(100, Math.round((safeAllocated / totalRevenue) * 1000) / 10)
    : 0;

  const coverageStatus = totalRevenue === 0
    ? 'empty'
    : coveragePercent >= GOOD_COVERAGE_PERCENT
      ? 'good'
      : 'partial';

  return NextResponse.json({
    ok: true,
    source,
    selectedRestaurantId,
    period,
    startDate,
    endDate,
    hasProductionData: productionTypes.length > 0,

    totalRevenue,
    totalRevenueText: formatMoney(totalRevenue),
    checks: kpi.checks || 0,
    guests: kpi.guests || 0,
    avgCheck: kpi.avgCheck || 0,

    allocatedRevenue: safeAllocated,
    allocatedRevenueText: formatMoney(safeAllocated),

    unallocatedRevenue: missing,
    unallocatedRevenueText: formatMoney(missing),
    coveragePercent,
    coverageStatus,
    coverageText: coveragePercent > 0
      ? `${coveragePercent}% распределено по цехам`
      : 'нет детализации по цехам',

    hasUnallocated: false,

    note: source === 'production_sales'
      ? 'Цеха взяты из production_sales. Общая выручка сверяется с KPI iiko.'
      : 'Цеха собраны из dish_sales по категориям блюд. Нераспределённую строку не показываем, чтобы не рисовать фейковые цеха.',

    dataTruth: {
      totalRevenueSource: kpi.source || 'kpi_sales',
      productionSource: source,
      rule: 'Выручка месяца/дня берётся из KPI iiko. Цеха берутся только из production_sales или dish_sales, без искусственного размазывания.'
    },

    debug: {
      productionRowsCount,
      dishRowsCount
    },

    productionTypes
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const selectedRestaurantId = searchParams.get('restaurant_id') || DEFAULT_RESTAURANT_ID;
    const period = searchParams.get('period') || 'day';
    const selectedDate = searchParams.get('date');

    const { startDate, endDate } = getRange(period, selectedDate);

    const kpi = await fetchKpiTotal({
      selectedRestaurantId,
      startDate,
      endDate
    });

    const totalRevenue = roundMoney(kpi.revenue);

    const productionRows = await fetchProductionRows({
      selectedRestaurantId,
      startDate,
      endDate
    });

    const productionRevenue = roundMoney(sumRows(productionRows, 'revenue'));
    const productionCoverage = totalRevenue > 0 ? (productionRevenue / totalRevenue) * 100 : 0;

    if (productionRows.length > 0 && productionRevenue > 0 && productionCoverage >= GOOD_COVERAGE_PERCENT) {
      const productionTypes = groupProductionRows(productionRows, productionRevenue);

      return buildResponse({
        selectedRestaurantId,
        period,
        startDate,
        endDate,
        kpi,
        source: 'production_sales',
        productionTypes,
        allocatedRevenue: productionRevenue,
        productionRowsCount: productionRows.length,
        dishRowsCount: 0
      });
    }

    const dishRows = await fetchDishRows({
      selectedRestaurantId,
      startDate,
      endDate
    });

    const dishRevenue = roundMoney(sumRows(dishRows, 'revenue'));

    if (dishRows.length > 0 && dishRevenue > 0) {
      const productionTypes = groupDishRows(dishRows, dishRevenue);

      return buildResponse({
        selectedRestaurantId,
        period,
        startDate,
        endDate,
        kpi,
        source: 'dish_sales_category_mapping',
        productionTypes,
        allocatedRevenue: dishRevenue,
        productionRowsCount: productionRows.length,
        dishRowsCount: dishRows.length
      });
    }

    const fallbackProductionTypes = groupProductionRows(
      productionRows,
      productionRevenue || totalRevenue
    );

    return buildResponse({
      selectedRestaurantId,
      period,
      startDate,
      endDate,
      kpi,
      source: productionRows.length ? 'production_sales_low_coverage' : 'no_production_data',
      productionTypes: fallbackProductionTypes,
      allocatedRevenue: productionRevenue,
      productionRowsCount: productionRows.length,
      dishRowsCount: dishRows.length
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'production_sales_error'
      },
      { status: 500 }
    );
  }
}
