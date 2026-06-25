import { isFreshAuthDate, parseInitData, validateTelegramInitData } from './telegram';
import {
  acceptPendingInvitesForUser,
  enrichAccessWithRestaurants,
  getAccessForTelegramId,
  getActiveRestaurants,
  normalizeUsername,
  upsertAppUser
} from './accessServer';
import { supabaseFetch } from './supabaseServer';

const ALL_SECTIONS = ['today', 'reports', 'waiters', 'ai', 'analytics', 'plan', 'risks', 'control'];

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((item) => String(item)))];
}

function extractInitData(request) {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('tma ')) return auth.slice(4).trim();
  return request.headers.get('x-telegram-init-data') || '';
}

function normalizePermissions(value, role = '') {
  const defaults = ['platform_owner', 'platform_admin', 'business_owner', 'business_admin', 'owner', 'admin'].includes(role)
    ? ALL_SECTIONS
    : role === 'manager'
      ? ['today', 'reports', 'waiters', 'analytics', 'plan', 'risks']
      : role === 'accountant'
        ? ['today', 'reports', 'analytics', 'risks']
        : role === 'employee'
          ? ['today', 'waiters']
          : ['today', 'reports', 'risks'];

  if (!value || typeof value !== 'object') {
    return { sections: defaults, can_manage_employees: ['platform_owner', 'platform_admin', 'business_owner', 'business_admin'].includes(role) };
  }

  return {
    ...value,
    sections: Array.isArray(value.sections) && value.sections.length ? value.sections : defaults,
    can_manage_employees: Boolean(value.can_manage_employees || ['platform_owner', 'platform_admin', 'business_owner', 'business_admin'].includes(role))
  };
}

function parseRestaurantIds(value) {
  if (Array.isArray(value)) return unique(value);
  if (typeof value === 'string') {
    return unique(value.replace(/[{}]/g, '').split(',').map((item) => item.replace(/"/g, '').trim()));
  }
  return [];
}

async function fetchBusinessRestaurantIds(businessIds = []) {
  const ids = unique(businessIds);
  if (!ids.length) return [];
  const filter = ids.map((id) => `"${id}"`).join(',');
  const rows = await supabaseFetch(`/rest/v1/platform_business_restaurants?select=business_id,restaurant_id&business_id=in.(${filter})`).catch(() => []);
  return unique((Array.isArray(rows) ? rows : []).map((item) => item.restaurant_id));
}

async function fetchPlatformContext(user, accessRows = []) {
  const telegramId = String(user?.id || '');
  const username = normalizeUsername(user?.username);

  if (!telegramId) {
    return {
      isPlatformOwner: false,
      businessUsers: [],
      allowedRestaurantIds: unique(accessRows.map((item) => item.restaurant_id)),
      permissions: normalizePermissions(null, 'viewer')
    };
  }

  const [adminsByTelegram, adminsByUsername, businessUsersByTelegram, businessUsersByUsername] = await Promise.all([
    supabaseFetch(`/rest/v1/platform_admins?select=telegram_id,username,role,status&telegram_id=eq.${enc(telegramId)}&status=eq.active`).catch(() => []),
    username ? supabaseFetch(`/rest/v1/platform_admins?select=telegram_id,username,role,status&username=eq.${enc(username)}&status=eq.active`).catch(() => []) : Promise.resolve([]),
    supabaseFetch(`/rest/v1/platform_business_users?select=*&telegram_id=eq.${enc(telegramId)}&status=eq.active`).catch(() => []),
    username ? supabaseFetch(`/rest/v1/platform_business_users?select=*&username_normalized=eq.${enc(username)}&status=eq.active`).catch(() => []) : Promise.resolve([])
  ]);

  const admins = [...(Array.isArray(adminsByTelegram) ? adminsByTelegram : []), ...(Array.isArray(adminsByUsername) ? adminsByUsername : [])];
  const isPlatformOwner = admins.some((item) => ['platform_owner', 'platform_admin'].includes(item.role));
  let businessUsers = [...(Array.isArray(businessUsersByTelegram) ? businessUsersByTelegram : []), ...(Array.isArray(businessUsersByUsername) ? businessUsersByUsername : [])];
  const seen = new Set();
  businessUsers = businessUsers.filter((item) => {
    const key = item.id || `${item.business_id}:${item.username_normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const usersWithoutTelegram = businessUsers.filter((item) => !item.telegram_id && item.username_normalized === username);
  await Promise.all(usersWithoutTelegram.map((item) => supabaseFetch(`/rest/v1/platform_business_users?id=eq.${enc(item.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ telegram_id: telegramId, updated_at: new Date().toISOString() })
  }).catch(() => null)));
  businessUsers = businessUsers.map((item) => item.telegram_id ? item : { ...item, telegram_id: telegramId });

  const businessIds = unique(businessUsers.map((item) => item.business_id));
  const memberRestaurantIds = unique(businessUsers.flatMap((item) => parseRestaurantIds(item.restaurant_ids)));
  const fallbackBusinessRestaurantIds = await fetchBusinessRestaurantIds(businessIds);
  const accessRestaurantIds = unique(accessRows.map((item) => item.restaurant_id));
  const allowedRestaurantIds = unique([...memberRestaurantIds, ...fallbackBusinessRestaurantIds, ...accessRestaurantIds]);
  const primaryRole = isPlatformOwner ? 'platform_owner' : (businessUsers[0]?.role || accessRows[0]?.role || 'viewer');
  const permissions = normalizePermissions(businessUsers[0]?.permissions, primaryRole);

  return {
    isPlatformOwner,
    admins,
    businessUsers,
    businessIds,
    allowedRestaurantIds,
    permissions,
    primaryRole
  };
}

export async function getSaasAccessContext(request) {
  const initData = extractInitData(request);

  if (!initData) {
    const requireTelegram = String(process.env.LUMORA_REQUIRE_TELEGRAM_API || '').toLowerCase() === 'true';
    return {
      ok: !requireTelegram,
      mode: 'dev-browser',
      status: requireTelegram ? 401 : 200,
      error: requireTelegram ? 'Telegram authorization required' : null,
      isPlatformOwner: true,
      allowedRestaurantIds: [],
      permissions: normalizePermissions(null, 'platform_owner'),
      user: { id: 'dev-browser', username: 'browser' }
    };
  }

  const botToken = process.env.BOT_TOKEN;
  const parsed = parseInitData(initData);
  const valid = validateTelegramInitData(initData, botToken);
  const fresh = isFreshAuthDate(parsed.authDate);

  if (!valid || !fresh || !parsed.user?.id) {
    return { ok: false, mode: 'telegram', status: 401, error: 'Invalid Telegram init data', user: null };
  }

  await upsertAppUser(parsed.user).catch(() => null);
  await acceptPendingInvitesForUser(parsed.user).catch(() => []);
  const [restaurants, rawAccess] = await Promise.all([
    getActiveRestaurants().catch(() => []),
    getAccessForTelegramId(parsed.user.id).catch(() => [])
  ]);
  const accessRows = enrichAccessWithRestaurants(rawAccess || [], restaurants || []).filter((item) => item.status === 'active');
  const platform = await fetchPlatformContext(parsed.user, accessRows);
  const hasAccess = Boolean(platform.isPlatformOwner || platform.businessUsers.length || accessRows.length);

  return {
    ok: true,
    mode: 'telegram',
    user: parsed.user,
    restaurants,
    accessRows,
    isPlatformOwner: platform.isPlatformOwner,
    businessUsers: platform.businessUsers,
    businessIds: platform.businessIds || [],
    allowedRestaurantIds: platform.isPlatformOwner ? unique((restaurants || []).map((item) => item.id)) : platform.allowedRestaurantIds,
    permissions: platform.permissions,
    primaryRole: platform.primaryRole,
    hasAccess
  };
}

export function canAccessSection(context, sectionId = 'today') {
  if (!context?.ok) return false;
  if (context.mode === 'dev-browser') return true;
  if (context.isPlatformOwner) return true;
  const sections = context.permissions?.sections || [];
  return sections.includes(sectionId);
}

export function canAccessRestaurant(context, restaurantId = 'all') {
  if (!context?.ok) return false;
  if (context.mode === 'dev-browser') return true;
  if (context.isPlatformOwner) return true;
  if (!context.hasAccess) return false;

  const allowed = unique(context.allowedRestaurantIds || []);
  if (restaurantId === 'all') {
    // Для владельца бизнеса “Вся сеть” разрешена только в пределах его business_users.
    // Текущий Supabase summary пока считает сеть по активным точкам, поэтому полную бизнес-изоляцию сети включим следующим этапом.
    return context.businessUsers?.length > 0 && allowed.length > 0;
  }

  return allowed.includes(String(restaurantId));
}

export async function assertApiAccess(request, { restaurantId = 'all', section = 'today' } = {}) {
  const context = await getSaasAccessContext(request);

  if (!context.ok) {
    return {
      ok: false,
      status: context.status || 401,
      body: { ok: false, error: context.error || 'Access denied', mode: context.mode || 'unknown' },
      context
    };
  }

  if (context.mode === 'telegram' && !context.hasAccess && !context.isPlatformOwner) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, error: 'Доступ не выдан', code: 'NO_ACCESS' },
      context
    };
  }

  if (!canAccessSection(context, section)) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, error: 'Раздел недоступен для этой роли', code: 'SECTION_FORBIDDEN', section },
      context
    };
  }

  if (!canAccessRestaurant(context, restaurantId)) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, error: 'Нет доступа к этому ресторану', code: 'RESTAURANT_FORBIDDEN', restaurant_id: restaurantId },
      context
    };
  }

  return { ok: true, status: 200, context };
}
