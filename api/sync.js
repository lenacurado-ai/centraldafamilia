const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
  };
}

async function supabase(method, table, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${table} ${method}: ${err}`);
  }
  return res.status === 204 ? [] : res.json();
}

async function upsertAll(table, rows) {
  if (!rows.length) return;
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL ou SUPABASE_ANON_KEY não configuradas.' });
  }

  // GET — busca tudo do Supabase
  if (req.method === 'GET') {
    try {
      const [tasks, notes] = await Promise.all([
        supabase('GET', 'tasks?order=created_at.desc', null),
        supabase('GET', 'notes?order=created_at.desc', null)
      ]);
      return res.status(200).json({ tasks, notes });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — recebe dados do cliente e faz upsert
  if (req.method === 'POST') {
    const { tasks = [], notes = [] } = req.body;
    try {
      await Promise.all([
        tasks.length ? upsertAll('tasks', tasks) : Promise.resolve(),
        notes.length ? upsertAll('notes', notes) : Promise.resolve()
      ]);
      // Devolve estado atual do banco
      const [allTasks, allNotes] = await Promise.all([
        supabase('GET', 'tasks?order=created_at.desc', null),
        supabase('GET', 'notes?order=created_at.desc', null)
      ]);
      return res.status(200).json({ tasks: allTasks, notes: allNotes });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
