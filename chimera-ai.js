// ────────────────────────────────────────────────
// Chimera AI - Joyful Short Responses
// ────────────────────────────────────────────────

const CHIMERA_API_KEY = ''; // <-- Paste your Groq AI API key here
const CHIMERA_API_URL = 'https://api.groq.ai/v1/generate'; // Example endpoint

// DOM Elements
const userInput = document.getElementById('userInput');
const askButton = document.getElementById('askAI');
const aiResponse = document.getElementById('aiResponse');

/**
 * Send prompt to Chimera AI (Groq) and get short joyful response
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function queryChimeraAI(prompt) {
    if (!CHIMERA_API_KEY) return '🤖 Chimera: API key missing!';
    if (!prompt.trim()) return '🤖 Chimera: Say something for me to answer!';

    try {
        const response = await fetch(CHIMERA_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CHIMERA_API_KEY}`
            },
            body: JSON.stringify({
                prompt: prompt,
                max_tokens: 50,  // short response
                temperature: 0.9 // joyful, creative
            })
        });

        if (!response.ok) {
            console.error('Chimera AI API Error:', response.status, await response.text());
            return '🤖 Chimera: Hmm, I had trouble thinking…';
        }

        const data = await response.json();
        // Adjust this according to Groq AI response format
        return data.text || data.output || '🤖 Chimera: ...thinking!';
    } catch (err) {
        console.error('Chimera AI Fetch Error:', err);
        return '🤖 Chimera: Oops! Something went wrong.';
    }
}

// Button click handler
askButton.addEventListener('click', async () => {
    const prompt = userInput.value;
    aiResponse.textContent = '🤖 Chimera: Thinking...';
    const reply = await queryChimeraAI(prompt);
    aiResponse.textContent = reply;
});

// Optional: send prompt on Enter key
userInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        askButton.click();
    }
});