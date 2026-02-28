/* Legacy inline AI bridge (no API key in frontend) */

const backendBaseUrl =
  window.CHIMERA_BACKEND_URL ||
  localStorage.getItem("chimeraBackendUrl") ||
  "http://localhost:4000";

const userInput = document.getElementById("userInput");
const askButton = document.getElementById("askAI");
const aiResponse = document.getElementById("aiResponse");

async function queryChimeraAI(prompt) {
  if (!prompt.trim()) {
    return "Chimera: Ask me something first.";
  }

  try {
    const response = await fetch(`${backendBaseUrl}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt })
    });

    if (!response.ok) {
      return "Chimera: AI service is unavailable.";
    }

    const data = await response.json();
    return data.reply || "Chimera: No response.";
  } catch (error) {
    return "Chimera: Could not reach backend.";
  }
}

if (askButton && userInput && aiResponse) {
  askButton.addEventListener("click", async () => {
    const prompt = userInput.value;
    aiResponse.textContent = "Chimera: Thinking...";
    aiResponse.textContent = await queryChimeraAI(prompt);
  });

  userInput.addEventListener("keypress", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      askButton.click();
    }
  });
}
