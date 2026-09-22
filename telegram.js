// Проверяет initData, которую присылает Telegram Mini App.
// Подделать её без токена бота нельзя, поэтому это и есть вход в игру.
const crypto = require('crypto');

function verifyInitData(initData, botToken, maxAgeSeconds) {
  if (!initData || !botToken) return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch (e) {
    return null;
  }

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(key + '=' + value);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    valid = false;
  }
  if (!valid) return null;

  if (maxAgeSeconds) {
    const authDate = Number(params.get('auth_date') || 0);
    const ageSeconds = Date.now() / 1000 - authDate;
    if (!authDate || ageSeconds > maxAgeSeconds || ageSeconds < -60) return null;
  }

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (e) {
    user = null;
  }
  if (!user || !user.id) return null;

  return user;
}

module.exports = { verifyInitData };
