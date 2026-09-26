// Side panel UI. Sends user input to the background service worker, which
// runs the agent loop and streams back log/status/prompts.

const els = {
  prompt: document.getElementById("prompt"),
  mic: document.getElementById("mic"),
  paste: document.getElementById("paste"),
  image: document.getElementById("image"),
  run: document.getElementById("run"),
  stop: document.getElementById("stop"),
  pastePreview: document.getElementById("pastePreview"),
  imagePreview: document.getElementById("imagePreview"),
  confirmBox: document.getElementById("confirmBox"),
  confirmText: document.getElementById("confirmText"),
  confirmYes: document.getElementById("confirmYes"),
  confirmNo: document.getElementById("confirmNo"),
  chooserBox: document.getElementById("chooserBox"),
  chooserOptions: document.getElementById("chooserOptions"),
  log: document.getElementById("log"),
  status: document.getElementById("status"),
};

const state = {
  pastedText: "",
  imageDataUrl: null,
  awaitingConfirm: null,
  awaitingChoose: null,
  micStop: null,
};

function setStatus(text, kind = "idle") {
  els.status.textContent = text;
  els.status.className = "status " + kind;
}

function logLine({ text, meta, kind }) {
  const li = document.createElement("li");
  if (kind) li.className = kind;
  li.textContent = text;
  if (meta) {
    const span = document.createElement("span");
    span.className = "meta";
    span.textContent = meta;
    li.appendChild(span);
  }
  els.log.appendChild(li);
  els.log.scrollTop = els.log.scrollHeight;
}

async function run() {
  const text = els.prompt.value.trim();
  if (!text && !state.pastedText && !state.imageDataUrl) return;
  els.run.disabled = true;
  els.stop.disabled = false;
  setStatus("planning…", "busy");
  els.log.innerHTML = "";

  chrome.runtime.sendMessage({
    type: "RUN_TASK",
    payload: {
      text,
      pastedText: state.pastedText || null,
      imageDataUrl: state.imageDataUrl || null,
    },
  });
}

function stop() {
  chrome.runtime.sendMessage({ type: "STOP_TASK" });
  setStatus("stopped", "idle");
  els.run.disabled = false;
  els.stop.disabled = true;
}

els.run.addEventListener("click", run);
els.stop.addEventListener("click", stop);

els.paste.addEventListener("click", async () => {
  try {
    const t = await navigator.clipboard.readText();
    state.pastedText = t;
    els.pastePreview.textContent = t.slice(0, 500) + (t.length > 500 ? "…" : "");
    els.pastePreview.classList.remove("hidden");
  } catch (e) {
    logLine({ text: "clipboard read failed: " + e.message, kind: "err" });
  }
});

els.image.addEventListener("change", () => {
  const f = els.image.files && els.image.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.imageDataUrl = reader.result;
    els.imagePreview.innerHTML = `<img src="${state.imageDataUrl}" alt="preview"/>`;
    els.imagePreview.classList.remove("hidden");
  };
  reader.readAsDataURL(f);
});

els.mic.addEventListener("click", () => {
  if (state.micStop) {
    state.micStop();
    state.micStop = null;
    els.mic.textContent = "Mic";
    return;
  }
  if (!window.JarvisMic || !window.JarvisMic.supported) {
    logLine({ text: "Voice not supported in this browser", kind: "err" });
    return;
  }
  els.mic.textContent = "Mic…";
  state.micStop = window.JarvisMic.start(
    (finalText) => {
      els.prompt.value = (els.prompt.value ? els.prompt.value + " " : "") + finalText;
      els.mic.textContent = "Mic";
      state.micStop = null;
    },
    (err) => {
      logLine({ text: "mic: " + err.message, kind: "err" });
      els.mic.textContent = "Mic";
      state.micStop = null;
    }
  );
});

els.confirmYes.addEventListener("click", () => {
  if (!state.awaitingConfirm) return;
  chrome.runtime.sendMessage({ type: "USER_CONFIRM", id: state.awaitingConfirm, ok: true });
  state.awaitingConfirm = null;
  els.confirmBox.classList.add("hidden");
});
els.confirmNo.addEventListener("click", () => {
  if (!state.awaitingConfirm) return;
  chrome.runtime.sendMessage({ type: "USER_CONFIRM", id: state.awaitingConfirm, ok: false });
  state.awaitingConfirm = null;
  els.confirmBox.classList.add("hidden");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOG") {
    logLine(msg.payload);
  } else if (msg.type === "STATUS") {
    setStatus(msg.payload.text, msg.payload.kind || "idle");
    if (msg.payload.done) {
      els.run.disabled = false;
      els.stop.disabled = true;
    }
  } else if (msg.type === "ASK_CONFIRM") {
    state.awaitingConfirm = msg.payload.id;
    els.confirmText.textContent = msg.payload.text;
    els.confirmBox.classList.remove("hidden");
  } else if (msg.type === "ASK_CHOOSE") {
    state.awaitingChoose = msg.payload.id;
    els.chooserOptions.innerHTML = "";
    for (const opt of msg.payload.options) {
      const b = document.createElement("button");
      b.textContent = opt.label + (opt.p != null ? ` (${(opt.p * 100).toFixed(0)}%)` : "");
      b.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "USER_CHOOSE", id: msg.payload.id, elementId: opt.id });
        els.chooserBox.classList.add("hidden");
        state.awaitingChoose = null;
      });
      els.chooserOptions.appendChild(b);
    }
    els.chooserBox.classList.remove("hidden");
  } else if (msg.type === "DONE") {
    setStatus("done", "ok");
    els.run.disabled = false;
    els.stop.disabled = true;
  }
});
