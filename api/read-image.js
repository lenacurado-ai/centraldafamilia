export const config = { api: { bodyParser: { sizeLimit: '20mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY não configurada.' });

  const { image, mimeType } = req.body;
  if (!image) return res.status(400).json({ error: 'Imagem ausente.' });

  const today = new Date().toISOString().split('T')[0];
  const year  = new Date().getFullYear();

  const prompt = `Você é um assistente que lê comunicados, cardápios e agendas escolares.
Analise esta imagem e extraia TODOS os eventos, datas, atividades e lembretes que encontrar.
Hoje é ${today}.

Retorne APENAS um JSON válido (sem markdown) neste formato:
{
  "events": [
    {
      "title": "título do evento",
      "date": "YYYY-MM-DD",
      "time": "HH:mm ou null",
      "endTime": "HH:mm ou null",
      "description": "detalhes relevantes ou null",
      "person": "iara | caique | familia"
    }
  ],
  "summary": "resumo curto do que foi encontrado na imagem"
}

Regras:
- Se o mês não estiver explícito, assuma o mês mais próximo a partir de hoje
- Ano padrão: ${year}
- Para eventos recorrentes (ex: toda terça), crie uma entrada por ocorrência nos próximos 60 dias
- "person": use "iara" se for da turma/escola da Iara, "caique" se for do Caique, "familia" para os demais
- Se não encontrar nenhum evento, retorne events: []`;

  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${image}`, detail: 'high' } }
          ]
        }]
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.text();
      return res.status(500).json({ error: 'Erro no GPT-4o', detail: err });
    }

    const gptData = await gptRes.json();
    const raw = (gptData.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'GPT não retornou JSON válido', raw }); }

    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
