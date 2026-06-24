import { NextResponse } from 'next/server';
import { assertAdminKey } from '../../../../lib/accessServer';
import { supabaseFetch } from '../../../../lib/supabaseServer';

function safeRestaurantId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('include_inactive') === 'true';
  const activeFilter = includeInactive ? '' : '&is_active=eq.true';
  const rows = await supabaseFetch(`/rest/v1/restaurants?select=id,name,city,is_active${activeFilter}&order=name.asc`).catch(() => []);
  return NextResponse.json({ ok: true, restaurants: Array.isArray(rows) ? rows : [] });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const gate = assertAdminKey(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const name = String(body.name || '').trim();
  const city = String(body.city || '').trim() || 'Город';
  const id = safeRestaurantId(body.id || body.slug || name);

  if (!id || !name) {
    return NextResponse.json({ ok: false, error: 'id/name are required' }, { status: 400 });
  }

  const existing = await supabaseFetch(`/rest/v1/restaurants?select=*&id=eq.${encodeURIComponent(id)}&limit=1`).catch(() => []);
  const payload = { id, name, city, is_active: body.is_active ?? true };

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/restaurants?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return NextResponse.json({ ok: true, mode: 'restaurant_updated', restaurant: updated?.[0] || payload });
  }

  const inserted = await supabaseFetch('/rest/v1/restaurants', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  return NextResponse.json({
    ok: true,
    mode: 'restaurant_created',
    restaurant: inserted?.[0] || payload,
    note: 'Ресторан создан в справочнике. Данные появятся после настройки iiko/n8n/Supabase для этого restaurant_id.'
  });
}

export async function PATCH(request) {
  const body = await request.json().catch(() => ({}));
  const gate = assertAdminKey(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const id = safeRestaurantId(body.id || body.restaurant_id || body.restaurantId);
  if (!id) return NextResponse.json({ ok: false, error: 'restaurant id is required' }, { status: 400 });

  const payload = {};
  if (body.name !== undefined) payload.name = String(body.name).trim();
  if (body.city !== undefined) payload.city = String(body.city).trim();
  if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active);

  const updated = await supabaseFetch(`/rest/v1/restaurants?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  return NextResponse.json({ ok: true, mode: 'restaurant_patched', restaurant: updated?.[0] || { id, ...payload } });
}
