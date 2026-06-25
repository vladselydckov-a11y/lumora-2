import { NextResponse } from 'next/server';
import { isFreshAuthDate, parseInitData, validateTelegramInitData } from '../../../../lib/telegram';
import { assertAdminKey, cleanRole, normalizeUsername } from '../../../../lib/accessServer';
import { supabaseFetch } from '../../../../lib/supabaseServer';

const ALL_SECTIONS = ['today', 'reports', 'waiters', 'ai', 'analytics', 'plan', 'risks', 'control'];

function enc(value) {
  return encodeURIComponent(String(value || ''));
}

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function cleanBusinessRole(value) {
  const role = String(value || 'viewer').trim().toLowerCase();
  return ['business_owner', 'business_admin', 'manager', 'employee', 'accountant', 'viewer'].includes(role) ? role : 'viewer';
}

function defaultSectionsForRole(role = '') {
  if (['business_owner', 'business_admin'].includes(role)) return ALL_SECTIONS;
  if (role === 'accountant') return ['today', 'reports', 'analytics', 'risks'];
  if (role === 'manager') return ['today', 'reports', 'waiters', 'analytics', 'plan', 'risks'];
  if (role === 'employee') return ['today', 'waiters'];
  return ['today', 'reports', 'risks'];
}

function cleanPermissions(value = {}, role = '') {
  const source = value && typeof value === 'object' ? value : {};
  const sections = unique(source.sections || defaultSectionsForRole(role)).filter((item) => ALL_SECTIONS.includes(item));
  return {
    sections: sections.length ? sections : defaultSectionsForRole(role),
    can_manage_employees: Boolean(source.can_manage_employees || ['business_owner', 'business_admin'].includes(role))
  };
}

function getTelegramInitData(request) {
  const authHeader = request.headers.get('authorization') || '';
  const [, initData] = authHeader.match(/^tma\s+(.+)$/i) || [];
  return initData || '';
}

async function fetchOptional(path) {
  const rows = await supabaseFetch(path).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function getBusinessRestaurantIds(businessId) {
  const links = await fetchOptional(`/rest/v1/platform_business_restaurants?select=restaurant_id&business_id=eq.${enc(businessId)}`);
  return unique(links.map((item) => item.restaurant_id));
}

async function assertBusinessManager(request, body = {}) {
  const adminGate = assertAdminKey(request, body);
  if (adminGate.ok) return { ok: true, mode: 'admin_key', isPlatformOwner: true, allowedBusinessIds: [] };

  const initData = getTelegramInitData(request);
  if (!initData) return { ok: false, error: 'Telegram auth required', status: 401 };

  const parsed = parseInitData(initData);
  const valid = validateTelegramInitData(initData, process.env.BOT_TOKEN);
  const fresh = isFreshAuthDate(parsed.authDate);
  const user = parsed.user || {};

  if (!valid || !fresh || !user.id) {
    return { ok: false, error: 'Invalid Telegram auth', status: 401 };
  }

  const telegramId = String(user.id);
  const username = normalizeUsername(user.username);

  const [adminsByTelegram, adminsByUsername, usersByTelegram, usersByUsername] = await Promise.all([
    fetchOptional(`/rest/v1/platform_admins?select=telegram_id,username,role,status&telegram_id=eq.${enc(telegramId)}&status=eq.active`),
    username ? fetchOptional(`/rest/v1/platform_admins?select=telegram_id,username,role,status&username=eq.${enc(username)}&status=eq.active`) : Promise.resolve([]),
    fetchOptional(`/rest/v1/platform_business_users?select=*&telegram_id=eq.${enc(telegramId)}&status=eq.active`),
    username ? fetchOptional(`/rest/v1/platform_business_users?select=*&username_normalized=eq.${enc(username)}&status=eq.active`) : Promise.resolve([])
  ]);

  const admins = [...adminsByTelegram, ...adminsByUsername];
  const isPlatformOwner = admins.some((item) => ['platform_owner', 'platform_admin'].includes(item.role));
  const businessUsers = [...usersByTelegram, ...usersByUsername].filter((item, index, arr) => arr.findIndex((row) => row.id === item.id) === index);
  const managerRows = businessUsers.filter((item) => ['business_owner', 'business_admin'].includes(item.role) || item.permissions?.can_manage_employees);

  if (!isPlatformOwner && !managerRows.length) {
    return { ok: false, error: 'Business owner/admin access required', status: 403 };
  }

  return {
    ok: true,
    mode: isPlatformOwner ? 'telegram_platform_owner' : 'telegram_business_manager',
    user,
    telegramId,
    username,
    isPlatformOwner,
    allowedBusinessIds: isPlatformOwner ? [] : unique(managerRows.map((item) => item.business_id)),
    businessUsers: managerRows
  };
}

function canManageBusiness(gate, businessId) {
  if (gate.isPlatformOwner) return true;
  return gate.allowedBusinessIds.includes(String(businessId || ''));
}

async function getMembersPayload(businessId) {
  const businessIdsFilter = businessId ? `&business_id=eq.${enc(businessId)}` : '';
  const members = await fetchOptional(`/rest/v1/platform_business_users?select=*&status=eq.active${businessIdsFilter}&order=created_at.desc`);
  const businessIds = unique(members.map((item) => item.business_id).concat(businessId ? [businessId] : []));

  let restaurantIds = [];
  for (const id of businessIds) {
    restaurantIds = restaurantIds.concat(await getBusinessRestaurantIds(id));
  }
  restaurantIds = unique(restaurantIds);

  const restaurantsFilter = restaurantIds.length ? `&id=in.(${restaurantIds.map(enc).join(',')})` : '';
  const restaurants = restaurantIds.length ? await fetchOptional(`/rest/v1/restaurants?select=id,name,city,is_active${restaurantsFilter}`) : [];

  const accessParts = [];
  const inviteParts = [];
  for (const restaurantId of restaurantIds) {
    accessParts.push(...await fetchOptional(`/rest/v1/app_user_restaurant_access?select=*&restaurant_id=eq.${enc(restaurantId)}&status=eq.active`));
    inviteParts.push(...await fetchOptional(`/rest/v1/app_pending_invites?select=*&restaurant_id=eq.${enc(restaurantId)}&status=eq.pending`));
  }

  return {
    members: members.map((member) => ({ ...member, permissions: cleanPermissions(member.permissions, member.role) })),
    restaurants,
    access: accessParts,
    invites: inviteParts
  };
}

async function upsertPendingInvite({ username, restaurantId, role, createdByTelegramId }) {
  const normalized = normalizeUsername(username);
  if (!normalized || !restaurantId) return null;

  const existing = await fetchOptional(`/rest/v1/app_pending_invites?select=*&username_normalized=eq.${enc(normalized)}&restaurant_id=eq.${enc(restaurantId)}&status=eq.pending&limit=1`);
  const payload = {
    username: `@${normalized}`,
    username_normalized: normalized,
    restaurant_id: restaurantId,
    role: cleanRole(role),
    status: 'pending',
    created_by_telegram_id: createdByTelegramId || null,
    removed_at: null
  };

  if (existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/app_pending_invites?id=eq.${enc(existing[0].id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  }

  const inserted = await supabaseFetch('/rest/v1/app_pending_invites', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).catch(() => null);
  return Array.isArray(inserted) ? inserted[0] : payload;
}

async function upsertActiveRestaurantAccess({ telegramId, username, restaurantId, role, createdByTelegramId }) {
  if (!telegramId || !restaurantId) return null;
  const normalized = normalizeUsername(username);
  const existing = await fetchOptional(`/rest/v1/app_user_restaurant_access?select=*&telegram_id=eq.${enc(telegramId)}&restaurant_id=eq.${enc(restaurantId)}&limit=1`);
  const payload = {
    telegram_id: String(telegramId),
    username: normalized || null,
    username_normalized: normalized || null,
    restaurant_id: restaurantId,
    role: cleanRole(role),
    status: 'active',
    created_by_telegram_id: createdByTelegramId || null,
    removed_at: null,
    updated_at: new Date().toISOString()
  };

  if (existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/app_user_restaurant_access?id=eq.${enc(existing[0].id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  }

  const inserted = await supabaseFetch('/rest/v1/app_user_restaurant_access', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).catch(() => null);
  return Array.isArray(inserted) ? inserted[0] : payload;
}

function restaurantRoleFromBusinessRole(role) {
  if (role === 'business_owner') return 'owner';
  if (role === 'business_admin' || role === 'manager') return 'admin';
  return 'viewer';
}

async function addOrUpdateMember(body, gate) {
  const businessId = cleanText(body.business_id || body.businessId);
  const username = normalizeUsername(body.username);
  const telegramId = body.telegram_id || body.telegramId ? String(body.telegram_id || body.telegramId).trim() : '';
  if (!businessId) throw new Error('business_id is required');
  if (!username && !telegramId) throw new Error('username or telegram_id is required');
  if (!canManageBusiness(gate, businessId)) throw new Error('No access to this business');

  const businessRestaurantIds = await getBusinessRestaurantIds(businessId);
  const requestedRestaurantIds = unique(body.restaurant_ids || body.restaurantIds || businessRestaurantIds).filter((id) => businessRestaurantIds.includes(id));
  const role = cleanBusinessRole(body.role || body.business_role || body.businessRole);
  const permissions = cleanPermissions(body.permissions, role);
  const now = new Date().toISOString();

  const existing = username
    ? await fetchOptional(`/rest/v1/platform_business_users?select=*&business_id=eq.${enc(businessId)}&username_normalized=eq.${enc(username)}&limit=1`)
    : await fetchOptional(`/rest/v1/platform_business_users?select=*&business_id=eq.${enc(businessId)}&telegram_id=eq.${enc(telegramId)}&limit=1`);

  const payload = {
    business_id: businessId,
    username: username ? `@${username}` : null,
    username_normalized: username || null,
    telegram_id: telegramId || null,
    role,
    status: 'active',
    permissions,
    restaurant_ids: requestedRestaurantIds,
    removed_at: null,
    updated_at: now
  };

  let member;
  if (existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/platform_business_users?id=eq.${enc(existing[0].id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    member = Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  } else {
    const inserted = await supabaseFetch('/rest/v1/platform_business_users', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).catch(() => null);
    member = Array.isArray(inserted) ? inserted[0] : payload;
  }

  const restaurantRole = restaurantRoleFromBusinessRole(role);
  for (const restaurantId of requestedRestaurantIds) {
    if (telegramId) {
      await upsertActiveRestaurantAccess({ telegramId, username, restaurantId, role: restaurantRole, createdByTelegramId: gate.telegramId });
    } else {
      await upsertPendingInvite({ username, restaurantId, role: restaurantRole, createdByTelegramId: gate.telegramId });
    }
  }

  return member;
}

async function removeMember(body, gate) {
  const businessId = cleanText(body.business_id || body.businessId);
  const memberId = cleanText(body.member_id || body.memberId || body.id);
  if (!businessId || !memberId) throw new Error('business_id and member_id are required');
  if (!canManageBusiness(gate, businessId)) throw new Error('No access to this business');

  const members = await fetchOptional(`/rest/v1/platform_business_users?select=*&id=eq.${enc(memberId)}&business_id=eq.${enc(businessId)}&limit=1`);
  const member = members[0];
  if (!member) throw new Error('Member not found');
  if (member.role === 'business_owner' && !gate.isPlatformOwner) throw new Error('Only platform owner can remove business owner');

  const now = new Date().toISOString();
  await supabaseFetch(`/rest/v1/platform_business_users?id=eq.${enc(memberId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'removed', removed_at: now, updated_at: now })
  }).catch(() => null);

  const restaurantIds = await getBusinessRestaurantIds(businessId);
  const normalized = normalizeUsername(member.username_normalized || member.username);

  for (const restaurantId of restaurantIds) {
    if (member.telegram_id) {
      await supabaseFetch(`/rest/v1/app_user_restaurant_access?telegram_id=eq.${enc(member.telegram_id)}&restaurant_id=eq.${enc(restaurantId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'removed', removed_at: now, updated_at: now })
      }).catch(() => null);
    }
    if (normalized) {
      await supabaseFetch(`/rest/v1/app_pending_invites?username_normalized=eq.${enc(normalized)}&restaurant_id=eq.${enc(restaurantId)}&status=eq.pending`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'removed', removed_at: now })
      }).catch(() => null);
    }
  }

  return member;
}

export async function GET(request) {
  const gate = await assertBusinessManager(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const { searchParams } = new URL(request.url);
  const businessId = cleanText(searchParams.get('business_id'));
  if (!businessId) return NextResponse.json({ ok: false, error: 'business_id is required' }, { status: 400 });
  if (!canManageBusiness(gate, businessId)) return NextResponse.json({ ok: false, error: 'No access to this business' }, { status: 403 });

  const payload = await getMembersPayload(businessId);
  return NextResponse.json({ ok: true, auth_mode: gate.mode, business_id: businessId, ...payload });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const gate = await assertBusinessManager(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const action = String(body.action || 'add_member').trim();
  const businessId = cleanText(body.business_id || body.businessId);

  try {
    if (action === 'add_member' || action === 'update_member') {
      await addOrUpdateMember(body, gate);
    } else if (action === 'remove_member') {
      await removeMember(body, gate);
    } else {
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    const payload = await getMembersPayload(businessId);
    return NextResponse.json({ ok: true, auth_mode: gate.mode, action, business_id: businessId, ...payload });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Business members action failed' }, { status: 400 });
  }
}

export async function PATCH(request) {
  return POST(request);
}
