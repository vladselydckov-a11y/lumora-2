import { NextResponse } from 'next/server';
import { assertAdminKey, cleanRole, normalizeUsername } from '../../../../lib/accessServer';
import { supabaseFetch } from '../../../../lib/supabaseServer';

function normalizeRestaurantId(value) {
  return String(value || '').trim();
}

export async function GET(request) {
  const gate = assertAdminKey(request, {});
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const { searchParams } = new URL(request.url);
  const restaurantId = normalizeRestaurantId(searchParams.get('restaurant_id'));
  const restaurantFilter = restaurantId && restaurantId !== 'all'
    ? `&restaurant_id=eq.${encodeURIComponent(restaurantId)}`
    : '';

  const [access, invites, restaurants] = await Promise.all([
    supabaseFetch(`/rest/v1/app_user_restaurant_access?select=*&status=eq.active${restaurantFilter}&order=created_at.desc`).catch(() => []),
    supabaseFetch(`/rest/v1/app_pending_invites?select=*&status=eq.pending${restaurantFilter}&order=created_at.desc`).catch(() => []),
    supabaseFetch('/rest/v1/restaurants?select=id,name,city,is_active&order=name.asc').catch(() => [])
  ]);

  return NextResponse.json({
    ok: true,
    access: Array.isArray(access) ? access : [],
    invites: Array.isArray(invites) ? invites : [],
    restaurants: Array.isArray(restaurants) ? restaurants : []
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const gate = assertAdminKey(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const restaurantId = normalizeRestaurantId(body.restaurant_id || body.restaurantId);
  const role = cleanRole(body.role);
  const username = normalizeUsername(body.username);
  const telegramId = body.telegram_id || body.telegramId ? String(body.telegram_id || body.telegramId).trim() : '';

  if (!restaurantId || restaurantId === 'all') {
    return NextResponse.json({ ok: false, error: 'restaurant_id is required and cannot be all' }, { status: 400 });
  }

  if (!username && !telegramId) {
    return NextResponse.json({ ok: false, error: 'username or telegram_id is required' }, { status: 400 });
  }

  if (telegramId) {
    const existing = await supabaseFetch(`/rest/v1/app_user_restaurant_access?select=*&telegram_id=eq.${encodeURIComponent(telegramId)}&restaurant_id=eq.${encodeURIComponent(restaurantId)}&limit=1`).catch(() => []);
    const payload = {
      telegram_id: telegramId,
      username: username || null,
      username_normalized: username || null,
      restaurant_id: restaurantId,
      role,
      status: 'active',
      updated_at: new Date().toISOString(),
      removed_at: null
    };

    if (Array.isArray(existing) && existing[0]) {
      const updated = await supabaseFetch(`/rest/v1/app_user_restaurant_access?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      return NextResponse.json({ ok: true, mode: 'access_updated', access: updated?.[0] || payload });
    }

    const inserted = await supabaseFetch('/rest/v1/app_user_restaurant_access', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return NextResponse.json({ ok: true, mode: 'access_created', access: inserted?.[0] || payload });
  }

  const invitePayload = {
    username: username ? `@${username}` : null,
    username_normalized: username,
    restaurant_id: restaurantId,
    role,
    status: 'pending',
    created_by_telegram_id: body.created_by_telegram_id || body.createdByTelegramId || null
  };

  const invite = await supabaseFetch('/rest/v1/app_pending_invites', {
    method: 'POST',
    body: JSON.stringify(invitePayload)
  });

  return NextResponse.json({
    ok: true,
    mode: 'pending_invite_created',
    invite: invite?.[0] || invitePayload,
    message: `@${username} получит доступ после первого входа в Telegram Mini App.`
  });
}

export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const gate = assertAdminKey(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const accessId = body.id || body.access_id || body.accessId;
  const inviteId = body.invite_id || body.inviteId;
  const restaurantId = normalizeRestaurantId(body.restaurant_id || body.restaurantId);
  const username = normalizeUsername(body.username);
  const telegramId = body.telegram_id || body.telegramId ? String(body.telegram_id || body.telegramId).trim() : '';

  if (accessId) {
    const updated = await supabaseFetch(`/rest/v1/app_user_restaurant_access?id=eq.${accessId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    });
    return NextResponse.json({ ok: true, mode: 'access_removed', removed: updated?.[0] || null });
  }

  if (inviteId) {
    const updated = await supabaseFetch(`/rest/v1/app_pending_invites?id=eq.${inviteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'removed', removed_at: new Date().toISOString() })
    });
    return NextResponse.json({ ok: true, mode: 'invite_removed', removed: updated?.[0] || null });
  }

  if (!restaurantId || (!username && !telegramId)) {
    return NextResponse.json({ ok: false, error: 'id or restaurant_id + username/telegram_id is required' }, { status: 400 });
  }

  const filters = [
    `restaurant_id=eq.${encodeURIComponent(restaurantId)}`,
    telegramId ? `telegram_id=eq.${encodeURIComponent(telegramId)}` : `username_normalized=eq.${encodeURIComponent(username)}`
  ].join('&');

  const updated = await supabaseFetch(`/rest/v1/app_user_restaurant_access?${filters}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  }).catch(() => []);

  await supabaseFetch(`/rest/v1/app_pending_invites?restaurant_id=eq.${encodeURIComponent(restaurantId)}&username_normalized=eq.${encodeURIComponent(username)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'removed', removed_at: new Date().toISOString() })
  }).catch(() => []);

  return NextResponse.json({ ok: true, mode: 'user_removed_from_restaurant', removed: Array.isArray(updated) ? updated : [] });
}
