// bodyParser desativado — detectamos o tipo pelo Content-Type
export const config = { api: { bodyParser: false } };

const FAMILY_CONTEXT = `Você é um assistente familiar da Helena e do Giancarlo. Informações da família:

IARA CORREA CURADO — nascida 23/08/2020 (5 anos)
- Medicamentos: Ferro (suplemento)
- Especialistas: Terapia Ocupacional (terças 9h, R. Turiassu 519 cj94 Perdizes, até ago/2026), Neurologista Dra. Juliana Gaigher Gonçalves - Instituto Neuro Saúde (11) 2367-8850 (próxima: teleconsulta 09/06/2026 às 13h), Avaliação Neuropsicológica em andamento, Dentista aparelho noturno Ana Riso Odontologia (mensal, precisa remarcar)
- Pendências: remarcar dentista, vacina gripe 2026 pendente, pedir exame de ferro, agendar dermatologista
- Passaporte BR: GH208870 vence 27/06/2026 (URGENTE), Passaporte PT: CE295689 válido até 01/02/2029

CAIQUE CORREA CURADO — nascido 21/06/2024 (~2 anos)
- Medicamentos: Ferro (suplemento)
- Pendências: agendar ortopedista (pisada torta), pediatra checkup geral, osteopata preventivo
- Gripe 2026: tomada em 09/05/2026
- Passaporte BR: GK903339 VENCIDO desde 11/02/2026, Passaporte PT: não tem (iniciar Av. Paulista 726)

DOCUMENTOS — Polícia Federal: servicos.dpf.gov.br. Levar passaporte atual, GRU paga, dois pais ou autorização notarial.`;

// Lê o body bruto como Buffer
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada no Vercel.' });
  }

  const contentType = req.headers['content-type'] || '';
  let transcript = '';

  // ── Modo TEXTO (JSON com { text }) ────────────────────────────
  if (contentType.includes('application/json')) {
    let body;
    try {
      const raw = await readRawBody(req);
      body = JSON.parse(raw.toString());
    } catch (e) {
      return res.status(400).json({ error: 'JSON inválido: ' + e.message });
    }
    if (!body.text?.trim()) {
      return res.status(400).json({ error: 'Campo "text" ausente.' });
    }
    transcript = body.text.trim();

  // ── Modo ÁUDIO (blob bruto) ────────────────────────────────────
  } else {
    let audioBuffer;
    try {
      audioBuffer = await readRawBody(req);
    } catch (e) {
      return res.status(400).json({ error: 'Erro ao ler o áudio: ' + e.message });
    }

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).json({ error: 'Áudio vazio ou muito pequeno.' });
    }

    const mimeType = contentType || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    try {
      const boundary = 'boundary' + Date.now();
      const partHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      );
      const modelPart = Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1` +
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\npt` +
        `\r\n--${boundary}--\r\n`
      );
      const body = Buffer.concat([partHeader, audioBuffer, modelPart]);

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });

      if (!whisperRes.ok) return res.status(500).json({ error: 'Erro no Whisper', detail: await whisperRes.text() });
      transcript = ((await whisperRes.json()).text || '').trim();
    } catch (e) {
      return res.status(500).json({ error: 'Erro na transcrição: ' + e.message });
    }

    if (!transcript) {
      return res.status(200).json({
        transcript: '',
        reply: 'Não consegui ouvir nada. Tente falar mais perto do microfone.',
        action: { type: 'none', title: '', details: '', date: null, time: null }
      });
    }
  }

  // ── 3. Interpreta com GPT-4o-mini ─────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `${FAMILY_CONTEXT}

Hoje é ${today}. Responda SEMPRE em português, de forma direta e amigável.

Retorne APENAS um JSON válido (sem markdown, sem blocos de código) neste formato:
{
  "reply": "resposta curta e útil em português",
  "action": {
    "type": "add_task | complete_task | add_note | none",
    "person": "iara | caique | familia",
    "title": "título curto",
    "details": "detalhes",
    "date": "YYYY-MM-DD ou null",
    "time": "HH:mm ou null"
  }
}

Regras para action.type:
- "add_task": adicionar tarefa, lembrete ou pendência
- "complete_task": algo foi feito ou concluído
- "add_note": registrar informação ou observação
- "none": apenas pergunta ou consulta

Exemplos:
- "adiciona remarcar dentista da Iara" → add_task, person: iara
- "Caique tomou vacina" → complete_task, person: caique
- "qual a próxima consulta da Iara?" → none, reply com a informação`;

  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 512,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript }
        ]
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.text();
      return res.status(500).json({ error: 'Erro no GPT', detail: err });
    }

    const gptData = await gptRes.json();
    const raw = (gptData.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { reply: raw, action: { type: 'none' } };
    }

    return res.status(200).json({
      transcript,
      reply: parsed.reply || '',
      action: parsed.action || { type: 'none', title: '', details: '', date: null, time: null }
    });

  } catch (e) {
    return res.status(500).json({ error: 'Erro na interpretação: ' + e.message });
  }
}
