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
let isAudioMuted = false;
let callRecognition = null;
let isCallRecognitionActive = false;
let bottomSpeaker = "person1";
let deferredInstallPrompt = null;
let pendingLocalSpeech = null;

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
const muteCallBtn = document.getElementById("muteCall");

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
    // Clear pending local speech if this is the result we were waiting for.
    if (pendingLocalSpeech && pendingLocalSpeech.speaker === speaker && pendingLocalSpeech.text === data.original) {
      pendingLocalSpeech = null;
    }
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

async function translateWithClaude(text, sourceLang, targetLang) {
  const srcName = languages[sourceLang] || sourceLang;
  const tgtName = languages[targetLang] || targetLang;

  if (sourceLang === targetLang) return text;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Translate the following text from ${srcName} to ${tgtName}. Reply with ONLY the translated text, nothing else.\n\n${text}`,
      }],
    }),
  });

  const data = await response.json();
  const raw = (data.content || []).map(b => b.text || "").join("").trim();
  return raw || text;
}

async function handleSend(speaker, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;

  const sourceLang = getLang(speaker);
  const targetLang = getOtherLang(speaker);

  inputEl.value = "";
  resizeTextarea(inputEl);

  // If WebSocket server is online, use it as usual.
  if (isConnected) {
    const sent = sendMessage({ type: "translate", speaker, text, sourceLang, targetLang });
    if (!sent) showToast("Bridge is reconnecting — using built-in translation");
    else return;
  }

  // Fallback: translate directly in the browser via Claude API.
  showTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
  pulseAvatar(speaker);

  try {
    const translated = await translateWithClaude(text, sourceLang, targetLang);
    removeTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
    appendMessage(combinedMessages, { speaker, original: text, translated, sourceLang, targetLang });
  } catch (err) {
    removeTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
    showToast("Translation failed — check your connection");
  }
}

function resizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
}

async function sendSpeechText(speaker, text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;

  const sourceLang = getLang(speaker);
  const targetLang = getOtherLang(speaker);

  if (isConnected) {
    pendingLocalSpeech = { speaker, text: trimmed, sourceLang, targetLang };
    return sendMessage({ type: "translate", speaker, text: trimmed, sourceLang, targetLang });
  }

  // Fallback: translate via Claude API directly in the browser.
  showTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
  pulseAvatar(speaker);

  try {
    const translated = await translateWithClaude(trimmed, sourceLang, targetLang);
    removeTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
    appendMessage(combinedMessages, { speaker, original: trimmed, translated, sourceLang, targetLang });
  } catch (err) {
    removeTranslatingIndicator(speaker === "person1" ? "person2" : "person1");
    showToast("Translation failed — check your connection");
  }

  return true;
}

function startCallSpeechRecognition() {
  if (!SpeechRecognition || !isCallActive || isCallRecognitionActive) return;
  isCallRecognitionActive = true;

  const speaker = bottomSpeaker;
  const langKey = getLang(speaker);
  const speechLang = SPEECH_LANG_CODES[langKey] || "en-US";

  callRecognition = new SpeechRecognition();
  callRecognition.lang = speechLang;
  callRecognition.continuous = true;
  callRecognition.interimResults = true;

  let callLiveBubble = null;

  function showCallLiveBubble(text) {
    clearEmptyState(combinedMessages);
    if (!callLiveBubble) {
      callLiveBubble = document.createElement("article");
      callLiveBubble.className = `message-group from-${speaker} live-bubble`;
      combinedMessages.appendChild(callLiveBubble);
    }
    callLiveBubble.innerHTML = `
      <div class="msg-bubble msg-original" style="opacity:0.7;font-style:italic;">
        <div class="msg-label" style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);animation:recording-pulse 1s ease-in-out infinite;"></span>
          ${speaker === "person1" ? "P1" : "P2"} speaking…
        </div>
        ${escapeHtml(text)}
      </div>`;
    combinedMessages.scrollTop = combinedMessages.scrollHeight;
  }

  function removeCallLiveBubble() {
    if (callLiveBubble) { callLiveBubble.remove(); callLiveBubble = null; }
  }

  callRecognition.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += `${transcript} `;
      } else {
        interimTranscript += transcript;
      }
    }

    const liveText = interimTranscript || finalTranscript;
    if (liveText.trim()) showCallLiveBubble(liveText.trim());

    bottomInput.value = interimTranscript;
    resizeTextarea(bottomInput);

    if (finalTranscript.trim()) {
      removeCallLiveBubble();
      sendSpeechText(speaker, finalTranscript.trim());
      bottomInput.value = "";
      resizeTextarea(bottomInput);
    }
  };

  callRecognition.onend = () => {
    if (!isCallActive) {
      isCallRecognitionActive = false;
      return;
    }
    try {
      callRecognition.start();
    } catch (error) {
      isCallRecognitionActive = false;
    }
  };

  callRecognition.onerror = (event) => {
    showToast(`Call recognition error: ${event.error}`);
  };

  callRecognition.start();
  bottomMic.classList.add("recording");
  bottomMic.setAttribute("aria-label", "Mic active — listening");
}

function stopCallSpeechRecognition() {
  if (!callRecognition) return;
  try {
    callRecognition.stop();
  } catch (error) {
    // ignore stop errors
  }
  callRecognition = null;
  isCallRecognitionActive = false;
  bottomMic.classList.remove("recording");
  bottomMic.setAttribute("aria-label", "Voice input");
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
  let liveBubble = null;

  function showLiveBubble(speakerKey, text) {
    clearEmptyState(combinedMessages);
    if (!liveBubble) {
      liveBubble = document.createElement("article");
      liveBubble.className = `message-group from-${speakerKey} live-bubble`;
      combinedMessages.appendChild(liveBubble);
    }
    liveBubble.innerHTML = `
      <div class="msg-bubble msg-original" style="opacity:0.7;font-style:italic;">
        <div class="msg-label" style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);animation:recording-pulse 1s ease-in-out infinite;"></span>
          ${speakerKey === "person1" ? "P1" : "P2"} speaking…
        </div>
        ${escapeHtml(text)}
      </div>`;
    combinedMessages.scrollTop = combinedMessages.scrollHeight;
  }

  function removeLiveBubble() {
    if (liveBubble) {
      liveBubble.remove();
      liveBubble = null;
    }
  }

  micBtn.addEventListener("click", () => {
    // During an active call, mic is managed automatically — ignore manual taps.
    if (isCallActive) return;

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
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join("");
      inputEl.value = transcript;
      resizeTextarea(inputEl);
      if (transcript.trim()) showLiveBubble(speakerKey, transcript);
    };

    recognition.onspeechend = () => {
      recognition.stop();
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove("recording");
      removeLiveBubble();
      if (inputEl.value.trim()) handleSend(speakerKey, inputEl);
    };

    recognition.onerror = (event) => {
      isRecording = false;
      micBtn.classList.remove("recording");
      removeLiveBubble();
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
    const incomingStream = event.streams[0];
    if (!incomingStream) return;

    const localTrackIds = new Set((localStream?.getAudioTracks() || []).map((track) => track.id));
    const incomingTrackIds = new Set(incomingStream.getAudioTracks().map((track) => track.id));
    const isSelfStream = [...incomingTrackIds].some((id) => localTrackIds.has(id));

    if (isSelfStream) return;

    remoteAudio.srcObject = incomingStream;
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
      // Don't send a hangup signal here — either we already sent one, or
      // the remote already sent one. Just clean up locally.
      hangupCall(false, false);
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

  if (action === "hangup") {
    // The remote peer ended the call — end it locally without sending
    // another hangup signal back (avoids an infinite loop).
    hangupCall(true, false);
    showToast("The other person ended the call");
    return;
  }

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
    muteCallBtn.disabled = false;
    updateCallMuteState();
    startCallSpeechRecognition();
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
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return localStream;
}

function updateCallMuteState() {
  const muted = isAudioMuted;
  remoteAudio.muted = muted;
  muteCallBtn.classList.toggle("active", muted);
  muteCallBtn.title = muted ? "Unmute call audio" : "Mute call audio";
  muteCallBtn.setAttribute("aria-label", muted ? "Unmute call audio" : "Mute call audio");
}

function toggleCallMute() {
  if (!isCallActive) return;
  isAudioMuted = !isAudioMuted;
  updateCallMuteState();
  showToast(isAudioMuted ? "Call audio muted" : "Call audio unmuted");
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
    muteCallBtn.disabled = false;
    updateCallMuteState();
    startCallSpeechRecognition();
    setCallLabel("Calling...");
    startCallTimer();
    showToast("Calling nearby connected device");
  } catch (error) {
    showToast(`Call setup failed: ${error.message}`);
  }
}

function hangupCall(showMessage = true, sendSignalToRemote = true) {
  // Notify the other side so their call ends immediately too.
  if (sendSignalToRemote && isCallActive) {
    sendSignal("hangup", { reason: "ended" });
  }

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
  isAudioMuted = false;
  stopCallSpeechRecognition();
  startCallBtn.disabled = false;
  endCallBtn.disabled = true;
  muteCallBtn.disabled = true;
  muteCallBtn.classList.remove("active");
  muteCallBtn.title = "Mute call audio";
  muteCallBtn.setAttribute("aria-label", "Mute call audio");
  remoteAudio.muted = false;
  setCallLabel("Ready for translated calls");
  stopCallTimer();
  durationEl.textContent = "00:00";
  if (showMessage) showToast("Call ended");
}

startCallBtn.addEventListener("click", startCall);
muteCallBtn.addEventListener("click", toggleCallMute);
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
