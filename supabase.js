// Маленькая обёртка над Supabase REST API (PostgREST).
// Ключ service_role берётся из переменных окружения и виден только серверу.

function baseUrl() {
  return String(process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/rest/v1';
}

async function sb(path, opts) {
  opts = opts || {};
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase is not configured');
  }
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = Object.assign(
    {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    opts.headers || {}
  );

  const res = await fetch(baseUrl() + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });

  if (!res.ok) {
    const text = await res.text().catch(function () { return ''; });
    const err = new Error('Supabase ' + res.status + ': ' + text);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = { sb };
