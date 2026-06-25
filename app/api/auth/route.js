import { NextResponse } from 'next/server';
import { isFreshAuthDate, parseInitData, validateTelegramInitData } from '../../../lib/telegram';
import {
  acceptPendingInvitesForUser,
  enrichAccessWithRestaurants,
  upsertAppUser,
  getAccessForTelegramId,
  getActiveRestaurants,
  normalizeUsername
} from '../../../lib/accessServer';
import { supabaseFetch } from '../../../lib/supabaseServer';

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function uniqueByKey(rows = [], key = 'id') {
  const seen = new Set();
  return rows.filter((item) => {
    const value = item?.[key] || JSON.stringify(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function byBusinessId(rows = []) {
  const map = new Map();
  rows.forEach((item) => {
    const id = item?.business_id;
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(item);
  });
  return map;
}

const ALL_SECTIONS = ['today', 'reports', 'waiters', 'ai', 'analytics', 'plan', 'risks', 'control'];

function defaultSectionsForRole(role = '') {
  if (['platform_owner', 'platform_admin', 'business_owner', 'business_admin', 'owner', 'admin'].includes(role)) return ALL_SECTIONS;
  if (role === 'accountant') return ['today', 'reports', 'analytics', 'risks'];
  if (role === 'manager') return ['today', 'reports', 'waiters', 'analytics', 'plan', 'risks'];
  if (role === 'viewer') return ['today', 'reports', 'risks'];
  if (role === 'employee') return ['today', 'waiters'];
  return ['today'];
}

function normalizePermissions(value, role = '') {
  const defaults = defaultSectionsForRole(role);
  if (!value || typeof value !== 'object') {
    return { sections: defaults, can_manage_employees: ['platform_owner', 'business_owner', 'business_admin'].includes(role) };
  }
  return {
    ...value,
    sections: Array.isArray(value.sections) && value.sections.length ? value.sections : defaults,
    can_manage_employees: Boolean(value.can_manage_employees || ['platform_owner', 'business_owner', 'business_admin'].includes(role))
  };
}

function buildUiAccess({ mode = 'telegram', user = {}, enrichedAccess = [], platform = {} }) {
  const isPlatformOwner = Boolean(platform?.isPlatformOwner || platform?.role === 'platform_owner');
  const businessUsers = Array.isArray(platform?.businessUsers) ? platform.businessUsers : [];
  const businesses = Array.isArray(platform?.businesses) ? platform.businesses : [];
  const activeAccess = Array.isArray(enrichedAccess) ? enrichedAccess.filter((item) => item?.status === 'active') : [];
  const primaryBusinessUser = businessUsers.find((item) => item.role === 'business_owner') || businessUsers[0] || null;
  const primaryRole = isPlatformOwner ? 'platform_owner' : (primaryBusinessUser?.role || activeAccess[0]?.role || 'no_access');
  const permissions = normalizePermissions(primaryBusinessUser?.permissions, primaryRole);
  const visibleRestaurantIds = isPlatformOwner
    ? []
    : [...new Set(activeAccess.map((item) => item.restaurant_id).filter(Boolean))];

  return {
    mode,
    telegram_id: user?.id ? String(user.id) : null,
    username: user?.username || null,
    role: primaryRole,
    is_platform_owner: isPlatformOwner,
    has_business_access: businesses.length > 0,
    has_restaurant_access: activeAccess.length > 0,
    no_access: mode === 'telegram' ? !(isPlatformOwner || businesses.length || activeAccess.length) : false,
    visible_business_ids: isPlatformOwner ? [] : businesses.map((item) => item.id).filter(Boolean),
    visible_restaurant_ids: visibleRestaurantIds,
    permissions,
    visible_sections: isPlatformOwner ? ALL_SECTIONS : permissions.sections,
    can_manage_employees: Boolean(isPlatformOwner || permissions.can_manage_employees),
    entry: isPlatformOwner ? 'platform' : businesses.length ? 'client' : activeAccess.length ? 'dashboard' : 'no_access'
  };
}

async function fetchPlatformForUser(user, accessRows = [], restaurants = []) {
  try {
    if (!user?.id) {
      return {
        isPlatformOwner: false,
        admins: [],
        businessUsers: [],
        businesses: [],
        note: 'Нет Telegram ID для проверки платформенных ролей.'
      };
    }

    const telegramId = String(user.id);
    const username = normalizeUsername(user.username);

    const [adminsByTelegram, adminsByUsername, businessUsersByTelegram, businessUsersByUsername] = await Promise.all([
      supabaseFetch(`/rest/v1/platform_admins?select=telegram_id,username,role,status&telegram_id=eq.${enc(telegramId)}&status=eq.active`).catch(() => []),
      username ? supabaseFetch(`/rest/v1/platform_admins?select=telegram_id,username,role,status&username=eq.${enc(username)}&status=eq.active`).catch(() => []) : Promise.resolve([]),
      supabaseFetch(`/rest/v1/platform_business_users?select=*&telegram_id=eq.${enc(telegramId)}&status=eq.active`).catch(() => []),
      username ? supabaseFetch(`/rest/v1/platform_business_users?select=*&username_normalized=eq.${enc(username)}&status=eq.active`).catch(() => []) : Promise.resolve([])
    ]);

    const admins = uniqueByKey([...(adminsByTelegram || []), ...(adminsByUsername || [])], 'telegram_id');
    let businessUsers = uniqueByKey([...(businessUsersByTelegram || []), ...(businessUsersByUsername || [])], 'id');

    const usersWithoutTelegram = businessUsers.filter((item) => !item.telegram_id && item.username_normalized === username);
    await Promise.all(usersWithoutTelegram.map((item) => supabaseFetch(`/rest/v1/platform_business_users?id=eq.${enc(item.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ telegram_id: telegramId, updated_at: new Date().toISOString() })
    }).catch(() => null)));
    businessUsers = businessUsers.map((item) => item.telegram_id ? item : { ...item, telegram_id: telegramId });

    const isPlatformOwner = admins.some((item) => item.role === 'platform_owner' || item.role === 'platform_admin');
    const businessIds = [...new Set(businessUsers.map((item) => item.business_id).filter(Boolean))];

    let businesses = [];
    if (isPlatformOwner || businessIds.length) {
      const allBusinesses = await supabaseFetch('/rest/v1/platform_businesses?select=*&order=created_at.desc').catch(() => []);
      const allLinks = await supabaseFetch('/rest/v1/platform_business_restaurants?select=*&order=created_at.asc').catch(() => []);
      const allBusinessUsers = await supabaseFetch('/rest/v1/platform_business_users?select=*&status=eq.active&order=created_at.desc').catch(() => []);
      const allPayments = await supabaseFetch('/rest/v1/platform_payments?select=*&order=created_at.desc').catch(() => []);

      const visibleBusinesses = isPlatformOwner
        ? (Array.isArray(allBusinesses) ? allBusinesses : [])
        : (Array.isArray(allBusinesses) ? allBusinesses : []).filter((business) => businessIds.includes(business.id));

      const linksByBusiness = byBusinessId(Array.isArray(allLinks) ? allLinks : []);
      const usersByBusiness = byBusinessId(Array.isArray(allBusinessUsers) ? allBusinessUsers : []);
      const paymentsByBusiness = byBusinessId(Array.isArray(allPayments) ? allPayments : []);
      const restaurantMap = new Map((Array.isArray(restaurants) ? restaurants : []).map((item) => [String(item.id), item]));

      businesses = visibleBusinesses.map((business) => {
        const links = linksByBusiness.get(business.id) || [];
        const businessRestaurants = links.map((link) => restaurantMap.get(String(link.restaurant_id)) || { id: link.restaurant_id, name: link.restaurant_id, city: business.city, is_active: true });
        const users = usersByBusiness.get(business.id) || [];
        const payments = paymentsByBusiness.get(business.id) || [];
        return {
          ...business,
          restaurants: businessRestaurants,
          restaurants_count: businessRestaurants.length,
          users,
          payments,
          payments_count: payments.length,
          paid_total: payments.filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount || 0), 0),
          access_count: (accessRows || []).filter((item) => businessRestaurants.map((restaurant) => restaurant.id).includes(item.restaurant_id)).length
        };
      });
    }

    return {
      isPlatformOwner,
      role: isPlatformOwner ? 'platform_owner' : (businessUsers[0]?.role || ''),
      admins,
      businessUsers,
      businesses,
      businessIds,
      note: isPlatformOwner ? 'Пользователь видит кабинет владельца платформы.' : businessUsers.length ? 'Пользователь видит кабинет своего бизнеса.' : 'Платформенных бизнес-ролей нет.'
    };
  } catch (error) {
    return {
      isPlatformOwner: false,
      admins: [],
      businessUsers: [],
      businesses: [],
      error: error?.message || 'platform_access_failed'
    };
  }
}

async function buildAccessPayload(user) {
  try {
    if (!user || !user.id) {
      return { access: [], restaurants: [], acceptedInvites: [], platform: { isPlatformOwner: false, businessUsers: [], businesses: [] } };
    }

    await upsertAppUser(user);
    const acceptedInvites = await acceptPendingInvitesForUser(user);
    const access = await getAccessForTelegramId(user.id);
    const restaurants = await getActiveRestaurants();
    const enrichedAccess = enrichAccessWithRestaurants(access, restaurants);
    const platform = await fetchPlatformForUser(user, enrichedAccess, restaurants);

    return {
      access: enrichedAccess,
      restaurants,
      acceptedInvites,
      platform,
      ui: buildUiAccess({ mode: 'telegram', user, enrichedAccess, platform })
    };
  } catch (error) {
    return {
      access: [],
      restaurants: [],
      acceptedInvites: [],
      platform: { isPlatformOwner: false, businessUsers: [], businesses: [], error: error?.message || 'platform_access_failed' },
      ui: buildUiAccess({ mode: 'telegram', user, enrichedAccess: [], platform: {} }),
      accessError: error?.message || 'access_check_failed'
    };
  }
}

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const [, initData] = authHeader.match(/^tma\s+(.+)$/i) || [];

  if (!initData) {
    return NextResponse.json({
      ok: true,
      mode: 'demo-browser',
      user: { id: 'demo', first_name: 'Демо', username: 'browser' },
      access: [],
      restaurants: [],
      acceptedInvites: [],
      platform: {
        isPlatformOwner: false,
        businessUsers: [],
        businesses: [],
        note: 'Браузер без Telegram: dev/admin-режим. Клиентские роли проверяются только в Mini App.'
      },
      ui: buildUiAccess({ mode: 'demo-browser', user: { id: 'demo', username: 'browser' }, enrichedAccess: [], platform: {} }),
      note: 'Telegram initData отсутствует. В браузере доступы не привязываются, это нормально.'
    });
  }

  const botToken = process.env.BOT_TOKEN;
  const parsed = parseInitData(initData);
  const valid = validateTelegramInitData(initData, botToken);
  const fresh = isFreshAuthDate(parsed.authDate);

  if (!valid || !fresh) {
    return NextResponse.json({ ok: false, error: 'Invalid Telegram init data' }, { status: 401 });
  }

  const accessPayload = await buildAccessPayload(parsed.user);

  return NextResponse.json({
    ok: true,
    mode: 'telegram',
    user: parsed.user,
    ...accessPayload
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: 'auth-ready-stage16',
    note: 'Use POST with Authorization: tma <Telegram initData>. Stage 16 returns SaaS access: platform owner, business owner, employee permissions and no_access state.'
  });
}
