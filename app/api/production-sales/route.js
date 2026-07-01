import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../lib/supabaseServer';
import { assertApiAccess } from '../../../lib/saasAccessGuard';

const DEFAULT_RESTAURANT_ID = 'all';
const RESTAURANT_IDS = ['aziatok', 'akvatoria'];

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
  return `${dateString.slice(0, 7)}-01`;
}

function monthEnd(dateString) {
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(5, 7));
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

function getTyumenDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
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

async function fetchAll(path) {
  const pageSize = 1000;
  let offset = 0;
  const allRows = [];

  while (true) {
    const separator = path.includes('?') ? '&' : '?';
    const pagedPath = `${path}${separator}limit=${pageSize}&offset=${offset}`;

    const rows = await supabaseFetch(pagedPath);

    if (!Array.isArray(rows)) {
      return [];
    }

    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    offset += pageSize;

    if (offset > 100000) {
      throw new Error('Supabase pagination safety stop in production-sales');
    }
  }

  return allRows;
}

function buildRestaurantFilter(selectedRestaurantId) {
  if (!selectedRestaurantId || selectedRestaurantId === 'all') {
    return {
      kpiFilter: 'restaurant_id=eq.all',
      detailFilter: `restaurant_id=in.(${RESTAURANT_IDS.join(',')})`
    };
  }

  return {
    kpiFilter: `restaurant_id=eq.${encodeURIComponent(selectedRestaurantId)}`,
    detailFilter: `restaurant_id=eq.${encodeURIComponent(selectedRestaurantId)}`
  };
}

async function fetchKpiRows({ selectedRestaurantId, startDate, endDate }) {
  const { kpiFilter, detailFilter } = buildRestaurantFilter(selectedRestaurantId);

  const baseSelect = 'select=restaurant_id,business_date,revenue,checks_count,guests_count';
  const dateFilter = `business_date=gte.${startDate}&business_date=lte.${endDate}`;

  const directRows = await fetchAll(
    `/rest/v1/kpi_sales?${baseSelect}&${dateFilter}&${kpiFilter}&order=business_date.asc`
  );

  if (Array.isArray(directRows) && directRows.length > 0) {
    return directRows;
  }

  if (selectedRestaurantId === 'all') {
    return await fetchAll(
      `/rest/v1/kpi_sales?${baseSelect}&${dateFilter}&${detailFilter}&order=business_date.asc`
    );
  }

  return [];
}

async function fetchDishRows({ selectedRestaurantId, startDate, endDate }) {
  const { detailFilter } = buildRestaurantFilter(selectedRestaurantId);

  return await fetchAll(
    `/rest/v1/dish_sales?select=restaurant_id,business_date,dish_name,category_name,quantity,revenue,cost,foodcost_percent&business_date=gte.${startDate}&business_date=lte.${endDate}&${detailFilter}&order=business_date.asc`
  );
}

function summarizeKpi(rows) {
  const revenue = roundMoney(rows.reduce((sum, row) => sum + toNumber(row.revenue), 0));
  const checks = Math.round(rows.reduce((sum, row) => sum + toNumber(row.checks_count), 0));
  const guests = Math.round(rows.reduce((sum, row) => sum + toNumber(row.guests_count), 0));
  const avgCheck = checks > 0 ? Math.round(revenue / checks) : 0;

  return {
    revenue,
    checks,
    guests,
    avgCheck
  };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyProduction(row) {
  const category = normalizeText(row.category_name);
  const dish = normalizeText(row.dish_name);
  const text = `${category} ${dish}`;

  if (
    text.includes('кальян') ||
    text.includes('hookah')
  ) {
    return {
      key: 'hookah',
      name: 'Кальян'
    };
  }

  if (
    text.includes('бар') ||
    text.includes('б/а') ||
    text.includes('алкоголь') ||
    text.includes('вино') ||
    text.includes('пиво') ||
    text.includes('сидр') ||
    text.includes('коктейл') ||
    text.includes('лимонад') ||
    text.includes('морс') ||
    text.includes('чай') ||
    text.includes('кофе') ||
    text.includes('капучино') ||
    text.includes('американо') ||
    text.includes('латте') ||
    text.includes('вода') ||
    text.includes('напит')
  ) {
    return {
      key: 'bar',
      name: 'Бар'
    };
  }

  if (
    text.includes('горяч') ||
    text.includes('суп') ||
    text.includes('том-ям') ||
    text.includes('том ям') ||
    text.includes('фобо') ||
    text.includes('удон') ||
    text.includes('рис') ||
    text.includes('тяхан') ||
    text.includes('лапша') ||
    text.includes('темпур') ||
    text.includes('запеч')
  ) {
    return {
      key: 'hot',
      name: 'Горячий цех'
    };
  }

  if (
    text.includes('ролл') ||
    text.includes('маки') ||
    text.includes('филадельф') ||
    text.includes('канада') ||
    text.includes('салат') ||
    text.includes('закуск') ||
    text.includes('поке') ||
    text.includes('десерт') ||
    text.includes('сладк')
  ) {
    return {
      key: 'cold',
      name: 'Холодный цех'
    };
  }

  if (
    text.includes('модификатор') ||
    text.includes('васаби') ||
    text.includes('имбир') ||
    text.includes('соев') ||
    text.includes('соус') ||
    text.includes('огурцом')
  ) {
    return {
      key: 'kitchen',
      name: 'Кухня'
    };
  }

  return {
    key: 'other',
    name: 'Другое'
  };
}

function compactLabels(labels, limit = 4) {
  return labels
    .filter(Boolean)
    .slice(0, limit);
}

function buildSourceLabel(row) {
  const category = String(row.category_name || 'Без категории').trim();
  const dish = String(row.dish_name || 'Без названия').trim();

  if (category && dish && category !== dish) {
    return `${category} / ${dish}`;
  }

  return dish || category || 'Без названия';
}

function buildProductionTypes({ dishRows, kpi }) {
  const groups = new Map();

  for (const row of dishRows) {
    const revenue = roundMoney(row.revenue);
    if (Math.abs(revenue) < 0.01) continue;

    const production = classifyProduction(row);
    const key = production.key;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: production.name,
        revenue: 0,
        grossRevenue: 0,
        discountSum: 0,
        checks: 0,
        guests: 0,
        rowCount: 0,
        sourceLabels: new Set()
      });
    }

    const group = groups.get(key);
    group.revenue = roundMoney(group.revenue + revenue);
    group.grossRevenue = roundMoney(group.grossRevenue + revenue);
    group.rowCount += 1;

    const label = buildSourceLabel(row);
    if (group.sourceLabels.size < 20) {
      group.sourceLabels.add(label);
    }
  }

  const allocatedRevenue = roundMoney([...groups.values()].reduce((sum, item) => sum + item.revenue, 0));
  const unallocatedRevenue = roundMoney(Math.max(0, kpi.revenue - allocatedRevenue));

  const productionTypes = [...groups.values()]
    .map((item) => {
      const labels = [...item.sourceLabels];

      return {
        key: item.key,
        name: item.name,
        revenue: roundMoney(item.revenue),
        revenueText: formatMoney(item.revenue),
        grossRevenue: roundMoney(item.grossRevenue),
        discountSum: roundMoney(item.discountSum),
        checks: item.checks,
        guests: item.guests,
        share: kpi.revenue > 0 ? Math.round((item.revenue / kpi.revenue) * 1000) / 10 : 0,
        sourceLabels: compactLabels(labels),
        sourceLabelsText: labels.slice(0, 12).join(' / '),
        isUnallocated: false,
        rowCount: item.rowCount
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  if (unallocatedRevenue > 1) {
    productionTypes.unshift({
      key: 'unallocated',
      name: 'Не распределено',
      revenue: unallocatedRevenue,
      revenueText: formatMoney(unallocatedRevenue),
      grossRevenue: unallocatedRevenue,
      discountSum: 0,
      checks: kpi.checks,
      guests: kpi.guests,
      share: kpi.revenue > 0 ? Math.round((unallocatedRevenue / kpi.revenue) * 1000) / 10 : 0,
      sourceLabels: ['Есть в общей выручке KPI iiko, но нет полной детализации в dish_sales'],
      sourceLabelsText: 'Есть в общей выручке KPI iiko, но нет полной детализации в dish_sales',
      isUnallocated: true,
      rowCount: 1
    });
  }

  const coveragePercent = kpi.revenue > 0
    ? Math.round((Math.min(allocatedRevenue, kpi.revenue) / kpi.revenue) * 1000) / 10
    : 0;

  const coverageStatus =
    coveragePercent >= 99 ? 'good' :
    coveragePercent >= 90 ? 'attention' :
    'bad';

  return {
    productionTypes,
    allocatedRevenue,
    unallocatedRevenue,
    coveragePercent,
    coverageStatus
  };
}

function buildNoDataResponse({ selectedRestaurantId, period, startDate, endDate }) {
  return {
    ok: true,
    source: 'production_sales',
    selectedRestaurantId,
    period,
    startDate,
    endDate,
    hasProductionData: false,
    totalRevenue: 0,
    totalRevenueText: '0 ₽',
    checks: 0,
    guests: 0,
    avgCheck: 0,
    productionTypes: [],
    note: 'За выбранный период данных по KPI/цехам пока нет.'
  };
}

export async function GET(request) {
  try {
    const gate = assertApiAccess(request);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error || 'access_denied' },
        { status: gate.status || 401 }
      );
    }

    const { searchParams } = new URL(request.url);

    const selectedRestaurantId = searchParams.get('restaurant_id') || DEFAULT_RESTAURANT_ID;
    const period = searchParams.get('period') || 'day';
    const selectedDate = searchParams.get('date');

    const { startDate, endDate } = getRange(period, selectedDate);

    const [kpiRows, dishRows] = await Promise.all([
      fetchKpiRows({ selectedRestaurantId, startDate, endDate }),
      fetchDishRows({ selectedRestaurantId, startDate, endDate })
    ]);

    const kpi = summarizeKpi(kpiRows);

    if (!kpiRows.length && !dishRows.length) {
      return NextResponse.json(
        buildNoDataResponse({ selectedRestaurantId, period, startDate, endDate })
      );
    }

    const {
      productionTypes,
      allocatedRevenue,
      unallocatedRevenue,
      coveragePercent,
      coverageStatus
    } = buildProductionTypes({ dishRows, kpi });

    return NextResponse.json({
      ok: true,
      source: 'dish_sales_category_mapping',
      selectedRestaurantId,
      period,
      startDate,
      endDate,
      hasProductionData: productionTypes.length > 0,
      totalRevenue: kpi.revenue,
      totalRevenueText: formatMoney(kpi.revenue),
      checks: kpi.checks,
      guests: kpi.guests,
      avgCheck: kpi.avgCheck,
      allocatedRevenue,
      allocatedRevenueText: formatMoney(allocatedRevenue),
      unallocatedRevenue,
      unallocatedRevenueText: formatMoney(unallocatedRevenue),
      coveragePercent,
      coverageStatus,
      coverageText: `${coveragePercent}% распределено по цехам`,
      hasUnallocated: unallocatedRevenue > 1,
      note: unallocatedRevenue > 1
        ? 'Общая выручка взята из KPI iiko. Нераспределённая часть показана отдельно, потому что в dish_sales нет полной детализации за часть периода.'
        : 'Цеха покрывают выручку периода. Остаток не распределённой выручки не найден.',
      dataTruth: {
        totalRevenueSource: 'kpi_sales',
        productionSource: 'dish_sales_category_mapping',
        rule: 'Не подставляем приблизительные цеха. Если детализация неполная, остаток идёт в Не распределено.'
      },
      productionTypes
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: 'production_sales',
        error: error?.message || 'production_sales_error'
      },
      { status: 500 }
    );
  }
}
