/* ============================================================
   Chimera Frontend Core
   - Google Identity Services login
   - Backend authentication
   - Cloud note load/save
   - Large draggable/resizable AI panel
   ============================================================ */

export let chimeraUser = null;
export let chimeraToken = null;
export let chimeraPlan = "free";
export let chimeraLimits = null;
export let chimeraSupportEmail = "aaravkedeveloper@gmail.com";

const backendBaseUrl =
  window.CHIMERA_BACKEND_URL ||
  localStorage.getItem("chimeraBackendUrl") ||
  (window.location.hostname.includes("github.io")
    ? "https://chimera-test-2.onrender.com"
    : "http://localhost:4000");

const MAX_HISTORY_MESSAGES = 12;
const aiState = {
  initialized: false,
  history: [],
  mode: "chat"
};

function normalizePlan(plan) {
  return String(plan || "").toLowerCase() === "pro" ? "pro" : "free";
}

function setPlanState(plan, limits = null) {
  chimeraPlan = normalizePlan(plan);
  chimeraLimits = limits || null;
  window.dispatchEvent(
    new CustomEvent("chimera-plan-updated", {
      detail: { plan: chimeraPlan, limits: chimeraLimits }
    })
  );
}

function setSupportEmail(email) {
  const value = String(email || "").trim();
  if (!value) {
    return;
  }
  chimeraSupportEmail = value;
  window.dispatchEvent(
    new CustomEvent("chimera-support-email-updated", {
      detail: { supportEmail: chimeraSupportEmail }
    })
  );
}

function decodeJwtPayload(token) {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function showMainApp() {
  const startPage = document.getElementById("start-page");
  const appContainer = document.getElementById("app-container");
  if (startPage && appContainer) {
    startPage.style.display = "none";
    appContainer.style.display = "grid";
  }
}

function syncUserUi() {
  const userInfo = document.getElementById("user-info");
  if (userInfo && chimeraUser?.name) {
    userInfo.textContent = `Signed in as ${chimeraUser.name}`;
  }
}

function getJsonHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (chimeraToken) {
    headers.Authorization = `Bearer ${chimeraToken}`;
  }
  return headers;
}

async function extractErrorPayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function appendAiMessage(kind, text) {
  const messages = document.getElementById("chimera-ai-messages");
  if (!messages) {
    return;
  }

  const messageEl = document.createElement("div");
  messageEl.className = `chimera-ai-message ${kind}`;
  messageEl.textContent = text;
  messages.appendChild(messageEl);
  messages.scrollTop = messages.scrollHeight;
}

function setAiBusy(isBusy) {
  const input = document.getElementById("chimera-ai-input");
  const send = document.getElementById("chimera-ai-send");
  if (input) {
    input.disabled = isBusy;
  }
  if (send) {
    send.disabled = isBusy;
    send.textContent =
      isBusy && aiState.mode === "deep-search"
        ? "Researching..."
        : isBusy
          ? "Thinking..."
          : "Send";
  }
}

function normalizeAiMode(mode) {
  return mode === "deep-search" ? "deep-search" : "chat";
}

function getOpenNoteContext() {
  const titleInput = document.getElementById("note-title");
  const editor = document.getElementById("note-editor");
  const folderSelect = document.getElementById("note-folder");
  const title = String(titleInput?.value || "").trim();
  const content = String(editor?.value || "").trim();
  const folder = String(folderSelect?.value || "").trim();

  if (!title && !content) {
    return null;
  }

  return {
    title: title || "Untitled Note",
    content,
    folder: folder || "General"
  };
}

function setAiMode(mode) {
  aiState.mode = normalizeAiMode(mode);
  const chatBtn = document.getElementById("chimera-ai-mode-chat");
  const deepBtn = document.getElementById("chimera-ai-mode-deep");
  const badge = document.getElementById("chimera-ai-mode-badge");
  const input = document.getElementById("chimera-ai-input");

  if (chatBtn && deepBtn) {
    chatBtn.classList.toggle("active", aiState.mode === "chat");
    deepBtn.classList.toggle("active", aiState.mode === "deep-search");
  }

  if (badge) {
    badge.textContent =
      aiState.mode === "deep-search" ? "Deep Search Mode" : "Chat Mode";
  }

  if (input) {
    input.placeholder =
      aiState.mode === "deep-search"
        ? "Ask for deep research. Example: Compare top coding laptops for school."
        : "Ask Chimera AI anything...";
  }
}

function makeAiPanelDraggable() {
  const panel = document.getElementById("chimera-ai-panel");
  const header = document.getElementById("chimera-ai-panel-header");
  if (!panel || !header) {
    return;
  }

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    dragging = true;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.classList.add("dragging");
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    const maxLeft = window.innerWidth - panelRect.width;
    const maxTop = window.innerHeight - panelRect.height;

    const left = clamp(event.clientX - offsetX, 0, Math.max(0, maxLeft));
    const top = clamp(event.clientY - offsetY, 0, Math.max(0, maxTop));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    panel.classList.remove("dragging");
  });
}

function ensureAiPanel() {
  let panel = document.getElementById("chimera-ai-panel");
  if (panel) {
    return panel;
  }

  const html = `
    <section id="chimera-ai-panel" class="chimera-ai-panel hidden" aria-label="Chimera AI panel">
      <div id="chimera-ai-panel-header" class="chimera-ai-panel-header">
        <div class="chimera-ai-panel-title">Chimera AI</div>
        <div class="chimera-ai-panel-actions">
          <button id="chimera-ai-clear" type="button">Clear</button>
          <button id="chimera-ai-close" type="button">Close</button>
        </div>
      </div>
      <div class="chimera-ai-mode-row">
        <div class="chimera-ai-mode-switch">
          <button id="chimera-ai-mode-chat" type="button" class="active">Chat</button>
          <button id="chimera-ai-mode-deep" type="button">Deep Search</button>
        </div>
        <button id="chimera-ai-note-suggest" type="button">Suggest from Open Note</button>
      </div>
      <div id="chimera-ai-mode-badge" class="chimera-ai-mode-badge">Chat Mode</div>
      <div id="chimera-ai-messages" class="chimera-ai-messages"></div>
      <form id="chimera-ai-form" class="chimera-ai-form">
        <textarea
          id="chimera-ai-input"
          class="chimera-ai-input"
          rows="3"
          placeholder="Ask Chimera AI anything..."
        ></textarea>
        <button id="chimera-ai-send" type="submit">Send</button>
      </form>
    </section>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
  panel = document.getElementById("chimera-ai-panel");
  makeAiPanelDraggable();
  return panel;
}

async function sendAiMessage(message) {
  const noteContext = getOpenNoteContext();
  try {
    const response = await fetch(`${backendBaseUrl}/ai/chat`, {
      method: "POST",
      headers: getJsonHeaders(),
      body: JSON.stringify({
        message,
        history: aiState.history,
        mode: aiState.mode,
        noteContext
      })
    });

    if (!response.ok) {
      const errorPayload = await response
        .json()
        .catch(() => ({ error: "" }));
      if (response.status === 503) {
        return {
          reply:
            errorPayload.error ||
            "AI service is waking up or misconfigured on the backend.",
          sources: []
        };
      }
      return { reply: errorPayload.error || "AI request failed.", sources: [] };
    }

    const data = await response.json();
    return {
      reply: data.reply || "No response returned.",
      sources: Array.isArray(data.sources) ? data.sources : []
    };
  } catch (error) {
    return { reply: "Could not reach the backend.", sources: [] };
  }
}

async function submitAiMessage() {
  const input = document.getElementById("chimera-ai-input");
  if (!input) {
    return;
  }

  const text = input.value.trim();
  if (!text) {
    return;
  }

  input.value = "";
  appendAiMessage("user", text);

  aiState.history.push({ role: "user", text });
  aiState.history = aiState.history.slice(-MAX_HISTORY_MESSAGES);

  setAiBusy(true);
  const result = await sendAiMessage(text);
  setAiBusy(false);

  const responseText = result?.reply || "No response returned.";
  appendAiMessage("assistant", responseText);
  if (Array.isArray(result?.sources) && result.sources.length > 0) {
    const preview = result.sources.slice(0, 8).join("\n");
    const sourceMessage =
      `Sources used: ${result.sources.length}\n` +
      (preview ? `Top links:\n${preview}` : "");
    appendAiMessage("assistant", sourceMessage.trim());
  }

  aiState.history.push({ role: "assistant", text: responseText });
  aiState.history = aiState.history.slice(-MAX_HISTORY_MESSAGES);
}

export async function handleGoogleCredential(credential) {
  if (!credential) {
    console.error("Missing Google credential");
    return;
  }

  // Always allow app entry after Google sign-in, even if backend is unreachable.
  chimeraToken = credential;
  const payload = decodeJwtPayload(credential);
  if (payload) {
    chimeraUser = {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };
    localStorage.setItem("chimeraUser", JSON.stringify(chimeraUser));
  }
  syncUserUi();
  showMainApp();

  let cloudNotes = [];
  let authPlan = "free";
  let authLimits = null;
  let authSupportEmail = chimeraSupportEmail;

  try {
    const res = await fetch(`${backendBaseUrl}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential })
    });

    if (res.ok) {
      const data = await res.json();
      chimeraUser = data.user || chimeraUser;
      chimeraToken = data.token || chimeraToken;
      authPlan = data.plan || data.user?.plan || "free";
      authLimits = data.limits || null;
      authSupportEmail = data.supportEmail || chimeraSupportEmail;
      if (chimeraUser) {
        localStorage.setItem("chimeraUser", JSON.stringify(chimeraUser));
      }
      syncUserUi();
    } else {
      console.warn(`Backend auth failed (${res.status}); continuing in local mode.`);
    }
  } catch (err) {
    console.warn("Backend auth unavailable; continuing in local mode.", err);
  }

  setPlanState(authPlan, authLimits);
  setSupportEmail(authSupportEmail);

  try {
    cloudNotes = await loadNotesFromCloud();
  } catch {
    cloudNotes = [];
  }

  window.dispatchEvent(
    new CustomEvent("chimera-authenticated", {
      detail: {
        user: chimeraUser,
        notes: cloudNotes,
        plan: chimeraPlan,
        limits: chimeraLimits,
        supportEmail: chimeraSupportEmail
      }
    })
  );
}

export async function loadNotesFromCloud() {
  if (!chimeraToken) {
    return [];
  }

  const res = await fetch(`${backendBaseUrl}/notes`, {
    headers: { Authorization: `Bearer ${chimeraToken}` }
  });

  if (!res.ok) {
    console.error("Failed to load notes");
    return [];
  }

  return await res.json();
}

export async function saveNoteToCloud(note) {
  if (!chimeraToken) {
    return null;
  }

  const res = await fetch(`${backendBaseUrl}/notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chimeraToken}`
    },
    body: JSON.stringify(note)
  });

  const data = await extractErrorPayload(res);
  if (!res.ok) {
    if (data?.plan || data?.limits) {
      setPlanState(data.plan, data.limits);
    }

    const error = new Error(data.error || "Could not save note to cloud.");
    error.code = data.errorCode || "NOTE_SAVE_FAILED";
    error.limitType = data.limitType || null;
    error.requiresPro = Boolean(data.requiresPro);
    error.plan = data.plan || chimeraPlan;
    error.limits = data.limits || chimeraLimits;
    error.usage = data.usage || null;
    throw error;
  }

  if (data?.plan || data?.limits) {
    setPlanState(data.plan, data.limits);
  }

  return data.id || null;
}

export async function deleteNoteFromCloud(id) {
  if (!chimeraToken || !id) {
    return false;
  }

  const res = await fetch(`${backendBaseUrl}/notes/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${chimeraToken}` }
  });

  return res.ok;
}

export function isProUser() {
  return normalizePlan(chimeraPlan) === "pro";
}

export async function upgradeToPro(code) {
  if (!chimeraToken) {
    throw new Error("Sign in first.");
  }

  const normalizedCode = String(code || "").trim();
  if (!normalizedCode) {
    throw new Error("Enter your Pro code.");
  }

  const res = await fetch(`${backendBaseUrl}/billing/upgrade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chimeraToken}`
    },
    body: JSON.stringify({ code: normalizedCode })
  });

  const data = await extractErrorPayload(res);
  if (!res.ok) {
    throw new Error(data.error || "Upgrade failed.");
  }

  setPlanState(data.plan, data.limits);
  setSupportEmail(data.supportEmail);
  return {
    plan: chimeraPlan,
    limits: chimeraLimits,
    supportEmail: chimeraSupportEmail
  };
}

export function initAiTerminal() {
  if (aiState.initialized) {
    return;
  }

  ensureAiPanel();
  aiState.initialized = true;
  appendAiMessage(
    "assistant",
    "Chimera AI is online. Ask anything and I will help."
  );

  const form = document.getElementById("chimera-ai-form");
  const input = document.getElementById("chimera-ai-input");
  const close = document.getElementById("chimera-ai-close");
  const clear = document.getElementById("chimera-ai-clear");
  const chatModeButton = document.getElementById("chimera-ai-mode-chat");
  const deepModeButton = document.getElementById("chimera-ai-mode-deep");
  const suggestButton = document.getElementById("chimera-ai-note-suggest");
  const toolbarButton = document.getElementById("btn-open-ai");

  setAiMode("chat");

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitAiMessage();
    });
  }

  if (input) {
    input.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        await submitAiMessage();
      }
    });
  }

  if (close) {
    close.addEventListener("click", () => {
      const panel = document.getElementById("chimera-ai-panel");
      if (panel) {
        panel.classList.add("hidden");
      }
    });
  }

  if (clear) {
    clear.addEventListener("click", () => {
      aiState.history = [];
      const messages = document.getElementById("chimera-ai-messages");
      if (messages) {
        messages.innerHTML = "";
      }
      appendAiMessage(
        "assistant",
        "Chat cleared. Ready for your next prompt."
      );
    });
  }

  if (chatModeButton) {
    chatModeButton.addEventListener("click", () => {
      setAiMode("chat");
      appendAiMessage("assistant", "Chat mode enabled.");
    });
  }

  if (deepModeButton) {
    deepModeButton.addEventListener("click", () => {
      setAiMode("deep-search");
      appendAiMessage(
        "assistant",
        "Deep Search mode enabled. I will research many sources before replying."
      );
    });
  }

  if (suggestButton) {
    suggestButton.addEventListener("click", async () => {
      const noteContext = getOpenNoteContext();
      if (!noteContext || !noteContext.content) {
        appendAiMessage(
          "assistant",
          "Open a note with content first, then use note suggestions."
        );
        return;
      }

      setAiMode("chat");
      const prompt =
        "Read my current note and give practical suggestions to improve clarity, structure, and next actions.";
      appendAiMessage("user", prompt);
      aiState.history.push({ role: "user", text: prompt });
      aiState.history = aiState.history.slice(-MAX_HISTORY_MESSAGES);
      setAiBusy(true);
      const result = await sendAiMessage(prompt);
      setAiBusy(false);

      const responseText = result?.reply || "No response returned.";
      appendAiMessage("assistant", responseText);
      aiState.history.push({ role: "assistant", text: responseText });
      aiState.history = aiState.history.slice(-MAX_HISTORY_MESSAGES);
    });
  }

  if (toolbarButton) {
    toolbarButton.addEventListener("click", openAiTerminal);
  }
}

export function openAiTerminal() {
  const panel = ensureAiPanel();
  if (!panel) {
    return;
  }

  panel.classList.remove("hidden");
  const input = document.getElementById("chimera-ai-input");
  if (input) {
    input.focus();
  }
}
