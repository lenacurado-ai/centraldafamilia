const recordButton = document.querySelector("#recordButton");
const recordingLabel = document.querySelector("#recordingLabel");
const transcriptOutput = document.querySelector("#transcriptOutput");
const connectionStatus = document.querySelector("#connectionStatus");
const historyList = document.querySelector("#historyList");
const clearHistory = document.querySelector("#clearHistory");
const quickActions = document.querySelectorAll("[data-example]");

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

const historyKey = "central-da-familia-history";

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(historyKey) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 20)));
}

function renderHistory() {
  const items = loadHistory();
  if (!items.length) {
    historyList.innerHTML = '<div class="empty">Nenhuma solicitacao registrada ainda.</div>';
    return;
  }

  historyList.innerHTML = items
    .map(
      (item) => `
        <article class="history-card">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `,
    )
    .join("");
}

function addHistory(item) {
  const items = loadHistory();
  saveHistory([item, ...items]);
  renderHistory();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) audioChunks.push(event.data);
  });

  mediaRecorder.addEventListener("stop", async () => {
    stream.getTracks().forEach((track) => track.stop());
    await sendAudio(new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" }));
  });

  mediaRecorder.start();
  isRecording = true;
  recordButton.classList.add("recording");
  recordingLabel.textContent = "Gravando...";
  connectionStatus.textContent = "Ouvindo";
  transcriptOutput.textContent = "Toque novamente quando terminar.";
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  isRecording = false;
  recordButton.classList.remove("recording");
  recordingLabel.textContent = "Processando...";
  connectionStatus.textContent = "Enviando";
  mediaRecorder.stop();
}

async function sendAudio(audioBlob) {
  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": audioBlob.type || "audio/webm" },
      body: audioBlob,
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nao foi possivel processar o audio.");

    transcriptOutput.textContent = data.transcript || "Pedido recebido.";
    recordingLabel.textContent = "Toque para gravar";
    connectionStatus.textContent = "Pronto";
    addHistory({
      title: data.title || "Solicitacao recebida",
      text: data.summary || data.transcript || "Sem resumo.",
    });
  } catch (error) {
    recordingLabel.textContent = "Toque para tentar de novo";
    connectionStatus.textContent = "Erro";
    transcriptOutput.textContent = error.message;
  }
}

async function sendText(text) {
  connectionStatus.textContent = "Enviando";
  transcriptOutput.textContent = text;

  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nao foi possivel processar o pedido.");

    connectionStatus.textContent = "Pronto";
    addHistory({
      title: data.title || "Solicitacao recebida",
      text: data.summary || text,
    });
  } catch (error) {
    connectionStatus.textContent = "Erro";
    transcriptOutput.textContent = error.message;
  }
}

recordButton.addEventListener("click", async () => {
  if (isRecording) {
    stopRecording();
    return;
  }

  try {
    await startRecording();
  } catch {
    transcriptOutput.textContent = "Nao consegui acessar o microfone. Confira a permissao do navegador.";
    connectionStatus.textContent = "Sem microfone";
  }
});

quickActions.forEach((button) => {
  button.addEventListener("click", () => sendText(button.dataset.example));
});

clearHistory.addEventListener("click", () => {
  saveHistory([]);
  renderHistory();
});

renderHistory();
