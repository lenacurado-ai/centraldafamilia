// Reutiliza a lógica de autenticação do calendar.js
async function getAccessToken() {
  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  })}`;

  const keyData = rawKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'pkcs8', Buffer.from(keyData, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(unsigned)
  );

  const jwt = `${unsigned}.${Buffer.from(sig).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });

  if (!tokenRes.ok) throw new Error('Token error: ' + await tokenRes.text());
  return (await tokenRes.json()).access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { events, calendarId = 'lenacurado@gmail.com' } = req.body;
  if (!events?.length) return res.status(400).json({ error: 'Nenhum evento enviado.' });

  try {
    const token = await getAccessToken();
    const results = [];

    for (const ev of events) {
      // Monta start/end
      const isAllDay = !ev.time;
      const start = isAllDay
        ? { date: ev.date }
        : { dateTime: `${ev.date}T${ev.time}:00`, timeZone: 'America/Sao_Paulo' };
      const end = isAllDay
        ? { date: ev.date }
        : { dateTime: `${ev.date}T${ev.endTime || ev.time}:00`, timeZone: 'America/Sao_Paulo' };

      // Cor por pessoa
      const colorId = ev.person === 'iara' ? '3'    // grape
                    : ev.person === 'caique' ? '7'  // peacock
                    : '5';                           // banana

      const body = {
        summary: ev.title,
        description: ev.description || '',
        start, end,
        colorId,
        reminders: {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: 60 }]
        }
      };

      const gcRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );

      if (gcRes.ok) {
        const created = await gcRes.json();
        results.push({ ok: true, id: created.id, title: ev.title, date: ev.date });
      } else {
        const err = await gcRes.text();
        results.push({ ok: false, title: ev.title, error: err });
      }
    }

    const created = results.filter(r => r.ok).length;
    return res.status(200).json({ created, results });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
