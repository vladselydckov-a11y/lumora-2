import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../lib/supabaseServer';

const DEFAULT_RESTAURANT_ID = 'all';
const RESTAURANT_IDS = ['aziatok', 'akvatoria'];
const TYUMEN_TZ = 'Asia/Yekaterinburg';

const GOOD_COVERAGE_PERCENT = 85;
const EMPTY_SOURCE = 'empty';
const KPI_SOURCE = 'kpi_sales';
const PRODUCTION_SOURCE = 'production_sales';
const DISH_SOURCE = 'dish_sales_category_mapping';

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
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function monthStart(dateString) {
  const date = dateToUTC(dateString);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function monthEnd(dateString) {
  const date = dateToUTC(dateString);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
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

function resolvePeriod({ period, date }) {
  const selectedDate = date || getTyumenDate();

  if (period === 'week') {
    const startDate = weekStartMonday(selectedDate);
    return {
      period: 'week',
      date: selectedDate,
      startDate,
      endDate: addDays(startDate, 6)
    };
  }

  if (period === 'month') {
    return {
      period: 'month',
      date: selectedDate,
      startDate: monthStart(selectedDate),
      endDate: monthEnd(selectedDate)
    };
  }

  return {
    period: 'day',
    date: selectedDate,
    startDate: selectedDate,
    endDate: selectedDate
  };
}

function enc(value) {
  return encodeURIComponent(String(value ?? ''));
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function shortLabel(value, max = 92) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeRestaurantId(value) {
  const restaurantId = String(value || DEFAULT_RESTAURANT_ID).trim().toLowerCase();
  if (restaurantId === 'all' || RESTAURANT_IDS.includes(restaurantId)) return restaurantId;
  return DEFAULT_RESTAURANT_ID;
}

function restaurantFilterQuery(restaurantId) {
  if (restaurantId === 'all') {
    return `restaurant_id=in.(${RESTAURANT_IDS.join(',')})`;
  }

  return `restaurant_id=eq.${enc(restaurantId)}`;
}

function restaurantKpiFilterQuery(restaurantId) {
  if (restaurantId === 'all') {
    return 'restaurant_id=eq.all';
  }

  return `restaurant_id=eq.${enc(restaurantId)}`;
}

function knownRestaurantsFilterQuery() {
  return `restaurant_id=in.(${RESTAURANT_IDS.join(',')})`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sumRows(rows, field) {
  return safeArray(rows).reduce((sum, row) => sum + toNumber(row?.[field]), 0);
}

function makeEmptyKpi() {
  return {
    revenue: 0,
    checks: 0,
    guests: 0,
    avgCheck: 0,
    source: KPI_SOURCE,
    rows: 0
  };
}

async function fetchRows(path) {
  const rows = await supabaseFetch(path).catch(() => []);
  return safeArray(rows);
}

async function fetchKpiRows({ restaurantId, startDate, endDate }) {
  const base = `/rest/v1/kpi_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count&business_date=gte.${enc(startDate)}&business_date=lte.${enc(endDate)}&order=business_date.asc`;

  if (restaurantId === 'all') {
    const allRows = await fetchRows(`${base}&${restaurantKpiFilterQuery('all')}`);

    if (allRows.length > 0) {
      return allRows;
    }

    return fetchRows(`${base}&${knownRestaurantsFilterQuery()}`);
  }

  return fetchRows(`${base}&${restaurantKpiFilterQuery(restaurantId)}`);
}

async function fetchDailyRows({ restaurantId, startDate, endDate }) {
  const base = `/rest/v1/daily_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count&business_date=gte.${enc(startDate)}&business_date=lte.${enc(endDate)}&order=business_date.asc`;

  if (restaurantId === 'all') {
    const allRows = await fetchRows(`${base}&restaurant_id=eq.all`);

    if (allRows.length > 0) {
      return allRows;
    }

    return fetchRows(`${base}&${knownRestaurantsFilterQuery()}`);
  }

  return fetchRows(`${base}&restaurant_id=eq.${enc(restaurantId)}`);
}

function aggregateKpi(rows) {
  const safeRows = safeArray(rows);
  const revenue = roundMoney(sumRows(safeRows, 'revenue'));
  const checks = Math.round(sumRows(safeRows, 'checks_count'));
  const guests = Math.round(sumRows(safeRows, 'guests_count'));
  const avgCheck = checks > 0 ? Math.round(revenue / checks) : 0;

  return {
    revenue,
    checks,
    guests,
    avgCheck,
    source: KPI_SOURCE,
    rows: safeRows.length
  };
}

async function getKpi({ restaurantId, startDate, endDate }) {
  const kpiRows = await fetchKpiRows({ restaurantId, startDate, endDate });
  const kpi = aggregateKpi(kpiRows);

  if (kpi.revenue > 0 || kpi.checks > 0 || kpi.guests > 0) {
    return kpi;
  }

  const dailyRows = await fetchDailyRows({ restaurantId, startDate, endDate });
  const daily = aggregateKpi(dailyRows);

  return {
    ...daily,
    source: daily.rows > 0 ? 'daily_sales' : KPI_SOURCE
  };
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replaceAll('ё', 'е').trim();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function classifyProductionFromDish(row) {
  const category = normalizeText(row?.category_name);
  const dish = normalizeText(row?.dish_name);
  const full = `${category} ${dish}`;

  if (includesAny(full, ['кальян'])) {
    return { key: 'hookah', name: 'Кальян' };
  }

  if (
    includesAny(full, [
      'алкоголь',
      'бар ',
      'бар б/а',
      'б/а',
      'напит',
      'лимонад',
      'морс',
      'чай',
      'кофе',
      'капучино',
      'латте',
      'вода',
      'сок',
      'сидр',
      'вино',
      'пиво',
      'коктейл',
      'аперол',
      'negroni',
      'негрони',
      'cola',
      'кола'
    ])
  ) {
    return { key: 'bar', name: 'Бар' };
  }

  if (
    includesAny(full, [
      'горяч',
      'суп',
      'том-ям',
      'том ям',
      'фобо',
      'удон',
      'тяхан',
      'рис ',
      'лапша',
      'темпур',
      'темпура',
      'запеч',
      'кранчи',
      'жарен',
      'креветки жареные'
    ])
  ) {
    return { key: 'hot', name: 'Горячий цех' };
  }

  if (
    includesAny(full, [
      'ролл',
      'роллы',
      'суши',
      'сашими',
      'салат',
      'закуск',
      'поке',
      'десерт',
      'сладкий',
      'маки',
      'филадельф',
      'канада',
      'лосось',
      'тунец',
      'угорь',
      'креветка'
    ])
  ) {
    return { key: 'cold', name: 'Холодный цех' };
  }

  if (
    includesAny(full, [
      'модификатор',
      'васаби',
      'имбир',
      'соевый',
      'соус',
      'допы',
      'лайм',
      'лимон',
      'сироп',
      'молоко'
    ])
  ) {
    return { key: 'kitchen', name: 'Кухня' };
  }

  return { key: 'other', name: 'Другое' };
}

function normalizeProductionName(key, name) {
  const safeKey = normalizeText(key || name);

  if (safeKey.includes('cold') || safeKey.includes('холод')) return { key: 'cold', name: 'Холодный цех' };
  if (safeKey.includes('hot') || safeKey.includes('горяч')) return { key: 'hot', name: 'Горячий цех' };
  if (safeKey.includes('bar') || safeKey.includes('бар')) return { key: 'bar', name: 'Бар' };
  if (safeKey.includes('hookah') || safeKey.includes('кальян')) return { key: 'hookah', name: 'Кальян' };
  if (safeKey.includes('kitchen') || safeKey.includes('кухн')) return { key: 'kitchen', name: 'Кухня' };
  if (safeKey.includes('other') || safeKey.includes('другое')) return { key: 'other', name: 'Другое' };

  return {
    key: String(key || 'other').trim() || 'other',
    name: String(name || 'Другое').trim() || 'Другое'
  };
}

function bucketPriority(key) {
  const order = {
    cold: 1,
    hot: 2,
    bar: 3,
    kitchen: 4,
    hookah: 5,
    other: 6
  };

  return order[key] || 99;
}

function createBucket({ key, name }) {
  return {
    key,
    name,
    revenue: 0,
    grossRevenue: 0,
    discountSum: 0,
    checks: 0,
    guests: 0,
    rowCount: 0,
    sourceLabels: []
  };
}

function addToBucket(map, production, payload) {
  const key = production.key;
  const current = map.get(key) || createBucket(production);

  current.revenue += toNumber(payload.revenue);
  current.grossRevenue += toNumber(payload.grossRevenue, toNumber(payload.revenue));
  current.discountSum += toNumber(payload.discountSum);
  current.checks += toNumber(payload.checks);
  current.guests += toNumber(payload.guests);
  current.rowCount += toNumber(payload.rowCount, 1);

  if (payload.label) {
    current.sourceLabels.push(payload.label);
  }

  map.set(key, current);
}

async function fetchProductionRows({ restaurantId, startDate, endDate }) {
  const path =
    `/rest/v1/production_sales?select=business_date,restaurant_id,production_key,production_name,source_label,revenue,gross_revenue,discount_sum,checks_count,guests_count` +
    `&business_date=gte.${enc(startDate)}&business_date=lte.${enc(endDate)}&${restaurantFilterQuery(restaurantId)}&order=business_date.asc`;

  return fetchRows(path);
}

async function fetchDishRows({ restaurantId, startDate, endDate }) {
  const path =
    `/rest/v1/dish_sales?select=business_date,restaurant_id,dish_name,category_name,quantity,revenue,cost,foodcost_percent` +
    `&business_date=gte.${enc(startDate)}&business_date=lte.${enc(endDate)}&${restaurantFilterQuery(restaurantId)}&order=business_date.asc`;

  return fetchRows(path);
}

function aggregateProductionRows(rows) {
  const map = new Map();

  for (const row of safeArray(rows)) {
    const production = normalizeProductionName(row?.production_key, row?.production_name);
    const label = [row?.source_label].filter(Boolean).join(' / ');

    addToBucket(map, production, {
      revenue: row?.revenue,
      grossRevenue: row?.gross_revenue,
      discountSum: row?.discount_sum,
      checks: row?.checks_count,
      guests: row?.guests_count,
      rowCount: 1,
      label
    });
  }

  return [...map.values()];
}

function aggregateDishRows(rows) {
  const map = new Map();

  for (const row of safeArray(rows)) {
    const production = classifyProductionFromDish(row);
    const label = [row?.category_name, row?.dish_name].filter(Boolean).join(' / ');

    addToBucket(map, production, {
      revenue: row?.revenue,
      grossRevenue: row?.revenue,
      discountSum: 0,
      checks: 0,
      guests: 0,
      rowCount: 1,
      label
    });
  }

  return [...map.values()];
}

function rawTotal(buckets) {
  return roundMoney(safeArray(buckets).reduce((sum, bucket) => sum + toNumber(bucket?.revenue), 0));
}

function coveragePercent({ totalRevenue, detailRevenue }) {
  if (toNumber(totalRevenue) <= 0) return 0;
  return Math.round((toNumber(detailRevenue) / toNumber(totalRevenue)) * 1000) / 10;
}

function coverageStatus(percent) {
  if (percent >= 98 && percent <= 103) return 'perfect';
  if (percent >= GOOD_COVERAGE_PERCENT && percent <= 115) return 'good';
  if (percent > 0) return 'partial';
  return 'empty';
}

function chooseSource({ kpiRevenue, productionBuckets, dishBuckets }) {
  const productionRevenue = rawTotal(productionBuckets);
  const dishRevenue = rawTotal(dishBuckets);

  const productionCoverage = coveragePercent({
    totalRevenue: kpiRevenue,
    detailRevenue: productionRevenue
  });

  const dishCoverage = coveragePercent({
    totalRevenue: kpiRevenue,
    detailRevenue: dishRevenue
  });

  const productionIsGood = productionCoverage >= GOOD_COVERAGE_PERCENT && productionCoverage <= 115;
  const dishIsGood = dishCoverage >= GOOD_COVERAGE_PERCENT && dishCoverage <= 115;

  if (productionIsGood && productionRevenue >= dishRevenue) {
    return {
      source: PRODUCTION_SOURCE,
      buckets: productionBuckets,
      rawRevenue: productionRevenue,
      coverage: productionCoverage
    };
  }

  if (dishIsGood) {
    return {
      source: DISH_SOURCE,
      buckets: dishBuckets,
      rawRevenue: dishRevenue,
      coverage: dishCoverage
    };
  }

  if (productionRevenue > 0 && productionRevenue >= dishRevenue) {
    return {
      source: PRODUCTION_SOURCE,
      buckets: productionBuckets,
      rawRevenue: productionRevenue,
      coverage: productionCoverage
    };
  }

  if (dishRevenue > 0) {
    return {
      source: DISH_SOURCE,
      buckets: dishBuckets,
      rawRevenue: dishRevenue,
      coverage: dishCoverage
    };
  }

  return {
    source: EMPTY_SOURCE,
    buckets: [],
    rawRevenue: 0,
    coverage: 0
  };
}

function reconcileBuckets({ buckets, kpi, chosen }) {
  const kpiRevenue = roundMoney(kpi.revenue);
  const rawRevenue = roundMoney(chosen.rawRevenue);
  const status = coverageStatus(chosen.coverage);

  if (!buckets.length || kpiRevenue <= 0 || rawRevenue <= 0) {
    return {
      buckets: [],
      normalizationFactor: 1,
      allocatedRevenue: 0,
      unallocatedRevenue: kpiRevenue,
      reconciliationMode: 'empty',
      coverageStatus: status
    };
  }

  const shouldNormalize = chosen.coverage >= GOOD_COVERAGE_PERCENT && chosen.coverage <= 115;
  const factor = shouldNormalize ? kpiRevenue / rawRevenue : 1;

  const reconciled = buckets
    .map((bucket) => {
      const revenue = roundMoney(toNumber(bucket.revenue) * factor);
      const grossRevenue = roundMoney(toNumber(bucket.grossRevenue, bucket.revenue) * factor);
      const discountSum = roundMoney(toNumber(bucket.discountSum) * factor);

      return {
        ...bucket,
        revenue,
        grossRevenue,
        discountSum
      };
    })
    .filter((bucket) => toNumber(bucket.revenue) > 0)
    .sort((a, b) => {
      const byRevenue = toNumber(b.revenue) - toNumber(a.revenue);
      if (byRevenue !== 0) return byRevenue;
      return bucketPriority(a.key) - bucketPriority(b.key);
    });

  if (shouldNormalize && reconciled.length > 0) {
    const sumAfter = rawTotal(reconciled);
    const diff = roundMoney(kpiRevenue - sumAfter);

    if (Math.abs(diff) >= 0.01) {
      reconciled[0].revenue = roundMoney(reconciled[0].revenue + diff);
      reconciled[0].grossRevenue = roundMoney(reconciled[0].grossRevenue + diff);
    }
  }

  const allocatedRevenue = shouldNormalize ? kpiRevenue : rawTotal(reconciled);
  const unallocatedRevenue = shouldNormalize ? 0 : Math.max(0, roundMoney(kpiRevenue - allocatedRevenue));

  return {
    buckets: reconciled,
    normalizationFactor: factor,
    allocatedRevenue,
    unallocatedRevenue,
    reconciliationMode: shouldNormalize ? 'normalized_to_kpi' : 'raw_detail_only',
    coverageStatus: status
  };
}

function decorateBuckets({ buckets, totalRevenue, kpi }) {
  return safeArray(buckets).map((bucket) => {
    const revenue = roundMoney(bucket.revenue);
    const share = totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0;
    const labels = unique(bucket.sourceLabels).slice(0, 4);
    const labelsText = unique(bucket.sourceLabels).slice(0, 30).join(' / ');

    return {
      key: bucket.key,
      name: bucket.name,
      revenue,
      revenueText: formatMoney(revenue),
      grossRevenue: roundMoney(bucket.grossRevenue),
      discountSum: roundMoney(bucket.discountSum),
      checks: Math.round(toNumber(bucket.checks)),
      guests: Math.round(toNumber(bucket.guests)),
      share,
      sourceLabels: labels.map((label) => shortLabel(label)),
      sourceLabelsText: labelsText,
      isUnallocated: false,
      rowCount: Math.round(toNumber(bucket.rowCount))
    };
  });
}

function makeNote({ chosen, reconciled, period }) {
  if (chosen.source === EMPTY_SOURCE) {
    return 'Данных по цехам за выбранный период нет. Главные KPI остаются из kpi_sales.';
  }

  if (reconciled.reconciliationMode === 'normalized_to_kpi') {
    return 'Главная выручка, чеки, гости и средний чек взяты из KPI iiko. Цеха собраны из реальной детализации и сверены к KPI, чтобы суммы на экране не конфликтовали.';
  }

  return `Цеха показаны только по доступной детализации за ${period}. Недостающую часть не показываем отдельной строкой и не размазываем по цехам.`;
}

async function handle(request) {
  const url = new URL(request.url);
  const restaurantId = normalizeRestaurantId(url.searchParams.get('restaurant_id'));
  const requestedPeriod = String(url.searchParams.get('period') || 'day').trim().toLowerCase();
  const period = ['day', 'week', 'month'].includes(requestedPeriod) ? requestedPeriod : 'day';
  const date = url.searchParams.get('date') || '';

  const range = resolvePeriod({ period, date });

  const kpi = await getKpi({
    restaurantId,
    startDate: range.startDate,
    endDate: range.endDate
  });

  const [productionRows, dishRows] = await Promise.all([
    fetchProductionRows({
      restaurantId,
      startDate: range.startDate,
      endDate: range.endDate
    }),
    fetchDishRows({
      restaurantId,
      startDate: range.startDate,
      endDate: range.endDate
    })
  ]);

  const productionBuckets = aggregateProductionRows(productionRows);
  const dishBuckets = aggregateDishRows(dishRows);

  const chosen = chooseSource({
    kpiRevenue: kpi.revenue,
    productionBuckets,
    dishBuckets
  });

  const reconciled = reconcileBuckets({
    buckets: chosen.buckets,
    kpi,
    chosen
  });

  const productionTypes = decorateBuckets({
    buckets: reconciled.buckets,
    totalRevenue: kpi.revenue || reconciled.allocatedRevenue,
    kpi
  });

  const response = {
    ok: true,
    source: chosen.source,
    selectedRestaurantId: restaurantId,
    period: range.period,
    startDate: range.startDate,
    endDate: range.endDate,
    hasProductionData: productionTypes.length > 0,
    totalRevenue: roundMoney(kpi.revenue),
    totalRevenueText: formatMoney(kpi.revenue),
    checks: kpi.checks,
    guests: kpi.guests,
    avgCheck: kpi.avgCheck,
    allocatedRevenue: roundMoney(reconciled.allocatedRevenue),
    allocatedRevenueText: formatMoney(reconciled.allocatedRevenue),
    unallocatedRevenue: 0,
    unallocatedRevenueText: '0 ₽',
    coveragePercent: chosen.coverage,
    coverageStatus: reconciled.coverageStatus,
    coverageText:
      reconciled.reconciliationMode === 'normalized_to_kpi'
        ? `${chosen.coverage}% детализации, сверено к KPI`
        : `${chosen.coverage}% детализации`,
    hasUnallocated: false,
    note: makeNote({ chosen, reconciled, period: range.period }),
    dataTruth: {
      totalRevenueSource: kpi.source,
      productionSource: chosen.source,
      rule:
        reconciled.reconciliationMode === 'normalized_to_kpi'
          ? 'Главные итоги берём из KPI. Цеха берём из детализации и нормализуем к KPI только при хорошем покрытии.'
          : 'Главные итоги берём из KPI. Цеха берём только из доступной детализации, без отдельной строки Не распределено.'
    },
    debug: {
      kpiRevenue: roundMoney(kpi.revenue),
      kpiChecks: kpi.checks,
      kpiGuests: kpi.guests,
      productionRowsCount: productionRows.length,
      dishRowsCount: dishRows.length,
      productionRawRevenue: rawTotal(productionBuckets),
      dishRawRevenue: rawTotal(dishBuckets),
      chosenRawRevenue: roundMoney(chosen.rawRevenue),
      normalizationFactor: Math.round(reconciled.normalizationFactor * 1000000) / 1000000,
      reconciliationMode: reconciled.reconciliationMode
    },
    productionTypes
  };

  return NextResponse.json(response);
}

export async function GET(request) {
  try {
    return await handle(request);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'production_sales_failed'
      },
      { status: 500 }
    );
  }
}
