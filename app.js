const WS_URL = (() => {
  const host = window.location.hostname || "localhost";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${host}:8765`;
})();

const RECONNECT_DELAY = 3000;
const CLIENT_ID = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const FALLBACK_LANGUAGES = {
  english: "English",
  hindi: "Hindi",
  kannada: "Kannada",
  tamil: "Tamil",
  telugu: "Telugu",
  malayalam: "Malayalam",
  marathi: "Marathi",
  bengali: "Bengali",
  gujarati: "Gujarati",
  punjabi: "Punjabi",
  odia: "Odia",
  assamese: "Assamese",
  urdu: "Urdu",
  sanskrit: "Sanskrit",
  nepali: "Nepali",
  sindhi: "Sindhi",
};

const SPEECH_LANG_CODES = {
  english: "en-US",
  hindi: "hi-IN",
  kannada: "kn-IN",
  tamil: "ta-IN",
  telugu: "te-IN",
  malayalam: "ml-IN",
  marathi: "mr-IN",
  bengali: "bn-IN",
  gujarati: "gu-IN",
  punjabi: "pa-IN",
  odia: "or-IN",
  assamese: "as-IN",
  urdu: "ur-IN",
  sanskrit: "sa-IN",
  nepali: "ne-NP",
  sindhi: "sd-IN",
};

let ws = null;
let reconnectTimer = null;
let callSeconds = 0;
let callTimer = null;
let isConnected = false;
let languages = FALLBACK_LANGUAGES;
let peerConnection = null;
let localStream = null;
let isCallActive = false;
let bottomSpeaker = "person1";
let deferredInstallPrompt = null;

const translatingMsg = { person1: null, person2: null };

const statusEl = document.getElementById("connectionStatus");
const statusLabel = statusEl.querySelector(".status-label");
const durationEl = document.getElementById("callDuration");
const combinedMessages = document.getElementById("combinedMessages");
const messages1 = document.getElementById("messages1");
const messages2 = document.getElementById("messages2");
const input1 = document.getElementById("input1");
const input2 = document.getElementById("input2");
const send1 = document.getElementById("send1");
const send2 = document.getElementById("send2");
const mic1 = document.getElementById("mic1");
const mic2 = document.getElementById("mic2");
const avatar1 = document.getElementById("avatar1");
const avatar2 = document.getElementById("avatar2");
const toastEl = document.getElementById("toast");
const langSelect1 = document.getElementById("langSelect1");
const langSelect2 = document.getElementById("langSelect2");
const bottomInput = document.getElementById("bottomInput");
const bottomMic = document.getElementById("bottomMic");
const bottomSend = document.getElementById("bottomSend");
const composeForm = document.getElementById("composeForm");
const speakerPerson1 = document.getElementById("speakerPerson1");
const speakerPerson2 = document.getElementById("speakerPerson2");
const startCallBtn = document.getElementById("startCall");
const endCallBtn = document.getElementById("endCall");
const remoteAudio = document.getElementById("remoteAudio");
const callLabelEl = document.getElementById("callLabel");
const swapLanguagesBtn = document.getElementById("swapLanguages");
const installAppBtn = document.getElementById("installApp");

function connect() {
  clearTimeout(reconnectTimer);
  setStatus("", "Connecting...");

  try {
    ws = new WebSocket(WS_URL);
  } catch (error) {
    setStatus("error", "Offline");
    populateAllLanguages();
    return;
  }

  ws.onopen = () => {
    isConnected = true;
    setStatus("connected", "Connected");
    showToast("Bridge connected");
    sendMessage({ type: "get_languages" });
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  };

  ws.onclose = () => {
    isConnected = false;
    setStatus("error", "Offline");
    stopCallTimer();
    populateAllLanguages();
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => {
    setStatus("error", "Offline");
  };
}

function sendMessage(payload) {
  if (!isConnected || ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function sendSignal(action, payload) {
  return sendMessage({
    type: "signal",
    senderId: CLIENT_ID,
    signal: { action, payload },
  });
}

function handleServerMessage(data) {
  const { type, speaker } = data;

  if (type === "languages") {
    languages = data.languages || FALLBACK_LANGUAGES;
    populateAllLanguages();
    return;
  }

  if (type === "signal" && data.senderId !== CLIENT_ID) {
    handleSignal(data.signal);
    return;
  }

  if (type === "translating") {
    const targetPanel = speaker === "person1" ? "person2" : "person1";
    showTranslatingIndicator(targetPanel);
    pulseAvatar(speaker);
    return;
  }

  if (type === "translation") {
    removeTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
    appendMessage(combinedMessages, {
      speaker,
      original: data.original,
      translated: data.translated,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang,
    });
    return;
  }

  if (type === "error") {
    showToast(data.message || "Something went wrong");
  }
}

function populateAllLanguages() {
  populateLangSelect(langSelect1, "kannada");
  populateLangSelect(langSelect2, "english");
}

function populateLangSelect(selectEl, defaultKey) {
  const current = selectEl.value || defaultKey;
  selectEl.innerHTML = "";

  Object.entries(languages).forEach(([key, name]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = name;
    if (key === current) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function getLang(panel) {
  return panel === "person1" ? langSelect1.value : langSelect2.value;
}

function getOtherLang(panel) {
  return panel === "person1" ? langSelect2.value : langSelect1.value;
}

function clearEmptyState(container) {
  const es = container.querySelector(".empty-state");
  if (es) es.remove();
}

function appendMessage(container, { speaker, original, translated, sourceLang, targetLang }) {
  clearEmptyState(container);
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const srcLangName = languages[sourceLang] || sourceLang;
  const tgtLangName = languages[targetLang] || targetLang;
  const speakerName = speaker === "person1" ? "P1" : "P2";

  const group = document.createElement("article");
  group.className = `message-group from-${speaker}`;
  group.innerHTML = `
    <div class="msg-bubble msg-original">
      <div class="msg-label">${escapeHtml(speakerName)} spoke in ${escapeHtml(srcLangName)}</div>
      ${escapeHtml(original)}
    </div>
    <div class="translate-arrow">translated to ${escapeHtml(tgtLangName)}</div>
    <div class="msg-bubble msg-translated">
      <div class="msg-label">${speaker === "person1" ? "P2 hears" : "P1 hears"}</div>
      ${escapeHtml(translated)}
    </div>
    <div class="msg-time">${time}</div>
  `;
  container.appendChild(group);
  container.scrollTop = container.scrollHeight;
}

function appendTranslation(container, { translated, translatedLabel }) {
  appendMessage(container, {
    speaker: "person1",
    original: translated,
    translated,
    sourceLang: "",
    targetLang: translatedLabel,
  });
}

function showTranslatingIndicator(panelId) {
  clearEmptyState(combinedMessages);
  if (translatingMsg[panelId]) return;

  const el = document.createElement("div");
  el.className = `translating-indicator message-group from-${panelId}`;
  el.innerHTML = `<div class="dot-typing"><span></span><span></span><span></span></div><span>Translating...</span>`;
  combinedMessages.appendChild(el);
  combinedMessages.scrollTop = combinedMessages.scrollHeight;
  translatingMsg[panelId] = el;
}

function removeTranslatingIndicator(panelId) {
  if (!translatingMsg[panelId]) return;
  translatingMsg[panelId].remove();
  translatingMsg[panelId] = null;
}

function handleSend(speaker, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;

  if (!isConnected) {
    showToast("Start the Python server to translate");
    return;
  }

  const sent = sendMessage({
    type: "translate",
    speaker,
    text,
    sourceLang: getLang(speaker),
    targetLang: getOtherLang(speaker),
  });

  if (!sent) {
    showToast("Bridge is reconnecting");
    return;
  }

  inputEl.value = "";
  resizeTextarea(inputEl);
}

function resizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
}

send1.addEventListener("click", () => handleSend("person1", input1));
send2.addEventListener("click", () => handleSend("person2", input2));

composeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  handleSend(bottomSpeaker, bottomInput);
});

[bottomInput, input1, input2].forEach((el) => {
  el.addEventListener("input", () => resizeTextarea(el));
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const speaker = el === input1 ? "person1" : el === input2 ? "person2" : bottomSpeaker;
      handleSend(speaker, el);
    }
  });
});

function updateBottomSpeaker(selected) {
  bottomSpeaker = selected;
  speakerPerson1.classList.toggle("active", selected === "person1");
  speakerPerson2.classList.toggle("active", selected === "person2");
  bottomInput.placeholder = selected === "person1" ? "Person 1 message..." : "Person 2 message...";
}

speakerPerson1.addEventListener("click", () => updateBottomSpeaker("person1"));
speakerPerson2.addEventListener("click", () => updateBottomSpeaker("person2"));

swapLanguagesBtn.addEventListener("click", () => {
  const first = langSelect1.value;
  langSelect1.value = langSelect2.value;
  langSelect2.value = first;
  updateBottomSpeaker(bottomSpeaker === "person1" ? "person2" : "person1");
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function setupMic(micBtn, inputEl, speaker, langSelect) {
  if (!SpeechRecognition) {
    micBtn.title = "Voice input is not supported in this browser";
    micBtn.style.opacity = "0.55";
    return;
  }

  let recognition = null;
  let isRecording = false;

  micBtn.addEventListener("click", () => {
    if (isRecording) {
      recognition.stop();
      return;
    }

    const speakerKey = typeof speaker === "function" ? speaker() : speaker;
    const langSelectEl = typeof langSelect === "function" ? langSelect() : langSelect;
    const langKey = langSelectEl.value;
    const speechLang = SPEECH_LANG_CODES[langKey] || "en-US";

    recognition = new SpeechRecognition();
    recognition.lang = speechLang;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isRecording = true;
      micBtn.classList.add("recording");
      showToast(`Listening in ${languages[langKey] || langKey}`);
    };

    recognition.onresult = (event) => {
      inputEl.value = Array.from(event.results).map((result) => result[0].transcript).join("");
      resizeTextarea(inputEl);
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove("recording");
      if (inputEl.value.trim()) handleSend(speakerKey, inputEl);
    };

    recognition.onerror = (event) => {
      isRecording = false;
      micBtn.classList.remove("recording");
      showToast(`Mic error: ${event.error}`);
    };

    recognition.start();
  });
}

setupMic(mic1, input1, "person1", langSelect1);
setupMic(mic2, input2, "person2", langSelect2);
setupMic(bottomMic, bottomInput, () => bottomSpeaker, () => (bottomSpeaker === "person1" ? langSelect1 : langSelect2));

async function createPeerConnection() {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) sendSignal("ice", { candidate: event.candidate });
  };

  peerConnection.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(() => {});
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === "connected" || state === "completed") {
      setCallLabel("In translated call");
      startCallTimer();
      startCallBtn.disabled = true;
      endCallBtn.disabled = false;
      showToast("Call connected");
    }

    if (state === "disconnected" || state === "failed" || state === "closed") {
      hangupCall(false);
    }
  };

  if (localStream) {
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  }

  return peerConnection;
}

async function handleSignal(signal) {
  const { action, payload } = signal || {};
  if (!action || !payload) return;

  if (action === "offer") {
    await ensureLocalAudio();
    await createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendSignal("answer", peerConnection.localDescription);
    isCallActive = true;
    setCallLabel("In translated call");
    startCallTimer();
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
  }

  if (action === "answer" && peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(payload));
  }

  if (action === "ice" && peerConnection) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (error) {
      console.warn("ICE candidate failed", error);
    }
  }
}

async function ensureLocalAudio() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return localStream;
}

function setCallLabel(text) {
  callLabelEl.textContent = text;
}

async function startCall() {
  if (isCallActive) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Audio calls are not supported in this browser");
    return;
  }
  if (!isConnected) {
    showToast("Connect to the bridge server first");
    return;
  }

  try {
    await ensureLocalAudio();
    await createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal("offer", peerConnection.localDescription);

    isCallActive = true;
    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    setCallLabel("Calling...");
    startCallTimer();
    showToast("Calling nearby connected device");
  } catch (error) {
    showToast(`Call setup failed: ${error.message}`);
  }
}

function hangupCall(showMessage = true) {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  remoteAudio.srcObject = null;
  isCallActive = false;
  startCallBtn.disabled = false;
  endCallBtn.disabled = true;
  setCallLabel("Ready for translated calls");
  stopCallTimer();
  durationEl.textContent = "00:00";
  if (showMessage) showToast("Call ended");
}

startCallBtn.addEventListener("click", startCall);
endCallBtn.addEventListener("click", () => hangupCall(true));

function startCallTimer() {
  if (callTimer) return;
  callTimer = setInterval(() => {
    callSeconds += 1;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, "0");
    const s = String(callSeconds % 60).padStart(2, "0");
    durationEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopCallTimer() {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
  callSeconds = 0;
}

function setStatus(state, label) {
  statusEl.className = `connection-status ${state}`;
  statusLabel.textContent = label;
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
}

function pulseAvatar(speaker) {
  const avatar = speaker === "person1" ? avatar1 : avatar2;
  avatar.classList.add("speaking");
  setTimeout(() => avatar.classList.remove("speaking"), 1400);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installAppBtn.disabled = false;
});

installAppBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    showToast("Use your browser menu to install this app");
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

populateAllLanguages();
updateBottomSpeaker("person1");
setStatus("", "Connecting...");
connect();
