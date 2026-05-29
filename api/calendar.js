// api/calendar.js — busca eventos reais do Google Calendar via Service Account
// Variáveis necessárias no Vercel:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY

// Gera JWT para autenticação com a Service Account
async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;

  // Importa a chave privada
  const keyData = rawKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Buffer.from(keyData, 'base64');

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(unsigned)
  );

  const jwt = `${unsigned}.${Buffer.from(signature).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error('Erro ao obter token Google: ' + err);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

// Busca eventos de um calendário
async function fetchEvents(calendarId, accessToken, days = 30, daysPast = 0) {
  const timeMin = new Date(Date.now() - daysPast * 86400000).toISOString();
  const timeMax = new Date(Date.now() + days * 86400000).toISOString();

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '100');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro ao buscar calendário ${calendarId}: ${err}`);
  }

  const data = await res.json();
  return (data.items || []).map(e => ({
    id: e.id,
    title: e.summary || '(sem título)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    allDay: !e.start?.dateTime,
    location: e.location || null,
    description: e.description || null,
    calendar: calendarId,
    htmlLink: e.htmlLink || null
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return res.status(500).json({ error: 'Credenciais Google não configuradas.' });
  }

  try {
    const token = await getAccessToken();

    // Calendários compartilhados com a service account
    // Adicione ou remova IDs conforme necessário
    const calendarIds = [
      'lenacurado@gmail.com',       // Helena — Pessoal
      'giancorrea7@gmail.com',      // Giancarlo (precisa compartilhar também)
    ];

    const results = await Promise.allSettled(
      calendarIds.map(id => fetchEvents(id, token, 180, 90))  // 6 meses futuro + 90 dias passado
    );

    const events = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') events.push(...r.value);
      else console.error(`Calendário ${calendarIds[i]}:`, r.reason?.message);
    });

    // Ordena por data
    events.sort((a, b) => new Date(a.start) - new Date(b.start));

    // Debug: loga títulos no servidor (visível nos logs do Vercel)
    console.log('Eventos retornados:', events.map(e => `${e.start?.slice(0,10)} | ${e.title}`).join('\n'));

    return res.status(200).json({ events });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
