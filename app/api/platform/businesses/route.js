import { NextResponse } from 'next/server';
import { isFreshAuthDate, parseInitData, validateTelegramInitData } from '../../../../lib/telegram';
import { assertAdminKey, cleanRole, normalizeUsername } from '../../../../lib/accessServer';
import { supabaseFetch } from '../../../../lib/supabaseServer';

const CYRILLIC_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};

function slugify(value, prefix) {
  const raw = String(value || '').trim().toLowerCase().replace(/^@+/, '');
  const translit = raw
    .split('')
    .map((char) => CYRILLIC_MAP[char] ?? char)
    .join('')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 52);
  return translit ? `${prefix}_${translit}`.slice(0, 64) : `${prefix}_${Date.now()}`;
}

function safeBusinessId(value, name = '') {
  const source = String(value || '').trim();
  if (source) {
    const normalized = slugify(source, 'biz');
    return normalized.startsWith('biz_') ? normalized : `biz_${normalized}`;
  }
  return slugify(name, 'biz');
}

function safeRestaurantId(value, name = '') {
  const source = String(value || '').trim();
  if (source) return slugify(source, 'restaurant');
  return slugify(name, 'restaurant');
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

function cleanIikoStatus(value) {
  const status = String(value || 'not_connected').trim().toLowerCase();
  return ['not_connected', 'connected', 'error', 'paused'].includes(status) ? status : 'not_connected';
}

function cleanWorkflowStatus(value) {
  const status = String(value || 'not_connected').trim().toLowerCase();
  return ['not_connected', 'active', 'error', 'paused'].includes(status) ? status : 'not_connected';
}

function cleanDataStatus(value) {
  const status = String(value || 'not_connected').trim().toLowerCase();
  return ['not_connected', 'live', 'stale', 'error', 'paused'].includes(status) ? status : 'not_connected';
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


function defaultSectionsForBusinessRole(role = 'business_owner') {
  if (role === 'business_owner' || role === 'business_admin') return ['today', 'reports', 'waiters', 'ai', 'analytics', 'plan', 'risks', 'control'];
  if (role === 'accountant') return ['today', 'reports', 'analytics', 'risks'];
  return ['today', 'reports'];
}

function normalizePermissions(role = 'business_owner', permissions = null) {
  const source = permissions && typeof permissions === 'object' ? permissions : {};
  const sections = unique(Array.isArray(source.sections) ? source.sections : defaultSectionsForBusinessRole(role));
  return {
    sections: sections.length ? sections : defaultSectionsForBusinessRole(role),
    can_manage_employees: source.can_manage_employees === undefined
      ? ['business_owner', 'business_admin'].includes(role)
      : Boolean(source.can_manage_employees)
  };
}

async function findKnownTelegramId(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  const [appUsers, activeAccess, businessUsers] = await Promise.all([
    fetchOptional(`/rest/v1/app_users?select=telegram_id,username,username_normalized&username_normalized=eq.${encode(normalized)}&limit=1`),
    fetchOptional(`/rest/v1/app_user_restaurant_access?select=telegram_id,username,username_normalized&username_normalized=eq.${encode(normalized)}&telegram_id=not.is.null&limit=1`),
    fetchOptional(`/rest/v1/platform_business_users?select=telegram_id,username,username_normalized&username_normalized=eq.${encode(normalized)}&telegram_id=not.is.null&limit=1`)
  ]);

  return appUsers[0]?.telegram_id || activeAccess[0]?.telegram_id || businessUsers[0]?.telegram_id || null;
}

async function upsertRestaurantAccess({ telegramId = null, username, restaurantId, role = 'owner', createdByTelegramId = null }) {
  const normalized = normalizeUsername(username);
  if (!normalized || !restaurantId) return null;

  if (!telegramId) {
    return addPendingInvite({ username: normalized, restaurantId, role, createdByTelegramId });
  }

  const payload = {
    telegram_id: String(telegramId),
    username: normalized,
    username_normalized: normalized,
    restaurant_id: restaurantId,
    role: cleanRole(role),
    status: 'active',
    created_by_telegram_id: createdByTelegramId,
    removed_at: null,
    updated_at: new Date().toISOString()
  };

  const existing = await supabaseFetch(`/rest/v1/app_user_restaurant_access?select=*&username_normalized=eq.${encode(normalized)}&restaurant_id=eq.${encode(restaurantId)}&limit=1`).catch(() => []);

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/app_user_restaurant_access?id=eq.${existing[0].id}`, {
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

async function upsertStarterIntegration({ businessId, restaurantId }) {
  if (!businessId || !restaurantId) return null;
  const existing = await fetchOptional(`/rest/v1/platform_restaurant_integrations?select=*&restaurant_id=eq.${encode(restaurantId)}&limit=1`);
  const payload = {
    business_id: businessId,
    restaurant_id: restaurantId,
    iiko_status: 'not_connected',
    n8n_status: 'not_connected',
    data_status: 'not_connected',
    last_sync_at: null,
    sync_interval_minutes: 5,
    workflow_url: null,
    iiko_base_url: null,
    connection_notes: 'Клиент создан в платформе. iiko/n8n подключить отдельно.',
    is_enabled: true,
    updated_at: new Date().toISOString()
  };
  if (existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/platform_restaurant_integrations?id=eq.${existing[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  }
  const inserted = await supabaseFetch('/rest/v1/platform_restaurant_integrations', { method: 'POST', body: JSON.stringify(payload) }).catch(() => null);
  return Array.isArray(inserted) ? inserted[0] : payload;
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
  const [businessesRaw, linksRaw, restaurantsRaw, adminsRaw, usersRaw, paymentsRaw, accessRaw, invitesRaw, integrationsRaw] = await Promise.all([
    fetchOptional('/rest/v1/platform_businesses?select=*&order=created_at.desc'),
    fetchOptional('/rest/v1/platform_business_restaurants?select=*&order=created_at.asc'),
    fetchOptional('/rest/v1/restaurants?select=id,name,city,is_active&order=name.asc'),
    fetchOptional('/rest/v1/platform_admins?select=telegram_id,username,role,status&status=eq.active'),
    fetchOptional('/rest/v1/platform_business_users?select=*&status=eq.active&order=created_at.desc'),
    fetchOptional('/rest/v1/platform_payments?select=*&order=created_at.desc'),
    fetchOptional('/rest/v1/app_user_restaurant_access?select=*&status=eq.active&order=created_at.desc'),
    fetchOptional('/rest/v1/app_pending_invites?select=*&status=eq.pending&order=created_at.desc'),
    fetchOptional('/rest/v1/platform_restaurant_integrations?select=*&order=updated_at.desc')
  ]);

  const businesses = businessesRaw;
  const links = linksRaw;
  const restaurants = restaurantsRaw;
  const admins = adminsRaw;
  const businessUsers = usersRaw;
  const payments = paymentsRaw;
  const access = accessRaw;
  const invites = invitesRaw;
  const integrations = integrationsRaw;
  const restaurantMap = new Map(restaurants.map((item) => [String(item.id), item]));
  const integrationMap = new Map(integrations.map((item) => [String(item.restaurant_id), item]));

  const enrichedBusinesses = businesses.map((business) => {
    const businessId = String(business.id);
    const businessLinks = links.filter((link) => String(link.business_id) === businessId);
    const businessRestaurants = businessLinks.map((link) => {
      const restaurantId = String(link.restaurant_id);
      const baseRestaurant = restaurantMap.get(restaurantId) || {
        id: link.restaurant_id,
        name: link.restaurant_id,
        city: '',
        is_active: false
      };
      const integration = integrationMap.get(restaurantId) || null;
      return {
        ...baseRestaurant,
        integration,
        iiko_status: integration?.iiko_status || 'not_connected',
        n8n_status: integration?.n8n_status || 'not_connected',
        data_status: integration?.data_status || 'not_connected',
        last_sync_at: integration?.last_sync_at || null,
        sync_interval_minutes: integration?.sync_interval_minutes || null
      };
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
    const connectedIntegrations = businessRestaurants.filter((restaurant) => restaurant.iiko_status === 'connected' && restaurant.n8n_status === 'active').length;
    const integrationErrors = businessRestaurants.filter((restaurant) => restaurant.iiko_status === 'error' || restaurant.n8n_status === 'error' || restaurant.data_status === 'error').length;
    const liveDataRestaurants = businessRestaurants.filter((restaurant) => restaurant.data_status === 'live').length;

    return {
      ...business,
      restaurants: businessRestaurants,
      restaurants_count: businessRestaurants.length,
      users,
      payments: businessPayments,
      payments_count: businessPayments.length,
      paid_total: paidTotal,
      pending_total: pendingTotal,
      integrations_connected_count: connectedIntegrations,
      integrations_error_count: integrationErrors,
      live_data_restaurants_count: liveDataRestaurants,
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
    integrations,
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
  const firstRestaurantName = cleanText(body.first_restaurant_name || body.firstRestaurantName || body.restaurant_name || body.restaurantName || body.name);
  const restaurantInputs = Array.isArray(body.restaurants_to_create)
    ? body.restaurants_to_create
    : Array.isArray(body.restaurantsToCreate)
      ? body.restaurantsToCreate
      : firstRestaurantName
        ? [{
            id: body.first_restaurant_id || body.firstRestaurantId || body.restaurant_id || body.restaurantId || '',
            name: firstRestaurantName,
            city: body.city || 'Тюмень',
            is_active: true
          }]
        : [];

  const createdRestaurants = [];
  for (const restaurantInput of restaurantInputs.slice(0, 1)) {
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

  const createdIntegrations = [];
  for (const restaurantId of restaurantIds) {
    const integration = await upsertStarterIntegration({ businessId: business.id, restaurantId });
    if (integration) createdIntegrations.push(integration);
  }

  let ownerResult = null;
  const ownerUsername = normalizeUsername(body.owner_username || body.ownerUsername);
  if (ownerUsername) {
    const knownTelegramId = body.owner_telegram_id || body.ownerTelegramId || await findKnownTelegramId(ownerUsername);
    ownerResult = await addBusinessUser({
      business_id: business.id,
      username: ownerUsername,
      business_role: 'business_owner',
      restaurant_role: 'owner',
      restaurant_ids: restaurantIds,
      telegram_id: knownTelegramId || null,
      created_by_telegram_id: body.created_by_telegram_id || null
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

  return {
    business,
    created_restaurants: createdRestaurants,
    integrations: createdIntegrations,
    owner: ownerResult?.user || null,
    access: ownerResult?.access || [],
    invites: ownerResult?.invites || [],
    payment
  };
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
  const telegramId = body.telegram_id ? String(body.telegram_id) : await findKnownTelegramId(username);
  const permissions = normalizePermissions(businessRole, body.permissions);

  const payload = {
    business_id: businessId,
    username: `@${username}`,
    username_normalized: username,
    telegram_id: telegramId ? String(telegramId) : null,
    role: businessRole,
    status: 'active',
    permissions,
    restaurant_ids: restaurantIds,
    removed_at: null,
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
  const createdAccess = [];
  for (const restaurantId of restaurantIds) {
    const accessRow = await upsertRestaurantAccess({
      telegramId,
      username,
      restaurantId,
      role: restaurantRole,
      createdByTelegramId: body.created_by_telegram_id || null
    });
    if (!accessRow) continue;
    if (accessRow.status === 'pending') createdInvites.push(accessRow);
    else createdAccess.push(accessRow);
  }

  if (businessRole === 'business_owner') {
    await supabaseFetch(`/rest/v1/platform_businesses?id=eq.${encode(businessId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        owner_username: username,
        owner_telegram_id: telegramId ? String(telegramId) : null,
        updated_at: new Date().toISOString()
      })
    }).catch(() => null);
  }

  return { user, access: createdAccess, invites: createdInvites };
}


async function updateRestaurantIntegration(body = {}) {
  const restaurantId = cleanText(body.restaurant_id || body.restaurantId);
  if (!restaurantId) throw new Error('restaurant_id is required');

  const payload = {
    business_id: cleanText(body.business_id || body.businessId) || null,
    restaurant_id: restaurantId,
    iiko_status: cleanIikoStatus(body.iiko_status || body.iikoStatus),
    n8n_status: cleanWorkflowStatus(body.n8n_status || body.n8nStatus),
    data_status: cleanDataStatus(body.data_status || body.dataStatus),
    last_sync_at: body.last_sync_at || body.lastSyncAt || null,
    sync_interval_minutes: Number(body.sync_interval_minutes || body.syncIntervalMinutes || 5) || 5,
    workflow_url: body.workflow_url || body.workflowUrl || null,
    iiko_base_url: body.iiko_base_url || body.iikoBaseUrl || null,
    connection_notes: body.connection_notes || body.connectionNotes || null,
    is_enabled: body.is_enabled === undefined ? true : Boolean(body.is_enabled),
    updated_at: new Date().toISOString()
  };

  const existing = await supabaseFetch(`/rest/v1/platform_restaurant_integrations?select=*&restaurant_id=eq.${encode(restaurantId)}&limit=1`).catch(() => []);

  if (Array.isArray(existing) && existing[0]) {
    const updated = await supabaseFetch(`/rest/v1/platform_restaurant_integrations?restaurant_id=eq.${encode(restaurantId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }).catch(() => null);
    return Array.isArray(updated) ? updated[0] : { ...existing[0], ...payload };
  }

  const inserted = await supabaseFetch('/rest/v1/platform_restaurant_integrations', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).catch(() => null);

  return Array.isArray(inserted) ? inserted[0] : payload;
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
    } else if (action === 'update_restaurant_integration' || action === 'set_integration_status') {
      result = { integration: await updateRestaurantIntegration(body) };
    } else if (action === 'add_business_user' || action === 'assign_owner') {
      result = await addBusinessUser(body);
    } else if (action === 'archive_business') {
      const businessId = cleanText(body.business_id || body.businessId || body.id);
      if (!businessId) throw new Error('business_id is required');
      const archived = await supabaseFetch(`/rest/v1/platform_businesses?id=eq.${encode(businessId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived', updated_at: new Date().toISOString() })
      }).catch(() => null);
      result = { business: Array.isArray(archived) ? archived[0] : { id: businessId, status: 'archived' } };
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
