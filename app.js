const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const STORAGE_KEY = "kotha-sessions-v1";
const THEME_KEY = "kotha-theme-v1";

const elements = {
  recordButton: document.getElementById("record-button"),
  recordHint: document.getElementById("record-hint"),
  recordingTitle: document.getElementById("recording-title"),
  recordingStatus: document.getElementById("recording-status"),
  timer: document.getElementById("timer"),
  soundWave: document.getElementById("sound-wave"),
  transcript: document.getElementById("transcript"),
  interimLine: document.getElementById("interim-line"),
  editorLiveLabel: document.getElementById("editor-live-label"),
  wordCount: document.getElementById("word-count"),
  saveState: document.getElementById("save-state"),
  polishButton: document.getElementById("polish-button"),
  copyButton: document.getElementById("copy-button"),
  downloadButton: document.getElementById("download-button"),
  clearButton: document.getElementById("clear-button"),
  languageHighlight: document.getElementById("language-highlight"),
  sessionCount: document.getElementById("session-count"),
  sessionList: document.getElementById("session-list"),
  emptySessions: document.getElementById("empty-sessions"),
  clearHistoryButton: document.getElementById("clear-history-button"),
  toast: document.getElementById("toast"),
  installButton: document.getElementById("install-button"),
  themeButton: document.getElementById("theme-button"),
};

const languageDetails = {
  "en-US": {
    name: "English",
    symbol: "EN",
    description: "US English recognition",
    emptyTitle: "Ready when you are.",
  },
  "bn-BD": {
    name: "বাংলা",
    symbol: "বাং",
    description: "Bangla recognition",
    emptyTitle: "বলুন, Kotha লিখবে।",
  },
};

let currentLanguage = "en-US";
let recognition = null;
let isRecording = false;
let sessionText = "";
let recordingStartedAt = null;
let timerHandle = null;
let toastHandle = null;
let deferredInstallPrompt = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastHandle);
  toastHandle = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}

function getSessions() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 12)));
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.valueOf())) return "Just now";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function wordCount(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function updateWordCount() {
  const count = wordCount(elements.transcript.value);
  elements.wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function appendSpeech(existing, addition) {
  const left = existing.trim();
  const right = addition.trim();
  if (!left) return right;
  if (!right) return left;
  const startsWithPunctuation = /^[,.;:!?،。！？]/u.test(right);
  return `${left}${startsWithPunctuation ? "" : " "}${right}`;
}

function setLanguage(language) {
  if (!languageDetails[language]) return;

  if (isRecording) {
    stopRecording(false);
    showToast("Recording stopped so the language could change.");
  }

  currentLanguage = language;
  document.querySelectorAll(".language-option").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.language === language);
  });

  const details = languageDetails[language];
  elements.languageHighlight.innerHTML = `
    <div class="language-symbol">${details.symbol}</div>
    <div><strong>${details.name}</strong><span>${details.description}</span></div>
  `;
  elements.recordingTitle.textContent = elements.transcript.value.trim() ? "Keep going when ready." : details.emptyTitle;
  elements.transcript.lang = language;
  elements.saveState.textContent = `${details.name} selected`;
}

function updateRecordingUi() {
  elements.recordButton.classList.toggle("is-recording", isRecording);
  elements.soundWave.classList.toggle("is-live", isRecording);
  elements.recordingStatus.classList.toggle("is-live", isRecording);
  elements.recordingStatus.innerHTML = `<span class="status-dot"></span> ${isRecording ? "Listening" : "Idle"}`;
  elements.recordButton.setAttribute("aria-label", isRecording ? "Stop recording" : "Start recording");
  elements.recordHint.textContent = isRecording ? "Listening… speak naturally" : "Press to start dictating";
  elements.editorLiveLabel.textContent = isRecording ? "listening" : "editable";
}

function updateTimer() {
  if (!recordingStartedAt) {
    elements.timer.textContent = "00:00";
    return;
  }
  elements.timer.textContent = formatDuration((Date.now() - recordingStartedAt) / 1000);
}

function clearTimer() {
  window.clearInterval(timerHandle);
  timerHandle = null;
  recordingStartedAt = null;
  updateTimer();
}

function setTranscript(text, state = "Unsaved edits") {
  elements.transcript.value = text;
  updateWordCount();
  elements.saveState.textContent = state;
}

function buildRecognition() {
  if (!Recognition) return null;

  const instance = new Recognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.maxAlternatives = 1;
  instance.lang = currentLanguage;

  instance.onstart = () => {
    if (!isRecording) return;
    elements.recordHint.textContent = "Listening… speak naturally";
  };

  instance.onresult = (event) => {
    let finalChunk = "";
    let interimChunk = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const phrase = event.results[index][0]?.transcript || "";
      if (event.results[index].isFinal) {
        finalChunk += phrase;
      } else {
        interimChunk += phrase;
      }
    }

    if (finalChunk.trim()) {
      sessionText = appendSpeech(sessionText, finalChunk);
      setTranscript(sessionText, "Transcribing live");
    }
    elements.interimLine.textContent = interimChunk.trim() ? `Hearing: ${interimChunk.trim()}` : "";
  };

  instance.onerror = (event) => {
    const messages = {
      "not-allowed": "Microphone permission was blocked. Allow access in your browser and try again.",
      "service-not-allowed": "The browser speech service is unavailable right now.",
      "audio-capture": "No microphone was found. Check your Windows input device.",
      network: "The browser speech service needs a network connection.",
    };
    if (messages[event.error]) showToast(messages[event.error]);
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
      stopRecording(false);
    }
  };

  instance.onend = () => {
    if (!isRecording) return;
    window.setTimeout(() => {
      if (!isRecording || !recognition) return;
      try {
        recognition.start();
      } catch {
        // Chromium can report an already-running recognition object during a fast restart.
      }
    }, 180);
  };

  return instance;
}

function startRecording() {
  if (!Recognition) {
    showToast("Live speech recognition needs Chrome or Edge on this desktop.");
    elements.recordHint.textContent = "Open Kotha in Chrome or Edge";
    return;
  }

  if (isRecording) return;

  sessionText = elements.transcript.value.trim();
  recognition = buildRecognition();
  isRecording = true;
  recordingStartedAt = Date.now();
  updateRecordingUi();
  updateTimer();
  timerHandle = window.setInterval(updateTimer, 250);

  try {
    recognition.start();
  } catch (error) {
    isRecording = false;
    clearTimer();
    updateRecordingUi();
    showToast(error?.message || "Kotha could not start listening.");
  }
}

function saveCurrentSession() {
  const text = elements.transcript.value.trim();
  if (!text) return;

  const sessions = getSessions();
  const session = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    language: currentLanguage,
    createdAt: new Date().toISOString(),
    text,
  };
  saveSessions([session, ...sessions]);
  renderSessions();
  elements.saveState.textContent = "Saved locally";
}

function stopRecording(save = true) {
  if (!isRecording) return;

  isRecording = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch {
      // The browser may already have ended the recognition session.
    }
  }
  clearTimer();
  elements.interimLine.textContent = "";
  updateRecordingUi();
  elements.recordingTitle.textContent = elements.transcript.value.trim() ? "Nice. Shape it until it sounds like you." : languageDetails[currentLanguage].emptyTitle;

  if (save) saveCurrentSession();
}

function removeRepeatedPhrases(text) {
  const words = text.split(/\s+/u).filter(Boolean);
  for (let size = Math.min(5, Math.floor(words.length / 2)); size >= 1; size -= 1) {
    for (let index = 0; index + size * 2 <= words.length; index += 1) {
      const left = words.slice(index, index + size).join(" ").toLocaleLowerCase();
      const right = words.slice(index + size, index + size * 2).join(" ").toLocaleLowerCase();
      if (left === right) {
        words.splice(index + size, size);
        index -= 1;
      }
    }
  }
  return words.join(" ");
}

function polishEnglish(text) {
  return removeRepeatedPhrases(text
    .replace(/\b(?:um+|uh+|erm+|hmm+|you know|basically|actually)\b[,.]?/giu, "")
    .replace(/\b(\w+)(\s+\1\b)+/giu, "$1"))
    .replace(/\s+([,.;!?])/gu, "$1")
    .replace(/([.!?])(?=\S)/gu, "$1 ")
    .replace(/\s{2,}/gu, " ")
    .trim()
    .replace(/^([a-z])/u, (match) => match.toUpperCase());
}

function polishBangla(text) {
  return removeRepeatedPhrases(text
    .replace(/(?:উম+|আসলে|মানে|এই যে|অর্থাৎ)[,،]?/gu, "")
    .replace(/(\S+)(\s+\1\b)+/gu, "$1"))
    .replace(/\s+([,،।!?！？])/gu, "$1")
    .replace(/([।!?！？])(?=\S)/gu, "$1 ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function polishTranscript() {
  const original = elements.transcript.value.trim();
  if (!original) {
    showToast("Add a few words before polishing the transcript.");
    return;
  }

  let polished = currentLanguage === "bn-BD" ? polishBangla(original) : polishEnglish(original);
  if (polished && currentLanguage === "bn-BD" && !/[।!?！？]$/u.test(polished)) polished += "।";
  if (polished && currentLanguage === "en-US" && !/[.!?]$/u.test(polished)) polished += ".";
  setTranscript(polished, "Polished · edit freely");
  showToast("Transcript polished. Review it before you paste it elsewhere.");
}

async function copyTranscript() {
  const text = elements.transcript.value.trim();
  if (!text) {
    showToast("There is no transcript to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    elements.transcript.focus();
    elements.transcript.select();
    document.execCommand("copy");
    elements.transcript.setSelectionRange(text.length, text.length);
  }
  elements.saveState.textContent = "Copied to clipboard";
  showToast("Copied to clipboard.");
}

function downloadTranscript() {
  const text = elements.transcript.value.trim();
  if (!text) {
    showToast("There is no transcript to save yet.");
    return;
  }

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kotha-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  elements.saveState.textContent = "Downloaded .txt";
  showToast("Transcript downloaded.");
}

function clearTranscript() {
  if (!elements.transcript.value.trim()) return;
  if (!window.confirm("Clear the current transcript? Your saved sessions will stay safe.")) return;
  if (isRecording) stopRecording(false);
  setTranscript("", "Nothing saved yet");
  elements.interimLine.textContent = "";
  elements.recordingTitle.textContent = languageDetails[currentLanguage].emptyTitle;
  showToast("Transcript cleared.");
}

function loadSession(session) {
  if (isRecording) stopRecording(false);
  setLanguage(session.language || "en-US");
  setTranscript(session.text || "", "Loaded from local history");
  elements.recordingTitle.textContent = "A previous thought, ready to edit.";
  document.getElementById("dictate-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Session loaded. You can edit or copy it now.");
}

function renderSessions() {
  const sessions = getSessions();
  elements.sessionCount.textContent = String(sessions.length);
  elements.clearHistoryButton.hidden = sessions.length === 0;

  elements.sessionList.innerHTML = "";
  if (!sessions.length) {
    elements.sessionList.appendChild(elements.emptySessions);
    return;
  }

  sessions.forEach((session) => {
    const row = document.createElement("div");
    row.className = "session-row";

    const mark = document.createElement("div");
    mark.className = "session-row-mark";
    mark.textContent = session.language === "bn-BD" ? "বাং" : "EN";

    const copy = document.createElement("div");
    copy.className = "session-row-copy";

    const title = document.createElement("span");
    title.className = "session-row-title";
    title.textContent = session.text.split(/\s+/u).slice(0, 6).join(" ") || "Untitled session";

    const meta = document.createElement("span");
    meta.className = "session-row-meta";
    meta.textContent = `${languageDetails[session.language]?.name || "Voice"} · ${formatDate(session.createdAt)}`;

    const load = document.createElement("button");
    load.className = "session-row-load";
    load.type = "button";
    load.title = "Load session";
    load.setAttribute("aria-label", "Load session");
    load.textContent = "↗";
    load.addEventListener("click", () => loadSession(session));

    copy.append(title, meta);
    row.append(mark, copy, load);
    elements.sessionList.appendChild(row);
  });
}

function clearHistory() {
  if (!getSessions().length) return;
  if (!window.confirm("Clear all saved Kotha sessions from this browser?")) return;
  saveSessions([]);
  renderSessions();
  showToast("Local history cleared.");
}

function toggleTheme() {
  const isHighContrast = document.body.classList.toggle("high-contrast");
  window.localStorage.setItem(THEME_KEY, isHighContrast ? "high" : "soft");
  showToast(isHighContrast ? "Higher contrast enabled." : "Soft contrast restored.");
}

function loadTheme() {
  if (window.localStorage.getItem(THEME_KEY) === "high") document.body.classList.add("high-contrast");
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    elements.installButton.hidden = true;
    showToast("Kotha was installed as a desktop app.");
  });
}

function setupNavigation() {
  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.scrollTarget);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });
}

function setupEvents() {
  elements.recordButton.addEventListener("click", () => {
    if (isRecording) stopRecording(true);
    else startRecording();
  });
  elements.polishButton.addEventListener("click", polishTranscript);
  elements.copyButton.addEventListener("click", copyTranscript);
  elements.downloadButton.addEventListener("click", downloadTranscript);
  elements.clearButton.addEventListener("click", clearTranscript);
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.themeButton.addEventListener("click", toggleTheme);

  document.querySelectorAll(".language-option").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });

  elements.transcript.addEventListener("input", () => {
    if (!isRecording) elements.saveState.textContent = "Unsaved edits";
    updateWordCount();
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;

    if (event.code === "Space" && !isTypingTarget(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (isRecording) stopRecording(true);
      else startRecording();
      return;
    }

    if (modifier && event.key === "Enter") {
      event.preventDefault();
      copyTranscript();
      return;
    }

    if (modifier && event.shiftKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setLanguage(currentLanguage === "en-US" ? "bn-BD" : "en-US");
    }
  });
}

function init() {
  loadTheme();
  setLanguage(currentLanguage);
  updateRecordingUi();
  updateWordCount();
  renderSessions();
  setupEvents();
  setupNavigation();
  setupInstallPrompt();

  if (!Recognition) {
    elements.recordHint.textContent = "Open in Chrome or Edge to use your microphone";
    elements.recordingStatus.innerHTML = '<span class="status-dot"></span> Browser needed';
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // Offline caching is optional; the live app remains usable without it.
    });
  }
}

init();
