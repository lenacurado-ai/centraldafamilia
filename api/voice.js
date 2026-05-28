export const config = {
  api: {
    bodyParser: false,
  },
};

const intentLabels = {
  medical_appointment: "Agendamento medico",
  note: "Anotacao",
  content: "Conteudo",
  file_search: "Busca de arquivo",
  other: "Pedido recebido",
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Metodo nao permitido." });
  }

  try {
    const { transcript } = await readIncomingRequest(request);
    if (!transcript.trim()) {
      return response.status(400).json({ error: "Nao recebi audio ou texto para processar." });
    }

    const result = await interpretRequest(transcript);
    return response.status(200).json(result);
  } catch (error) {
    return response.status(500).json({
      error: error.message || "Nao foi possivel processar o pedido.",
    });
  }
}

async function readIncomingRequest(request) {
  const contentType = request.headers["content-type"] || "";

  if (contentType.includes("application/json")) {
    const body = await readJsonBody(request);
    return { transcript: body.text || "" };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Configure OPENAI_API_KEY na hospedagem para ativar audio.");
  }

  const audioBuffer = await readRawBody(request);
  const form = new FormData();
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("file", new Blob([audioBuffer], { type: contentType || "audio/webm" }), "pedido.webm");

  const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  const transcription = await transcriptionResponse.json();
  if (!transcriptionResponse.ok) {
    throw new Error(transcription.error?.message || "Falha ao transcrever o audio.");
  }

  return { transcript: transcription.text || "" };
}

async function interpretRequest(transcript) {
  if (!process.env.OPENAI_API_KEY) {
    const fallback = classifyLocally(transcript);
    return {
      transcript,
      intent: fallback,
      title: intentLabels[fallback],
      summary: transcript,
      nextAction: "Configure OPENAI_API_KEY para gerar resumo e acao automaticamente.",
    };
  }

  const aiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Voce organiza pedidos familiares. Responda somente JSON valido com intent, title, summary e nextAction. Intents: medical_appointment, note, content, file_search, other.",
        },
        {
          role: "user",
          content: transcript,
        },
      ],
    }),
  });

  const data = await aiResponse.json();
  if (!aiResponse.ok) {
    throw new Error(data.error?.message || "Falha ao interpretar o pedido.");
  }

  const text = data.output_text || "{}";
  const parsed = JSON.parse(text);
  return {
    transcript,
    intent: parsed.intent || "other",
    title: parsed.title || intentLabels[parsed.intent] || "Pedido recebido",
    summary: parsed.summary || transcript,
    nextAction: parsed.nextAction || "",
  };
}

function classifyLocally(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("medico") || normalized.includes("consulta") || normalized.includes("agendar")) {
    return "medical_appointment";
  }
  if (normalized.includes("conteudo") || normalized.includes("post") || normalized.includes("criar")) {
    return "content";
  }
  if (normalized.includes("arquivo") || normalized.includes("drive") || normalized.includes("buscar")) {
    return "file_search";
  }
  if (normalized.includes("anotar") || normalized.includes("nota") || normalized.includes("lembrete")) {
    return "note";
  }
  return "other";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
