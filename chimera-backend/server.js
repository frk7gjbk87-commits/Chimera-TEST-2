import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DB_NAME = process.env.MONGO_DB_NAME || "chimera";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const corsOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins.includes("*") ? true : corsOrigins
  })
);
app.use(express.json());

// Google client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// MongoDB
let db;
async function connectMongo() {
  if (!process.env.MONGO_URI) {
    throw new Error("Missing MONGO_URI in environment");
  }
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  db = mongo.db(DB_NAME);
  await db.collection("notes").createIndex(
    { userId: 1, localId: 1 },
    { unique: true, sparse: true }
  );
  await db.collection("notes").createIndex({ userId: 1, lastModified: -1 });
  console.log(`MongoDB connected (${DB_NAME})`);
}

function ensureDb(req, res, next) {
  if (!db) {
    return res.status(503).json({ error: "Database not ready" });
  }
  next();
}

function normalizeNoteDoc(raw = {}, userId) {
  const updatedAt =
    raw.updatedAt ||
    (raw.lastModified ? new Date(raw.lastModified).toISOString() : new Date().toISOString());
  const lastModified = Number(raw.lastModified) || Date.parse(updatedAt) || Date.now();

  return {
    userId,
    title: String(raw.title || "Untitled Note"),
    content: String(raw.content || ""),
    folder: String(raw.folder || "General"),
    updatedAt,
    lastModified,
    localId: raw.localId ? String(raw.localId) : null,
    links: Array.isArray(raw.links) ? raw.links : []
  };
}

function serializeNoteDoc(doc) {
  return {
    id: doc._id?.toString?.() || "",
    localId: doc.localId || null,
    title: doc.title || "Untitled Note",
    content: doc.content || "",
    folder: doc.folder || "General",
    updatedAt: doc.updatedAt || new Date().toISOString(),
    lastModified: Number(doc.lastModified) || Date.now(),
    links: Array.isArray(doc.links) ? doc.links : []
  };
}

function sanitizeAiReply(text) {
  return String(text || "").replace(/\b(google|gemini)\b/gi, "Chimera Core");
}

function mapHistoryToContents(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-12)
    .map((entry) => {
      const text = String(entry?.text || "").trim();
      if (!text) {
        return null;
      }

      const role = entry?.role === "assistant" ? "model" : "user";
      return { role, parts: [{ text }] };
    })
    .filter(Boolean);
}

async function callGemini({ message, history }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=` +
    `${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

  const contents = mapHistoryToContents(history);
  contents.push({
    role: "user",
    parts: [{ text: message }]
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "You are Chimera AI. Never mention model providers, vendors, or product names. " +
              "If asked about internals, say only: 'I run on Chimera's private intelligence stack.'"
          }
        ]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 700
      },
      contents
    })
  });

  if (!response.ok) {
    const errorBody = (await response.text()).slice(0, 600);
    throw new Error(`AI provider request failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const reply = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => String(part?.text || ""))
    .join("\n")
    .trim();

  if (!reply) {
    throw new Error("AI provider returned an empty reply");
  }

  return sanitizeAiReply(reply);
}

// Verify Google ID token
async function verifyGoogleToken(idToken) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error("Missing GOOGLE_CLIENT_ID in environment");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();

  return {
    userId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture
  };
}

// Middleware: require auth
async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const user = await verifyGoogleToken(token);
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    db: Boolean(db),
    timestamp: new Date().toISOString()
  });
});

// Login route
app.post("/auth/google", ensureDb, async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: "Missing credential" });
  }

  try {
    const user = await verifyGoogleToken(credential);

    // Optional: create user doc if not exists
    await db.collection("users").updateOne(
      { userId: user.userId },
      { $set: user },
      { upsert: true }
    );

    res.json({
      user,
      token: credential
    });
  } catch (err) {
    res.status(401).json({ error: "Invalid credential" });
  }
});

// Get notes
app.get("/notes", ensureDb, auth, async (req, res) => {
  const notes = await db
    .collection("notes")
    .find({ userId: req.user.userId })
    .sort({ lastModified: -1, updatedAt: -1 })
    .toArray();

  res.json(notes.map(serializeNoteDoc));
});

// Save note
app.post("/notes", ensureDb, auth, async (req, res) => {
  const { id } = req.body;
  const note = normalizeNoteDoc(req.body, req.user.userId);

  if (id) {
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: "Invalid note id" });
    }

    await db.collection("notes").updateOne(
      { _id: objectId, userId: req.user.userId },
      { $set: note }
    );
    return res.json({ ok: true, id });
  }

  if (note.localId) {
    const existing = await db.collection("notes").findOne({
      userId: req.user.userId,
      localId: note.localId
    });

    if (existing?._id) {
      await db.collection("notes").updateOne(
        { _id: existing._id, userId: req.user.userId },
        { $set: note }
      );
      return res.json({ ok: true, id: existing._id.toString() });
    }
  }

  const result = await db.collection("notes").insertOne(note);
  res.json({ ok: true, id: result.insertedId.toString() });
});

// Delete note
app.delete("/notes/:id", ensureDb, auth, async (req, res) => {
  const { id } = req.params;

  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    return res.status(400).json({ error: "Invalid note id" });
  }

  await db.collection("notes").deleteOne({
    _id: objectId,
    userId: req.user.userId
  });

  res.json({ ok: true });
});

// Basic AI endpoint for frontend terminal wiring
app.post("/ai/chat", async (req, res) => {
  const message = String(req.body?.message || "").trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  if (!message) {
    return res.status(400).json({ error: "Missing message" });
  }

  try {
    const reply = await callGemini({ message, history });
    res.json({ reply });
  } catch (error) {
    console.error("AI chat failed:", error.message);
    res.status(503).json({ error: "AI service unavailable" });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  try {
    await connectMongo();
    app.listen(PORT, () => {
      console.log(`Chimera backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start backend:", error.message);
    process.exit(1);
  }
}

start();
