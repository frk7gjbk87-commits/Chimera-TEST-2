/* ============================================================
   Chimera Frontend Core
   - Google Identity Services login
   - Backend authentication
   - Cloud note load/save
   - Terminal-style AI console
   ============================================================ */

/* ------------------------------
   GLOBAL STATE
------------------------------ */
export let chimeraUser = null;
export let chimeraToken = null;

/* ------------------------------
   GOOGLE LOGIN → BACKEND AUTH
------------------------------ */
export async function handleGoogleCredential(credential) {
  try {
    const res = await fetch("https://YOUR-BACKEND-URL/auth/google", {
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

    const userInfo = document.getElementById("user-info");
    if (userInfo) {
      userInfo.textContent = `Signed in as ${chimeraUser.name}`;
    }

    await loadNotesFromCloud();
  } catch (err) {
    console.error("Login error", err);
  }
}

/* ------------------------------
   CLOUD NOTE LOADING
------------------------------ */
export async function loadNotesFromCloud() {
  if (!chimeraToken) return;

  const res = await fetch("https://YOUR-BACKEND-URL/notes", {
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

/* ------------------------------
   CLOUD NOTE SAVE
------------------------------ */
export async function saveNoteToCloud(note) {
  if (!chimeraToken) return;

  const res = await fetch("https://YOUR-BACKEND-URL/notes", {
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

/* ============================================================
   TERMINAL-STYLE AI CONSOLE
============================================================ */

/* ------------------------------
   TERMINAL UI SETUP
------------------------------ */
export function initAiTerminal() {
  const html = `
    <div id="ai-terminal" class="floating-terminal hidden">
      <div class="terminal-header">
        <span class="terminal-dot red"></span>
        <span class="terminal-dot yellow"></span>
        <span class="terminal-dot green"></span>
        <span class="terminal-title">Chimera AI Console</span>
        <button id="ai-terminal-close" class="terminal-close">×</button>
      </div>

      <div id="ai-terminal-body" class="terminal-body"></div>

      <div class="terminal-input-row">
        <span class="terminal-prompt">&gt;</span>
        <input id="ai-terminal-input" type="text" placeholder="Ask Chimera AI..." />
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);

  const aiTerminal = document.getElementById("ai-terminal");
  const aiBody = document.getElementById("ai-terminal-body");
  const aiInput = document.getElementById("ai-terminal-input");
  const aiClose = document.getElementById("ai-terminal-close");

  aiClose.addEventListener("click", () => {
    aiTerminal.classList.add("hidden");
  });

  aiInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && aiInput.value.trim()) {
      const text = aiInput.value.trim();
      aiInput.value = "";
      appendTerminalLine("user", text);

      const reply = await sendAiMessage(text);
      appendTerminalLine("ai", reply);
    }
  });

  function appendTerminalLine(type, text) {
    const div = document.createElement("div");
    div.className = `terminal-line ${type}`;
    div.textContent = (type === "user" ? "> " : "< ") + text;
    aiBody.appendChild(div);
    aiBody.scrollTop = aiBody.scrollHeight;
  }
}

/* ------------------------------
   AI MESSAGE HANDLER
------------------------------ */
async function sendAiMessage(message) {
  // Replace with your AI backend later
  return "AI response goes here.";
}

/* ------------------------------
   OPEN TERMINAL PROGRAMMATICALLY
------------------------------ */
export function openAiTerminal() {
  const el = document.getElementById("ai-terminal");
  if (el) {
    el.classList.remove("hidden");
    const input = document.getElementById("ai-terminal-input");
    if (input) input.focus();
  }
}
