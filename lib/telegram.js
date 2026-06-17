import crypto from 'crypto';

export function parseInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const userRaw = params.get('user');

  let user = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw);
    } catch {
      user = null;
    }
  }

  return {
    queryId: params.get('query_id'),
    authDate: Number(params.get('auth_date') || 0),
    hash: params.get('hash'),
    user
  };
}

export function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'hex'),
      Buffer.from(hash, 'hex')
    );
  } catch {
    return false;
  }
}

export function isFreshAuthDate(authDate, maxAgeSeconds = 86400) {
  if (!authDate) return false;
  const now = Math.floor(Date.now() / 1000);
  return now - authDate <= maxAgeSeconds;
}
