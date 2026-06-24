import { supabaseFetch } from './supabaseServer';

export const ACCESS_ROLES = ['owner', 'admin', 'manager', 'viewer'];

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function cleanRole(value) {
  const role = String(value || 'viewer').trim().toLowerCase();
  return ACCESS_ROLES.includes(role) ? role : 'viewer';
}

export function displayNameFromTelegram(user = {}) {
  const first = String(user.first_name || '').trim();
  const last = String(user.last_name || '').trim();
  const username = normalizeUsername(user.username);
  return `${first} ${last}`.trim() || (username ? `@${username}` : String(user.id || 'Пользователь'));
}

export function getAdminKeyFromRequest(request, body = {}) {
  return String(
    request.headers.get('x-lumora-admin-key') ||
    request.headers.get('x-klik-admin-key') ||
    body.adminKey ||
    ''
  ).trim();
}

export function assertAdminKey(request, body = {}) {
  const expected = String(process.env.ACCESS_ADMIN_KEY || process.env.LUMORA_ACCESS_ADMIN_KEY || '').trim();
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: 'ACCESS_ADMIN_KEY is missing in Vercel Environment Variables'
    };
  }

  const actual = getAdminKeyFromRequest(request, body);
  if (actual !== expected) {
    return { ok: false, status: 401, error: 'Invalid admin key' };
  }

  return { ok: true };
}

export function telegramUserFromBody(body = {}) {
  const user = body.telegramUser || body.user || {};
  const id = user.id || user.telegram_id || body.telegram_id || body.telegramId;
  if (!id) return null;

  return {
    id: String(id),
    username: user.username || body.username || '',
    first_name: user.first_name || body.first_name || '',
    last_name: user.last_name || body.last_name || ''
  };
}

export async function upsertAppUser(user) {
  if (!user?.id) return null;

  const telegramId = String(user.id);
  const username = normalizeUsername(user.username);
  const payload = {
    telegram_id: telegramId,
    username: username || null,
    username_normalized: username || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    display_name: displayNameFromTelegram(user),
    updated_at: new Date().toISOString()
  };

  const existing = await supabaseFetch(`/rest/v1/app_users?select=*&telegram_id=eq.${encodeURIComponent(telegramId)}&limit=1`).catch(() => []);

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/app_users?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : existing[0];
  }

  const inserted = await supabaseFetch('/rest/v1/app_users', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).catch(() => null);

  return Array.isArray(inserted) ? inserted[0] : null;
}

export async function acceptPendingInvitesForUser(user) {
  const telegramId = String(user?.id || '');
  const username = normalizeUsername(user?.username);
  if (!telegramId || !username) return [];

  const invites = await supabaseFetch(`/rest/v1/app_pending_invites?select=*&username_normalized=eq.${encodeURIComponent(username)}&status=eq.pending`).catch(() => []);
  const accepted = [];

  for (const invite of Array.isArray(invites) ? invites : []) {
    const role = cleanRole(invite.role);
    const accessPayload = {
      telegram_id: telegramId,
      username,
      username_normalized: username,
      restaurant_id: String(invite.restaurant_id),
      role,
      status: 'active',
      created_by_telegram_id: invite.created_by_telegram_id || null,
      updated_at: new Date().toISOString(),
      removed_at: null
    };

    const existing = await supabaseFetch(`/rest/v1/app_user_restaurant_access?select=*&telegram_id=eq.${encodeURIComponent(telegramId)}&restaurant_id=eq.${encodeURIComponent(String(invite.restaurant_id))}&limit=1`).catch(() => []);

    if (Array.isArray(existing) && existing[0]) {
      await supabaseFetch(`/rest/v1/app_user_restaurant_access?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify(accessPayload)
      }).catch(() => null);
      accepted.push({ ...existing[0], ...accessPayload });
    } else {
      const inserted = await supabaseFetch('/rest/v1/app_user_restaurant_access', {
        method: 'POST',
        body: JSON.stringify(accessPayload)
      }).catch(() => null);
      if (Array.isArray(inserted) && inserted[0]) accepted.push(inserted[0]);
    }

    await supabaseFetch(`/rest/v1/app_pending_invites?id=eq.${invite.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'accepted',
        accepted_by_telegram_id: telegramId,
        accepted_at: new Date().toISOString()
      })
    }).catch(() => null);
  }

  return accepted;
}

export async function getAccessForTelegramId(telegramId) {
  if (!telegramId) return [];
  const rows = await supabaseFetch(`/rest/v1/app_user_restaurant_access?select=*&telegram_id=eq.${encodeURIComponent(String(telegramId))}&status=eq.active&order=created_at.desc`).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export async function getActiveRestaurants() {
  const rows = await supabaseFetch('/rest/v1/restaurants?select=id,name,city,is_active&is_active=eq.true&order=name.asc').catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

export function enrichAccessWithRestaurants(accessRows = [], restaurants = []) {
  const map = new Map(restaurants.map((item) => [String(item.id), item]));
  return accessRows.map((item) => ({
    ...item,
    restaurant: map.get(String(item.restaurant_id)) || { id: item.restaurant_id, name: item.restaurant_id, city: '' }
  }));
}
