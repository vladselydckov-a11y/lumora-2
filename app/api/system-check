import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../lib/supabaseServer';

const TYUMEN_TZ = 'Asia/Yekaterinburg';
const RESTAURANT_IDS = ['aziatok', 'akvatoria'];
const DEFAULT_ADMIN_KEY = process.env.ACCESS_ADMIN_KEY || '';

function getTyumenParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TYUMEN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    isoLabel: `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${TYUMEN_TZ}`
  };
}

function money(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('ru-RU')} ₽`;
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function hasAdminAccess(request) {
  if (!DEFAULT_ADMIN_KEY) return true;
  const { searchParams } = new URL(request.url);
  const queryKey = searchParams.get('admin_key') || '';
  const headerKey = request.headers.get('x-admin-key') || '';
  return queryKey === DEFAULT_ADMIN_KEY || headerKey === DEFAULT_ADMIN_KEY;
}

async function safeCheck(id, title, fn) {
  try {
    const data = await fn();
    return {
      id,
      title,
      ok: data?.ok !== false,
      level: data?.level || (data?.ok === false ? 'warn' : 'ok'),
      ...data
    };
  } catch (error) {
    return {
      id,
      title,
      ok: false,
      level: 'error',
      error: error?.message || 'check failed'
    };
  }
}

async function getRows(path) {
  const rows = await supabaseFetch(path);
  return Array.isArray(rows) ? rows : [];
}

async function checkTable(table, select = '*') {
  const rows = await getRows(`/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`);
  return { ok: true, rows: rows.length, note: rows.length ? 'таблица доступна, есть строки' : 'таблица доступна, строк может не быть' };
}

async function checkTodaySales(today) {
  const rows = await getRows(`/rest/v1/kpi_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count,avg_check&business_date=eq.${today}`)
    .catch(() => getRows(`/rest/v1/daily_sales?select=business_date,restaurant_id,revenue,checks_count,guests_count,avg_check&business_date=eq.${today}`));

  const byRestaurant = RESTAURANT_IDS.map((id) => {
    const list = rows.filter((row) => String(row.restaurant_id || '').toLowerCase() === id);
    const revenue = list.reduce((sum, row) => sum + number(row.revenue), 0);
    const checks = list.reduce((sum, row) => sum + number(row.checks_count), 0);
    const guests = list.reduce((sum, row) => sum + number(row.guests_count), 0);
    return { id, rows: list.length, revenue, revenueText: money(revenue), checks, guests };
  });

  const totalRevenue = byRestaurant.reduce((sum, item) => sum + item.revenue, 0);

  return {
    ok: true,
    rows: rows.length,
    totalRevenue,
    totalRevenueText: money(totalRevenue),
    restaurants: byRestaurant,
    note: rows.length ? 'сегодняшние KPI/дневные строки найдены' : 'за сегодня строк пока нет, это может быть нормально до первых чеков'
  };
}

async function checkRecentRows(table, orderColumn = 'updated_at') {
  const rows = await getRows(`/rest/v1/${table}?select=*&order=${orderColumn}.desc&limit=5`);
  return {
    ok: true,
    rows: rows.length,
    latest: rows[0] || null,
    note: rows.length ? `последние строки ${table} читаются` : `таблица ${table} доступна, строк нет`
  };
}

async function checkIntegrations() {
  const rows = await getRows('/rest/v1/platform_restaurant_integrations?select=restaurant_id,iiko_status,n8n_status,data_status,last_sync_at,is_enabled&order=restaurant_id.asc');
  const enabled = rows.filter((row) => row.is_enabled !== false);
  const connected = enabled.filter((row) => row.iiko_status === 'connected' && row.n8n_status === 'active' && row.data_status === 'live');
  const problems = enabled.filter((row) => row.iiko_status === 'error' || row.n8n_status === 'error' || row.data_status === 'error');

  return {
    ok: connected.length >= 2 && !problems.length,
    level: connected.length >= 2 && !problems.length ? 'ok' : 'warn',
    rows: rows.length,
    connectedCount: connected.length,
    problemsCount: problems.length,
    integrations: rows,
    note: connected.length >= 2 ? 'iiko/n8n/data live по боевым точкам виден' : 'проверь статусы интеграций в Панели КЛИК'
  };
}

async function checkDashboardSettings() {
  const rows = await getRows('/rest/v1/business_dashboard_settings?select=id,business_id,restaurant_id,updated_by,updated_at,settings&order=updated_at.desc&limit=5');
  return {
    ok: true,
    rows: rows.length,
    latest: rows[0] || null,
    note: rows.length ? 'настройки дашборда уже сохранялись в Supabase' : 'таблица настроек есть, но владелец ещё мог не сохранять изменения'
  };
}

async function checkPlatformActive() {
  const rows = await getRows('/rest/v1/platform_businesses?select=id,name,status,subscription_status,plan_name,owner_username,created_at&order=created_at.desc&limit=50');
  const active = rows.filter((item) => item.status === 'active');
  const archived = rows.filter((item) => item.status === 'archived');
  return {
    ok: active.length > 0,
    rows: rows.length,
    activeCount: active.length,
    archivedCount: archived.length,
    activeBusinesses: active.map((item) => ({ id: item.id, name: item.name, owner_username: item.owner_username, plan_name: item.plan_name, subscription_status: item.subscription_status })),
    note: active.length ? 'активные бизнесы найдены' : 'нет активных бизнесов, проверь platform_businesses'
  };
}

export async function GET(request) {
  if (!hasAdminAccess(request)) {
    return NextResponse.json({ ok: false, error: 'admin_key required' }, { status: 401 });
  }

  const now = getTyumenParts();
  const checks = await Promise.all([
    safeCheck('restaurants', 'Справочник ресторанов', () => checkTable('restaurants', 'id,name,city,is_active')),
    safeCheck('platform_businesses', 'Бизнесы платформы', checkPlatformActive),
    safeCheck('integrations', 'iiko/n8n live статус', checkIntegrations),
    safeCheck('today_sales', 'Продажи за сегодня', () => checkTodaySales(now.date)),
    safeCheck('dish_sales', 'Блюда и категории', () => checkRecentRows('dish_sales', 'business_date')),
    safeCheck('channel_sales', 'Каналы продаж', () => checkRecentRows('channel_sales', 'business_date')),
    safeCheck('hourly_sales', 'Почасовая аналитика', () => checkRecentRows('hourly_sales', 'business_date')),
    safeCheck('production_sales', 'Тип производства / цеха', () => checkRecentRows('production_sales', 'updated_at')),
    safeCheck('stop_list_items', 'Стоп-лист', () => checkRecentRows('stop_list_items', 'updated_at')),
    safeCheck('dashboard_settings', 'Настройки дашборда', checkDashboardSettings)
  ]);

  const errorCount = checks.filter((item) => item.level === 'error').length;
  const warnCount = checks.filter((item) => item.level === 'warn' || item.ok === false).length;
  const criticalIds = ['restaurants', 'platform_businesses', 'integrations', 'today_sales'];
  const criticalOk = checks.filter((item) => criticalIds.includes(item.id)).every((item) => item.ok !== false && item.level !== 'error');

  return NextResponse.json({
    ok: errorCount === 0 && criticalOk,
    status: errorCount ? 'error' : (warnCount ? 'attention' : 'ready'),
    title: errorCount ? 'Есть ошибки технического чека' : (warnCount ? 'Есть пункты на внимание' : 'КЛИК готов к показу'),
    generatedAt: now.time,
    generatedAtTyumen: now.isoLabel,
    businessDate: now.date,
    timezone: TYUMEN_TZ,
    checks,
    summary: {
      totalChecks: checks.length,
      ok: checks.filter((item) => item.ok !== false && item.level !== 'error').length,
      warnings: warnCount,
      errors: errorCount,
      criticalOk
    },
    postponed: [
      {
        id: 'iiko_cloud_stop_lists',
        title: 'Автоматический стоп-лист из iikoCloud',
        status: 'postponed',
        reason: 'нужен отдельный iikoCloud apiLogin с доступом к stop_lists/out-of-stock items',
        currentState: 'UI, таблица stop_list_items и /api/stop-list уже готовы; без apiLogin блок не выдумывает позиции'
      }
    ],
    nextRecommendedActions: [
      'Открыть Mini App и проверить главный экран по Азиаток / Акватория / Вся сеть.',
      'Проверить раздел Отчёты: ABC-анализ, цеха, стоп-лист без фейковых данных.',
      'Перед показом клиенту открыть этот /api/system-check и убедиться, что статус ready или attention без critical ошибок.'
    ]
  });
}
