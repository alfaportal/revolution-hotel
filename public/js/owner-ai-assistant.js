/** Owner panel — Asistent AI (chat + zë + kategori, Pako 4) */
(function () {
  let recognition = null;
  let listening = false;
  let activeCategory = "general";

  function esc(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function setMsg(text, ok) {
    const el = document.getElementById("ai-assistant-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "owner-license-msg" + (text ? (ok ? " ok" : " err") : "");
  }

  function setLoading(loading) {
    document.getElementById("ai-assistant-loading")?.classList.toggle("hidden", !loading);
    const sendBtn = document.getElementById("btn-ai-assistant-send");
    const input = document.getElementById("ai-assistant-input");
    const micBtn = document.getElementById("btn-ai-assistant-mic");
    if (sendBtn) sendBtn.disabled = loading;
    if (input) input.disabled = loading;
    if (micBtn) micBtn.disabled = loading;
  }

  function appendBubble(text, role) {
    const box = document.getElementById("ai-assistant-messages");
    if (!box) return;
    const bubble = document.createElement("div");
    bubble.className = `ai-chat-bubble ai-chat-bubble-${role === "user" ? "user" : "assistant"}`;
    bubble.textContent = text;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  }

  function renderHistory(messages) {
    const box = document.getElementById("ai-assistant-messages");
    if (!box) return;
    box.innerHTML = "";
    if (!messages?.length) {
      appendBubble(
        "Përshëndetje! Jam asistenti juaj — pyetni për shitjet, stokun ose raportet e sotme.",
        "assistant",
      );
      return;
    }
    for (const row of messages) {
      appendBubble(row.content, row.role);
    }
  }

  function ttsEnabled() {
    return document.getElementById("ai-assistant-tts")?.checked !== false;
  }

  function speakAlbanian(text) {
    if (!ttsEnabled() || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(String(text || "").trim());
    utter.lang = "sq-AL";
    if (!utter.lang) utter.lang = "en-US";
    utter.rate = 1;
    utter.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const sqVoice = voices.find(v => /sq|albanian/i.test(v.lang + v.name));
    if (sqVoice) utter.voice = sqVoice;
    window.speechSynthesis.speak(utter);
  }

  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.lang = "sq-AL";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      const input = document.getElementById("ai-assistant-input");
      if (input && transcript.trim()) {
        input.value = transcript.trim();
        sendMessage(transcript.trim());
      }
    };

    rec.onerror = () => {
      listening = false;
      updateMicButton();
      setMsg("Mikrofoni nuk funksionoi — provoni të shkruani pyetjen.", false);
    };

    rec.onend = () => {
      listening = false;
      updateMicButton();
    };

    return rec;
  }

  function updateMicButton() {
    const btn = document.getElementById("btn-ai-assistant-mic");
    if (!btn) return;
    btn.classList.toggle("ai-assistant-mic-active", listening);
    btn.title = listening ? "Duke dëgjuar…" : "Mikrofon — flisni pyetjen";
  }

  function toggleMic() {
    if (!recognition) {
      recognition = setupSpeechRecognition();
    }
    if (!recognition) {
      setMsg("Shfletuesi nuk mbështet Web Speech API — shkruani pyetjen.", false);
      return;
    }
    if (listening) {
      recognition.stop();
      listening = false;
      updateMicButton();
      return;
    }
    try {
      recognition.start();
      listening = true;
      updateMicButton();
      setMsg("Duke dëgjuar… flisni pyetjen.", true);
    } catch {
      setMsg("Mikrofoni është i zënë ose u refuzua.", false);
    }
  }

  async function sendMessage(message) {
    const text = String(message || "").trim();
    if (!text) return;

    appendBubble(text, "user");
    setLoading(true);
    setMsg("", true);

    try {
      const data = await api("/api/owner/ai-assistant/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, category: activeCategory }),
      });
      const reply = String(data.reply || "").trim() || "Nuk u mor përgjigje.";
      appendBubble(reply, "assistant");
      speakAlbanian(reply);
    } catch (err) {
      appendBubble(err.message || "Gabim gjatë komunikimit me AI.", "assistant");
      setMsg(err.message, false);
    } finally {
      setLoading(false);
      document.getElementById("ai-assistant-input")?.focus();
    }
  }

  async function loadOwnerAiAssistant() {
    setMsg("Duke ngarkuar bisedën…", true);
    try {
      const data = await api("/api/owner/ai-assistant/history");
      renderHistory(data.messages || []);
      setMsg("", true);
    } catch (err) {
      renderHistory([]);
      setMsg(err.message, false);
    }
  }

  async function clearHistory() {
    if (!confirm("Pastro të gjithë historinë e bisedës me AI?")) return;
    try {
      await api("/api/owner/ai-assistant/history", { method: "DELETE" });
      renderHistory([]);
      setMsg("Biseda u pastrua.", true);
    } catch (err) {
      setMsg(err.message, false);
    }
  }

  function applyAiAssistantTab(data) {
    window.applyAiFeatureLock?.(document.getElementById("tab-ai-assistant"), data);
  }

  function openAssistantTab() {
    const tab = document.querySelector('.tab[data-tab="ai-asistent"]');
    tab?.click();
  }

  window.loadOwnerAiAssistant = loadOwnerAiAssistant;
  window.applyAiAssistantTab = applyAiAssistantTab;
  window.openOwnerAiAssistantTab = openAssistantTab;

  document.getElementById("ai-assistant-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const input = document.getElementById("ai-assistant-input");
    const message = input?.value?.trim();
    if (!message) return;
    input.value = "";
    await sendMessage(message);
  });

  document.getElementById("btn-ai-assistant-mic")?.addEventListener("click", toggleMic);
  document.getElementById("btn-ai-assistant-clear")?.addEventListener("click", () => {
    clearHistory().catch(err => setMsg(err.message, false));
  });

  document.querySelectorAll(".ai-cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.aiCat || "general";
      document.querySelectorAll(".ai-cat-chip").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.classList.toggle("btn-primary", on);
        b.classList.toggle("btn-ghost", !on);
      });
    });
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {};
  }
})();
