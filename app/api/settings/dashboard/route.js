import { NextResponse } from 'next/server';
import { supabaseFetch } from '../../../../lib/supabaseServer';
import { assertApiAccess } from '../../../../lib/saasAccessGuard';

const DEFAULT_RESTAURANT_ID = 'all';

const ALLOWED_SETTING_KEYS = new Set([
  'theme',
  'accent',
  'restaurantLabel',
  'planDay',
  'planWeek',
  'planMonth',
  'weeklyPlans',
  'avgCheckTarget',
  'avgGuestTarget',
  'foodcostEnabled',
  'foodcostTarget',
  'discountLimit',
  'autoRefresh',
  'compactMode',
  'hardAccessProtection',
  'showFoodcostCard',
  'aiTone',
  'visible',
  'visibleSections'
]);

function cleanId(value, fallback = 'default') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]+/g, '_').slice(0, 120) || fallback;
}

function getPrimaryBusinessId(context, body = {}, searchParams = null) {
  const queryBusinessId = searchParams?.get?.('business_id');
  if (queryBusinessId) return cleanId(queryBusinessId);
  if (body?.business_id) return cleanId(body.business_id);

  const businessIds = Array.isArray(context?.businessIds) ? context.businessIds.filter(Boolean) : [];
  if (businessIds.length) return cleanId(businessIds[0]);

  const businessUsers = Array.isArray(context?.businessUsers) ? context.businessUsers : [];
  const businessIdFromUser = businessUsers.find((item) => item?.business_id)?.business_id;
  if (businessIdFromUser) return cleanId(businessIdFromUser);

  const telegramId = context?.user?.id || context?.user?.telegram_id || context?.user?.username;
  if (telegramId) return `telegram_${cleanId(telegramId)}`;

  return 'default_business';
}

function normalizeRestaurantId(value) {
  const id = String(value || DEFAULT_RESTAURANT_ID).trim();
  return cleanId(id || DEFAULT_RESTAURANT_ID, DEFAULT_RESTAURANT_ID);
}

function scopeId(businessId, restaurantId) {
  return `${businessId}__${restaurantId}`;
}

function sanitizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};

  for (const [key, val] of Object.entries(source)) {
    if (!ALLOWED_SETTING_KEYS.has(key)) continue;
    result[key] = val;
  }

  return result;
}

function getUpdatedBy(context) {
  return String(
    context?.user?.username ||
    context?.user?.id ||
    context?.user?.telegram_id ||
    context?.mode ||
    'system'
  );
}

async function readRow(businessId, restaurantId) {
  const id = scopeId(businessId, restaurantId);
  const rows = await supabaseFetch(
    `/rest/v1/business_dashboard_settings?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  ).catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = normalizeRestaurantId(searchParams.get('restaurant_id'));

  const guard = await assertApiAccess(request, { restaurantId, section: 'today' });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const businessId = getPrimaryBusinessId(guard.context, {}, searchParams);

  try {
    const row = await readRow(businessId, restaurantId);
    const fallbackRow = restaurantId !== DEFAULT_RESTAURANT_ID ? await readRow(businessId, DEFAULT_RESTAURANT_ID) : null;
    const settings = {
      ...(fallbackRow?.settings || {}),
      ...(row?.settings || {})
    };

    return NextResponse.json({
      ok: true,
      source: 'business_dashboard_settings',
      business_id: businessId,
      restaurant_id: restaurantId,
      settings,
      updated_at: row?.updated_at || fallbackRow?.updated_at || null,
      scope: row ? 'restaurant' : (fallbackRow ? 'business_default' : 'defaults')
    });
  } catch (error) {
    console.error('dashboard settings GET error:', error);
    return NextResponse.json({
      ok: true,
      source: 'business_dashboard_settings',
      business_id: businessId,
      restaurant_id: restaurantId,
      settings: {},
      warning: error?.message || 'dashboard settings unavailable'
    });
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const restaurantId = normalizeRestaurantId(body.restaurant_id || DEFAULT_RESTAURANT_ID);

  const guard = await assertApiAccess(request, { restaurantId, section: 'control' });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const businessId = getPrimaryBusinessId(guard.context, body, null);
  const id = scopeId(businessId, restaurantId);
  const settings = sanitizeSettings(body.settings || {});
  const now = new Date().toISOString();

  try {
    const payload = {
      id,
      business_id: businessId,
      restaurant_id: restaurantId,
      settings,
      updated_by: getUpdatedBy(guard.context),
      updated_at: now
    };

    const rows = await supabaseFetch('/rest/v1/business_dashboard_settings?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(payload)
    });

    return NextResponse.json({
      ok: true,
      source: 'business_dashboard_settings',
      business_id: businessId,
      restaurant_id: restaurantId,
      settings: rows?.[0]?.settings || settings,
      updated_at: rows?.[0]?.updated_at || now
    });
  } catch (error) {
    console.error('dashboard settings POST error:', error);
    return NextResponse.json({ ok: false, error: error?.message || 'settings save failed' }, { status: 500 });
  }
}

export async function PATCH(request) {
  return POST(request);
}
