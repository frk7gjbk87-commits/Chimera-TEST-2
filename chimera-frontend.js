/* ============================================================
   Chimera Frontend Core
   - Google Identity Services login
   - Backend authentication
   - Cloud note load/save
   - Large draggable/resizable AI panel
   ============================================================ */

export let chimeraUser = null;
export let chimeraToken = null;

const backendBaseUrl =
  window.CHIMERA_BACKEND_URL ||
  localStorage.getItem("chimeraBackendUrl") ||
  "http://localhost:4000";

const MAX_HISTORY_MESSAGES = 12;
const aiState = {
  initialized: false,
  history: []
};

function getJsonHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (chimeraToken) {
    headers.Authorization = `Bearer ${chimeraToken}`;
  }
  return headers;
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
    send.textContent = isBusy ? "Thinking..." : "Send";
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
  try {
    const response = await fetch(`${backendBaseUrl}/ai/chat`, {
      method: "POST",
      headers: getJsonHeaders(),
      body: JSON.stringify({
        message,
        history: aiState.history
      })
    });

    if (!response.ok) {
      return "AI endpoint is unavailable right now.";
    }

    const data = await response.json();
    return data.reply || "No response returned.";
  } catch (error) {
    return "Could not reach the backend.";
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
  const reply = await sendAiMessage(text);
  setAiBusy(false);

  appendAiMessage("assistant", reply);
  aiState.history.push({ role: "assistant", text: reply });
  aiState.history = aiState.history.slice(-MAX_HISTORY_MESSAGES);
}

export async function handleGoogleCredential(credential) {
  try {
    const res = await fetch(`${backendBaseUrl}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential })
    });

    if (!res.ok) {
      console.error("Auth failed");
      return;
    }

    const data = await res.json();
    chimeraUser = data.user;
    chimeraToken = data.token;
    localStorage.setItem("chimeraUser", JSON.stringify(chimeraUser));

    const userInfo = document.getElementById("user-info");
    if (userInfo) {
      userInfo.textContent = `Signed in as ${chimeraUser.name}`;
    }

    const startPage = document.getElementById("start-page");
    const appContainer = document.getElementById("app-container");
    if (startPage && appContainer) {
      startPage.style.display = "none";
      appContainer.style.display = "grid";
    }

    await loadNotesFromCloud();
  } catch (err) {
    console.error("Login error", err);
  }
}

export async function loadNotesFromCloud() {
  if (!chimeraToken) {
    return;
  }

  const res = await fetch(`${backendBaseUrl}/notes`, {
    headers: { Authorization: `Bearer ${chimeraToken}` }
  });

  if (!res.ok) {
    console.error("Failed to load notes");
    return;
  }

  const notes = await res.json();
  if (window.renderNotesList) {
    window.renderNotesList(notes);
  }
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

  const data = await res.json();
  return data.id;
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
  const toolbarButton = document.getElementById("btn-open-ai");

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
