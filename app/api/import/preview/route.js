import { NextResponse } from 'next/server';

const requiredFields = [
  'restaurant_id',
  'business_date',
  'revenue',
  'checks_count',
  'avg_check',
  'dish_name',
  'waiter_name',
  'discounts',
  'foodcost_percent'
];

const samplePreview = {
  restaurant: 'Северный Гриль',
  days: 30,
  revenue: 6128400,
  checks: 4318,
  avgCheck: 1419,
  foodcost: 32.4,
  discounts: 284600,
  mainRisks: ['средний чек ниже цели в слабые дни', 'фудкост выше нормы', 'скидки требуют контроля по сменам']
};

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map((item) => item.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',').map((item) => item.trim());
    return headers.reduce((row, header, index) => ({ ...row, [header]: cells[index] ?? '' }), {});
  });
  return { headers, rows };
}

function toNumber(value) {
  const number = Number(String(value || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function buildParsedPreview(csvText) {
  const { headers, rows } = parseCsv(csvText);
  const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
  const checks = rows.reduce((sum, row) => sum + toNumber(row.checks_count), 0);
  const avgCheck = checks ? Math.round(revenue / checks) : 0;
  const discounts = rows.reduce((sum, row) => sum + toNumber(row.discounts), 0);
  const foodcostRows = rows.filter((row) => row.foodcost_percent !== undefined);
  const foodcost = foodcostRows.length
    ? foodcostRows.reduce((sum, row) => sum + toNumber(row.foodcost_percent), 0) / foodcostRows.length
    : 0;
  const missingFields = requiredFields.filter((field) => !headers.includes(field));
  return {
    headers,
    rowsCount: rows.length,
    revenue,
    checks,
    avgCheck,
    discounts,
    foodcost: Number(foodcost.toFixed(1)),
    missingFields
  };
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const filename = body.filename || 'iiko_olap_sales_30_days.csv';
  const restaurantId = body.restaurant_id || 'all';
  const parsed = body.csv_text ? buildParsedPreview(body.csv_text) : null;

  if (parsed) {
    return NextResponse.json({
      ok: parsed.missingFields.length === 0,
      mode: 'v7_3_1_csv_preview_parser',
      message: parsed.missingFields.length
        ? `Файл ${filename} прочитан, но не хватает полей: ${parsed.missingFields.join(', ')}.`
        : `Файл ${filename} прочитан: ${parsed.rowsCount} строк, выручка ${Math.round(parsed.revenue).toLocaleString('ru-RU')} ₽, средний чек ${parsed.avgCheck.toLocaleString('ru-RU')} ₽.`,
      fields: requiredFields,
      parsed,
      nextStep: 'Загрузить данные в Supabase: daily_sales, dish_sales, waiter_sales. После этого /api/summary покажет real data mode.',
      warning: 'Не вставляй iiko ключи во frontend. Реальный импорт должен идти через server route, n8n или backend.'
    });
  }

  return NextResponse.json({
    ok: true,
    mode: 'v7_3_1_import_preview_sample',
    message: `Preview для ${filename}: пример выгрузки ресторана “${samplePreview.restaurant}” за ${samplePreview.days} дней. Выручка ${samplePreview.revenue.toLocaleString('ru-RU')} ₽, средний чек ${samplePreview.avgCheck.toLocaleString('ru-RU')} ₽. Следующий шаг: загрузить CSV из docs/demo-data в Supabase.`,
    fields: requiredFields,
    samplePreview,
    targetTables: ['restaurants', 'kpi_settings', 'daily_sales', 'dish_sales', 'waiter_sales', 'orders'],
    restaurant_id: restaurantId,
    warning: 'v7.3.1 уже умеет собирать /api/summary из реальных таблиц Supabase и разделять день/неделю/30 дней. Если USE_SUPABASE=false, приложение останется в demo-live режиме.'
  });
}
