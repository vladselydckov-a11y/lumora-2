import { NextResponse } from 'next/server';
import { isFreshAuthDate, parseInitData, validateTelegramInitData } from '../../../../lib/telegram';
import { assertAdminKey, cleanRole, normalizeUsername } from '../../../../lib/accessServer';
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

function safeRestaurantId(value, name = '') {
  const source = String(value || name || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9а-яё_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return source || `restaurant_${Date.now()}`;
}

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function cleanStatus(value) {
  const status = String(value || 'active').trim().toLowerCase();
  return ['active', 'paused', 'archived'].includes(status) ? status : 'active';
}

function cleanSubscriptionStatus(value) {
  const status = String(value || 'trial').trim().toLowerCase();
  return ['trial', 'active', 'overdue', 'cancelled'].includes(status) ? status : 'trial';
}

function cleanPaymentStatus(value) {
  const status = String(value || 'pending').trim().toLowerCase();
  return ['pending', 'paid', 'overdue', 'cancelled', 'refunded'].includes(status) ? status : 'pending';
}

function cleanBusinessRole(value) {
  const role = String(value || 'business_owner').trim().toLowerCase();
  return ['business_owner', 'business_admin', 'accountant', 'viewer'].includes(role) ? role : 'business_owner';
}

function unique(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function encode(value) {
  return encodeURIComponent(String(value || ''));
}

function getTelegramInitData(request) {
  const authHeader = request.headers.get('authorization') || '';
  const [, initData] = authHeader.match(/^tma\s+(.+)$/i) || [];
  return initData || '';
}

async function assertPlatformAccess(request, body = {}) {
  const adminGate = assertAdminKey(request, body);
  if (adminGate.ok) return { ...adminGate, mode: 'admin_key' };

  const initData = getTelegramInitData(request);
  if (!initData) return adminGate;

  const parsed = parseInitData(initData);
  const valid = validateTelegramInitData(initData, process.env.BOT_TOKEN);
  const fresh = isFreshAuthDate(parsed.authDate);
  const user = parsed.user || {};

  if (!valid || !fresh || !user.id) {
    return { ok: false, error: 'Invalid Telegram platform auth', status: 401 };
  }

  const telegramId = String(user.id);
  const username = normalizeUsername(user.username);

  const [byTelegram, byUsername] = await Promise.all([
    supabaseFetch(`/rest/v1/platform_admins?select=telegram_id,username,role,status&telegram_id=eq.${encode(telegramId)}&status=eq.active`).catch(() => []),
    username ? supabaseFetch(`/rest/v1/platform_admins?select=telegram_id,username,role,status&username=eq.${encode(username)}&status=eq.active`).catch(() => []) : Promise.resolve([])
  ]);

  const admins = [...(Array.isArray(byTelegram) ? byTelegram : []), ...(Array.isArray(byUsername) ? byUsername : [])];
  const admin = admins.find((item) => ['platform_owner', 'platform_admin'].includes(item.role));

  if (!admin) {
    return { ok: false, error: 'Platform owner access required', status: 403 };
  }

  return { ok: true, mode: 'telegram_platform_owner', user, admin };
}

function businessPayloadFromBody(body, id) {
  const payload = {
    id,
    name: cleanText(body.name, 'Новый бизнес'),
    city: cleanText(body.city, 'Тюмень'),
    status: cleanStatus(body.status),
    subscription_status: cleanSubscriptionStatus(body.subscription_status),
    plan_name: cleanText(body.plan_name, 'pilot'),
    owner_username: normalizeUsername(body.owner_username) || null,
    owner_telegram_id: body.owner_telegram_id ? String(body.owner_telegram_id).trim() : null,
    notes: body.notes !== undefined ? String(body.notes || '') : null,
    updated_at: new Date().toISOString()
  };

  return payload;
}

async function fetchOptional(path) {
  const rows = await supabaseFetch(path).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function replaceBusinessRestaurants(businessId, restaurantIds = []) {
  const ids = unique(restaurantIds);
  await supabaseFetch(`/rest/v1/platform_business_restaurants?business_id=eq.${encode(businessId)}`, {
    method: 'DELETE'
  }).catch(() => null);

  if (!ids.length) return [];

  const links = ids.map((restaurantId) => ({ business_id: businessId, restaurant_id: restaurantId }));
  const inserted = await supabaseFetch('/rest/v1/platform_business_restaurants', {
    method: 'POST',
    body: JSON.stringify(links)
  }).catch(() => links);

  return Array.isArray(inserted) ? inserted : links;
}

async function addPendingInvite({ username, restaurantId, role = 'owner', createdByTelegramId = null }) {
  const normalized = normalizeUsername(username);
  if (!normalized || !restaurantId) return null;

  const invitePayload = {
    username: `@${normalized}`,
    username_normalized: normalized,
    restaurant_id: restaurantId,
    role: cleanRole(role),
    status: 'pending',
    created_by_telegram_id: createdByTelegramId
  };

  const existing = await supabaseFetch(`/rest/v1/app_pending_invites?select=*&username_normalized=eq.${encode(normalized)}&restaurant_id=eq.${encode(restaurantId)}&status=eq.pending&limit=1`).catch(() => []);

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/app_pending_invites?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...invitePayload, removed_at: null })
    }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : { ...existing[0], ...invitePayload };
  }

  const inserted = await supabaseFetch('/rest/v1/app_pending_invites', {
    method: 'POST',
    body: JSON.stringify(invitePayload)
  }).catch(() => null);

  return Array.isArray(inserted) ? inserted[0] : invitePayload;
}

async function getPlatformData() {
  const [businessesRaw, linksRaw, restaurantsRaw, adminsRaw, usersRaw, paymentsRaw, accessRaw, invitesRaw] = await Promise.all([
    fetchOptional('/rest/v1/platform_businesses?select=*&order=created_at.desc'),
    fetchOptional('/rest/v1/platform_business_restaurants?select=*&order=created_at.asc'),
    fetchOptional('/rest/v1/restaurants?select=id,name,city,is_active&order=name.asc'),
    fetchOptional('/rest/v1/platform_admins?select=telegram_id,username,role,status&status=eq.active'),
    fetchOptional('/rest/v1/platform_business_users?select=*&status=eq.active&order=created_at.desc'),
    fetchOptional('/rest/v1/platform_payments?select=*&order=created_at.desc'),
    fetchOptional('/rest/v1/app_user_restaurant_access?select=*&status=eq.active&order=created_at.desc'),
    fetchOptional('/rest/v1/app_pending_invites?select=*&status=eq.pending&order=created_at.desc')
  ]);

  const businesses = businessesRaw;
  const links = linksRaw;
  const restaurants = restaurantsRaw;
  const admins = adminsRaw;
  const businessUsers = usersRaw;
  const payments = paymentsRaw;
  const access = accessRaw;
  const invites = invitesRaw;
  const restaurantMap = new Map(restaurants.map((item) => [String(item.id), item]));

  const enrichedBusinesses = businesses.map((business) => {
    const businessId = String(business.id);
    const businessLinks = links.filter((link) => String(link.business_id) === businessId);
    const businessRestaurants = businessLinks.map((link) => restaurantMap.get(String(link.restaurant_id)) || {
      id: link.restaurant_id,
      name: link.restaurant_id,
      city: '',
      is_active: false
    });
    const restaurantIds = businessRestaurants.map((item) => String(item.id));
    const businessPayments = payments.filter((payment) => String(payment.business_id) === businessId);
    const paidTotal = businessPayments
      .filter((payment) => payment.status === 'paid')
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const pendingTotal = businessPayments
      .filter((payment) => payment.status === 'pending' || payment.status === 'overdue')
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const businessAccess = access.filter((item) => restaurantIds.includes(String(item.restaurant_id)));
    const businessInvites = invites.filter((item) => restaurantIds.includes(String(item.restaurant_id)));
    const users = businessUsers.filter((user) => String(user.business_id) === businessId);

    return {
      ...business,
      restaurants: businessRestaurants,
      restaurants_count: businessRestaurants.length,
      users,
      payments: businessPayments,
      payments_count: businessPayments.length,
      paid_total: paidTotal,
      pending_total: pendingTotal,
      access_count: businessAccess.length,
      invites_count: businessInvites.length,
      last_payment: businessPayments[0] || null
    };
  });

  return {
    businesses: enrichedBusinesses,
    restaurants,
    admins,
    payments,
    business_users: businessUsers,
    access,
    invites
  };
}


async function upsertRestaurant(body = {}) {
  const name = cleanText(body.name || body.restaurant_name || body.restaurantName);
  if (!name) throw new Error('Restaurant name is required');

  const id = safeRestaurantId(body.id || body.restaurant_id || body.restaurantId, name);
  const payload = {
    id,
    name,
    city: cleanText(body.city, 'Тюмень'),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active)
  };

  const existing = await supabaseFetch(`/rest/v1/restaurants?select=*&id=eq.${encode(id)}&limit=1`).catch(() => []);

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/restaurants?id=eq.${encode(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  }

  const inserted = await supabaseFetch('/rest/v1/restaurants', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).catch(() => null);

  return Array.isArray(inserted) ? inserted[0] : payload;
}

async function createBusinessWithRestaurants(body = {}) {
  const restaurantInputs = Array.isArray(body.restaurants_to_create)
    ? body.restaurants_to_create
    : Array.isArray(body.restaurantsToCreate)
      ? body.restaurantsToCreate
      : [];

  const createdRestaurants = [];
  for (const restaurantInput of restaurantInputs) {
    const restaurantName = cleanText(restaurantInput?.name || restaurantInput?.restaurant_name || restaurantInput?.restaurantName);
    if (!restaurantName) continue;
    const restaurant = await upsertRestaurant({
      ...restaurantInput,
      city: restaurantInput?.city || body.city || 'Тюмень'
    });
    createdRestaurants.push(restaurant);
  }

  const restaurantIds = unique([
    ...(body.restaurant_ids || body.restaurantIds || []),
    ...createdRestaurants.map((item) => item.id)
  ]);

  const business = await upsertBusiness({
    ...body,
    restaurant_ids: restaurantIds
  });

  let ownerResult = null;
  const ownerUsername = normalizeUsername(body.owner_username || body.ownerUsername);
  if (ownerUsername) {
    ownerResult = await addBusinessUser({
      business_id: business.id,
      username: ownerUsername,
      business_role: 'business_owner',
      restaurant_role: 'owner',
      restaurant_ids: restaurantIds,
      telegram_id: body.owner_telegram_id || body.ownerTelegramId || null
    });
  }

  let payment = null;
  const initialAmount = Number(body.initial_payment_amount || body.initialPaymentAmount || 0);
  if (Number.isFinite(initialAmount) && initialAmount > 0) {
    payment = await addPayment({
      business_id: business.id,
      amount: initialAmount,
      currency: body.currency || 'RUB',
      status: body.payment_status || body.paymentStatus || 'paid',
      plan_name: body.plan_name || 'pilot',
      notes: body.payment_notes || body.paymentNotes || 'Стартовый платёж при подключении клиента'
    });
  }

  return { business, created_restaurants: createdRestaurants, owner: ownerResult?.user || null, invites: ownerResult?.invites || [], payment };
}

async function upsertBusiness(body) {
  const name = cleanText(body.name);
  if (!name) throw new Error('Business name is required');

  const id = safeBusinessId(body.id, name);
  const payload = businessPayloadFromBody(body, id);
  const restaurantIds = unique(body.restaurant_ids || body.restaurantIds || []);

  const existing = await supabaseFetch(`/rest/v1/platform_businesses?select=*&id=eq.${encode(id)}&limit=1`).catch(() => []);

  let business;
  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/platform_businesses?id=eq.${encode(id)}`, {
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

  if (Array.isArray(body.restaurant_ids) || Array.isArray(body.restaurantIds)) {
    await replaceBusinessRestaurants(id, restaurantIds);
  }

  return business;
}

async function addPayment(body) {
  const businessId = cleanText(body.business_id || body.businessId);
  if (!businessId) throw new Error('business_id is required');

  const amount = Number(body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount is required');

  const payload = {
    business_id: businessId,
    amount,
    currency: cleanText(body.currency, 'RUB'),
    status: cleanPaymentStatus(body.status),
    plan_name: cleanText(body.plan_name, 'pilot'),
    period_start: body.period_start || null,
    period_end: body.period_end || null,
    paid_at: body.paid_at || (cleanPaymentStatus(body.status) === 'paid' ? new Date().toISOString() : null),
    notes: body.notes ? String(body.notes) : null
  };

  const inserted = await supabaseFetch('/rest/v1/platform_payments', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).catch(() => null);

  return Array.isArray(inserted) ? inserted[0] : payload;
}

async function addBusinessUser(body) {
  const businessId = cleanText(body.business_id || body.businessId);
  const username = normalizeUsername(body.username || body.owner_username);
  if (!businessId) throw new Error('business_id is required');
  if (!username) throw new Error('username is required');

  const businessRole = cleanBusinessRole(body.business_role || body.businessRole || body.role);
  const restaurantRole = cleanRole(body.restaurant_role || body.restaurantRole || (businessRole === 'business_owner' ? 'owner' : 'manager'));
  const restaurantIds = unique(body.restaurant_ids || body.restaurantIds || []);

  const payload = {
    business_id: businessId,
    username: `@${username}`,
    username_normalized: username,
    telegram_id: body.telegram_id ? String(body.telegram_id) : null,
    role: businessRole,
    status: 'active',
    updated_at: new Date().toISOString()
  };

  const existing = await supabaseFetch(`/rest/v1/platform_business_users?select=*&business_id=eq.${encode(businessId)}&username_normalized=eq.${encode(username)}&limit=1`).catch(() => []);
  let user;

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/platform_business_users?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    user = Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  } else {
    const inserted = await supabaseFetch('/rest/v1/platform_business_users', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).catch(() => null);
    user = Array.isArray(inserted) ? inserted[0] : payload;
  }

  const createdInvites = [];
  for (const restaurantId of restaurantIds) {
    const invite = await addPendingInvite({ username, restaurantId, role: restaurantRole, createdByTelegramId: body.created_by_telegram_id || null });
    if (invite) createdInvites.push(invite);
  }

  if (businessRole === 'business_owner') {
    await supabaseFetch(`/rest/v1/platform_businesses?id=eq.${encode(businessId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ owner_username: username, owner_telegram_id: body.telegram_id ? String(body.telegram_id) : null, updated_at: new Date().toISOString() })
    }).catch(() => null);
  }

  return { user, invites: createdInvites };
}

export async function GET(request) {
  const gate = await assertPlatformAccess(request);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const data = await getPlatformData();
  return NextResponse.json({ ok: true, auth_mode: gate.mode, ...data });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const gate = await assertPlatformAccess(request, body);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  const action = String(body.action || body.mode || 'upsert_business').trim();

  try {
    let result = null;

    if (action === 'upsert_business' || action === 'create_business' || action === 'update_business') {
      result = { business: await upsertBusiness(body) };
    } else if (action === 'upsert_restaurant' || action === 'create_restaurant') {
      result = { restaurant: await upsertRestaurant(body) };
    } else if (action === 'create_business_with_restaurants' || action === 'onboard_client') {
      result = await createBusinessWithRestaurants(body);
    } else if (action === 'add_payment') {
      result = { payment: await addPayment(body) };
    } else if (action === 'add_business_user' || action === 'assign_owner') {
      result = await addBusinessUser(body);
    } else if (action === 'link_restaurants') {
      const businessId = cleanText(body.business_id || body.businessId);
      if (!businessId) throw new Error('business_id is required');
      result = { links: await replaceBusinessRestaurants(businessId, body.restaurant_ids || body.restaurantIds || []) };
    } else {
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    const data = await getPlatformData();
    return NextResponse.json({ ok: true, auth_mode: gate.mode, action, ...result, ...data });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Platform action failed' }, { status: 400 });
  }
}

export async function PATCH(request) {
  return POST(request);
}
