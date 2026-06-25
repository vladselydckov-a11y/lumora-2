import { NextResponse } from 'next/server';
import { assertAdminKey } from '../../../../lib/accessServer';
import { supabaseFetch } from '../../../../lib/supabaseServer';

function safeBusinessId(value, name = '') {
  const source = String(value || name || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9а-яё_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return source || `biz_${Date.now()}`;
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function cleanStatus(value) {
  const status = String(value || 'active').trim().toLowerCase();
  return ['active', 'paused', 'archived'].includes(status) ? status : 'active';
}

function cleanSubscriptionStatus(value) {
  const status = String(value || 'trial').trim().toLowerCase();
  return ['trial', 'active', 'overdue', 'cancelled'].includes(status) ? status : 'trial';
}

async function getPlatformData() {
  const [businessesRaw, linksRaw, restaurantsRaw, adminsRaw] = await Promise.all([
    supabaseFetch('/rest/v1/platform_businesses?select=*&order=created_at.desc').catch(() => []),
    supabaseFetch('/rest/v1/platform_business_restaurants?select=*&order=created_at.asc').catch(() => []),
    supabaseFetch('/rest/v1/restaurants?select=id,name,city,is_active&order=name.asc').catch(() => []),
    supabaseFetch('/rest/v1/platform_admins?select=telegram_id,username,role,status&status=eq.active').catch(() => [])
  ]);

  const businesses = Array.isArray(businessesRaw) ? businessesRaw : [];
  const links = Array.isArray(linksRaw) ? linksRaw : [];
  const restaurants = Array.isArray(restaurantsRaw) ? restaurantsRaw : [];
  const admins = Array.isArray(adminsRaw) ? adminsRaw : [];
  const restaurantMap = new Map(restaurants.map((item) => [String(item.id), item]));

  return {
    businesses: businesses.map((business) => {
      const businessLinks = links.filter((link) => String(link.business_id) === String(business.id));
      const businessRestaurants = businessLinks.map((link) => restaurantMap.get(String(link.restaurant_id)) || {
        id: link.restaurant_id,
        name: link.restaurant_id,
        city: '',
        is_active: false
      });

      return {
        ...business,
        restaurants: businessRestaurants,
        restaurants_count: businessRestaurants.length
      };
    }),
    restaurants,
    admins
  };
}

export async function GET(request) {
  const gate = assertAdminKey(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const data = await getPlatformData();
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const gate = assertAdminKey(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const name = String(body.name || '').trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: 'Business name is required' }, { status: 400 });
  }

  const id = safeBusinessId(body.id, name);
  const restaurantIds = Array.isArray(body.restaurant_ids)
    ? body.restaurant_ids.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const payload = {
    id,
    name,
    city: String(body.city || 'Тюмень').trim() || 'Тюмень',
    status: cleanStatus(body.status),
    subscription_status: cleanSubscriptionStatus(body.subscription_status),
    plan_name: String(body.plan_name || 'pilot').trim() || 'pilot',
    owner_username: normalizeUsername(body.owner_username) || null,
    owner_telegram_id: body.owner_telegram_id ? String(body.owner_telegram_id) : null,
    notes: body.notes ? String(body.notes) : null,
    updated_at: new Date().toISOString()
  };

  const existing = await supabaseFetch(`/rest/v1/platform_businesses?select=*&id=eq.${encodeURIComponent(id)}&limit=1`).catch(() => []);

  let business;
  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/platform_businesses?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    business = Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  } else {
    const inserted = await supabaseFetch('/rest/v1/platform_businesses', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).catch(() => null);
    business = Array.isArray(inserted) ? inserted[0] : payload;
  }

  if (restaurantIds.length) {
    await supabaseFetch(`/rest/v1/platform_business_restaurants?business_id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }).catch(() => null);

    const links = restaurantIds.map((restaurantId) => ({
      business_id: id,
      restaurant_id: restaurantId
    }));

    await supabaseFetch('/rest/v1/platform_business_restaurants', {
      method: 'POST',
      body: JSON.stringify(links)
    }).catch(() => null);
  }

  const data = await getPlatformData();
  return NextResponse.json({ ok: true, business, ...data });
}
