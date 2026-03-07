import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DB_NAME = process.env.MONGO_DB_NAME || "chimera";
const MONGO_SERVER_SELECTION_TIMEOUT_MS = Math.max(
  2000,
  Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000)
);
const MONGO_CONNECT_TIMEOUT_MS = Math.max(
  2000,
  Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000)
);
const MONGO_SOCKET_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 20000)
);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash"
];
const GEMINI_API_VERSIONS = ["v1beta", "v1"];
const GEMINI_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const DEEP_SEARCH_TARGET_SOURCES = Math.max(
  10,
  Number(process.env.DEEP_SEARCH_TARGET_SOURCES || 50)
);
const DEEP_SEARCH_MAX_PASSES = Math.max(
  2,
  Number(process.env.DEEP_SEARCH_MAX_PASSES || 8)
);
const DEFAULT_FREE_MAX_NOTES = 200;
const DEFAULT_FREE_MAX_CHARS_PER_NOTE = 20000;
const DEFAULT_FREE_MAX_STORAGE_BYTES = 2 * 1024 * 1024;
const FREE_MAX_NOTES = Math.max(
  1,
  Number(process.env.FREE_MAX_NOTES || DEFAULT_FREE_MAX_NOTES)
);
const FREE_MAX_CHARS_PER_NOTE = Math.max(
  1,
  Number(process.env.FREE_MAX_CHARS_PER_NOTE || DEFAULT_FREE_MAX_CHARS_PER_NOTE)
);
const FREE_MAX_STORAGE_BYTES = Math.max(
  1024,
  Number(process.env.FREE_MAX_STORAGE_BYTES || DEFAULT_FREE_MAX_STORAGE_BYTES)
);
const PRO_INVITE_CODE = String(process.env.PRO_INVITE_CODE || "").trim();
const PRO_SUPPORT_EMAIL = String(
  process.env.PRO_SUPPORT_EMAIL || "aaravkedeveloper@gmail.com"
).trim();
const corsOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

let cachedGeminiModels = [];
let geminiModelsCachedAt = 0;

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
let mongoLastError = null;
async function connectMongo() {
  if (!process.env.MONGO_URI) {
    throw new Error("Missing MONGO_URI in environment");
  }
  if (db) {
    return;
  }
  const mongo = new MongoClient(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
    socketTimeoutMS: MONGO_SOCKET_TIMEOUT_MS
  });
  await mongo.connect();
  db = mongo.db(DB_NAME);
  await db.collection("notes").createIndex(
    { userId: 1, localId: 1 },
    { unique: true, sparse: true }
  );
  await db.collection("notes").createIndex({ userId: 1, lastModified: -1 });
  mongoLastError = null;
  console.log(`MongoDB connected (${DB_NAME})`);
}

function ensureDb(req, res, next) {
  if (!db) {
    return res.status(503).json({
      error: "Database not ready",
      details: mongoLastError || "Mongo connection has not been established yet"
    });
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

function normalizePlan(plan) {
  return String(plan || "").toLowerCase() === "pro" ? "pro" : "free";
}

function getPlanLimits(plan) {
  if (normalizePlan(plan) === "pro") {
    return {
      maxNotes: null,
      maxCharsPerNote: null,
      maxStorageBytes: null
    };
  }

  return {
    maxNotes: FREE_MAX_NOTES,
    maxCharsPerNote: FREE_MAX_CHARS_PER_NOTE,
    maxStorageBytes: FREE_MAX_STORAGE_BYTES
  };
}

function countNoteChars(note) {
  return String(note?.content || "").length;
}

function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase();
}

function estimateNoteBytes(note) {
  const links = Array.isArray(note?.links) ? note.links : [];
  return Buffer.byteLength(
    JSON.stringify({
      title: String(note?.title || ""),
      content: String(note?.content || ""),
      folder: String(note?.folder || ""),
      updatedAt: String(note?.updatedAt || ""),
      lastModified: Number(note?.lastModified || 0),
      localId: String(note?.localId || ""),
      links
    }),
    "utf8"
  );
}

function makeLimitErrorResponse({
  plan,
  error,
  errorCode,
  limitType,
  limits,
  usage
}) {
  return {
    error,
    errorCode,
    limitType,
    requiresPro: normalizePlan(plan) !== "pro",
    plan: normalizePlan(plan),
    limits,
    usage
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

function removeSourceDetails(text) {
  return String(text || "")
    .replace(/\n{0,2}(#+\s*)?sources?[\s\S]*$/i, "")
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .trim();
}

function normalizeAiMode(mode) {
  return String(mode || "").toLowerCase() === "deep-search"
    ? "deep-search"
    : "chat";
}

function sanitizeNoteContext(noteContext) {
  if (!noteContext || typeof noteContext !== "object") {
    return null;
  }

  const title = String(noteContext.title || "").trim().slice(0, 160);
  const folder = String(noteContext.folder || "").trim().slice(0, 120);
  const content = String(noteContext.content || "").trim().slice(0, 9000);

  if (!title && !content) {
    return null;
  }

  return {
    title: title || "Untitled Note",
    folder: folder || "General",
    content
  };
}

function buildNoteContextBlock(noteContext) {
  const safeContext = sanitizeNoteContext(noteContext);
  if (!safeContext) {
    return "";
  }

  return (
    "Open note context (use this for grounded suggestions):\n" +
    `Title: ${safeContext.title}\n` +
    `Folder: ${safeContext.folder}\n` +
    `Content:\n${safeContext.content || "(empty)"}\n`
  );
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

function normalizeModelName(model) {
  const value = String(model || "").trim();
  if (!value) {
    return "";
  }
  return value.startsWith("models/") ? value.slice("models/".length) : value;
}

function rankGeminiModel(model) {
  const name = normalizeModelName(model).toLowerCase();
  let score = 0;
  if (name.includes("flash")) score += 10;
  if (name.includes("2.5")) score += 5;
  if (name.includes("2.0")) score += 4;
  if (name.includes("lite")) score -= 2;
  return score;
}

function cleanUrl(url) {
  const value = String(url || "").trim();
  if (!value || !/^https?:\/\//i.test(value)) {
    return "";
  }
  return value.replace(/[)\].,;!?]+$/g, "");
}

function collectUrlsDeep(node, bucket) {
  if (!node) {
    return;
  }

  if (typeof node === "string") {
    const cleaned = cleanUrl(node);
    if (cleaned) {
      bucket.add(cleaned);
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectUrlsDeep(item, bucket));
    return;
  }

  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (
        (key.toLowerCase() === "url" || key.toLowerCase() === "uri") &&
        typeof value === "string"
      ) {
        const cleaned = cleanUrl(value);
        if (cleaned) {
          bucket.add(cleaned);
        }
      }
      collectUrlsDeep(value, bucket);
    }
  }
}

function extractUrlsFromText(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s)]+/gi) || [];
  const urls = new Set();
  matches.forEach((item) => {
    const cleaned = cleanUrl(item);
    if (cleaned) {
      urls.add(cleaned);
    }
  });
  return Array.from(urls);
}

function extractGeminiSources(data, fallbackReply = "") {
  const urls = new Set();
  collectUrlsDeep(data, urls);
  extractUrlsFromText(fallbackReply).forEach((url) => urls.add(url));
  return Array.from(urls);
}

async function fetchAvailableGeminiModels(apiKey) {
  const now = Date.now();
  if (
    cachedGeminiModels.length > 0 &&
    now - geminiModelsCachedAt < GEMINI_MODEL_CACHE_TTL_MS
  ) {
    return cachedGeminiModels;
  }

  for (const apiVersion of GEMINI_API_VERSIONS) {
    const listUrl =
      `https://generativelanguage.googleapis.com/${apiVersion}/models?key=` +
      `${encodeURIComponent(apiKey)}`;
    try {
      const response = await fetch(listUrl);
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const available = (data?.models || [])
        .filter((model) =>
          Array.isArray(model?.supportedGenerationMethods) &&
          model.supportedGenerationMethods.includes("generateContent")
        )
        .map((model) => normalizeModelName(model?.name))
        .filter((model) => model && model.includes("gemini"));

      if (available.length > 0) {
        cachedGeminiModels = Array.from(new Set(available));
        geminiModelsCachedAt = now;
        return cachedGeminiModels;
      }
    } catch {
      // Ignore list-model errors and continue to next API version.
    }
  }

  return cachedGeminiModels;
}

async function resolveGeminiModels() {
  const configuredModels = Array.from(
    new Set(
      [GEMINI_MODEL, ...GEMINI_MODEL_FALLBACKS]
        .map((model) => normalizeModelName(model))
        .filter(Boolean)
    )
  );
  const discoveredModels = await fetchAvailableGeminiModels(
    process.env.GEMINI_API_KEY
  );
  return Array.from(new Set([...configuredModels, ...discoveredModels]))
    .sort((a, b) => rankGeminiModel(b) - rankGeminiModel(a))
    .slice(0, 10);
}

function buildToolVariants(useSearchTool) {
  if (!useSearchTool) {
    return [null];
  }
  return [
    [{ google_search: {} }],
    [{ google_search_retrieval: {} }],
    null
  ];
}

function getReplyTextFromGeminiData(data) {
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => String(part?.text || ""))
    .join("\n")
    .trim();
}

async function generateWithGemini({
  systemText,
  contents,
  generationConfig = {},
  useSearchTool = false
}) {
  const models = await resolveGeminiModels();
  const toolVariants = buildToolVariants(useSearchTool);
  let lastError;

  for (const model of models) {
    for (const apiVersion of GEMINI_API_VERSIONS) {
      for (const tools of toolVariants) {
        try {
          const url =
            `https://generativelanguage.googleapis.com/${apiVersion}/models/` +
            `${encodeURIComponent(model)}:generateContent?key=` +
            `${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

          const payload = {
            systemInstruction: {
              parts: [{ text: systemText }]
            },
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 700,
              ...generationConfig
            },
            contents
          };

          if (Array.isArray(tools) && tools.length > 0) {
            payload.tools = tools;
          }

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errorBody = (await response.text()).slice(0, 500);
            throw new Error(
              `Model ${model} @ ${apiVersion} failed (${response.status}): ${errorBody}`
            );
          }

          const data = await response.json();
          const reply = getReplyTextFromGeminiData(data);
          if (!reply) {
            throw new Error(
              `Model ${model} @ ${apiVersion} returned empty output`
            );
          }

          const sources = extractGeminiSources(data, reply);
          return {
            reply: sanitizeAiReply(reply),
            sources,
            model,
            apiVersion
          };
        } catch (error) {
          lastError = error;
          console.error(
            `AI model attempt failed (${model} @ ${apiVersion}):`,
            error.message
          );
        }
      }
    }
  }

  throw lastError || new Error("No AI model could produce a reply");
}

async function runDeepSearch({ message, history, noteContext }) {
  const sourcePool = new Set();
  const researchChunks = [];
  const noteBlock = buildNoteContextBlock(noteContext);
  const hasNoteContext = Boolean(noteContext);
  const researchAngles = [
    "Overview and key definitions",
    "Recent updates and latest developments",
    "Data, stats, and factual numbers",
    "Expert opinions and analysis",
    "How-to guidance and practical implementation",
    "Risks, caveats, and opposing viewpoints",
    "Case studies and real examples",
    "Tools, products, and alternatives landscape"
  ];
  const passCount = Math.min(DEEP_SEARCH_MAX_PASSES, researchAngles.length);

  for (let index = 0; index < passCount; index += 1) {
    const angle = researchAngles[index];
    const passPrompt =
      `Research request: ${message}\n` +
      `Research angle ${index + 1}/${passCount}: ${angle}\n\n` +
      "Deep search instructions:\n" +
      "- Search broadly across the web for this angle.\n" +
      "- Read and compare many sources before answering.\n" +
      "- Return concise findings only.\n" +
      "- Do not include URLs or source lists in your written answer.\n\n" +
      (noteBlock ? `${noteBlock}\n` : "");

    const contents = mapHistoryToContents(history).slice(-4);
    contents.push({
      role: "user",
      parts: [{ text: passPrompt }]
    });

    const pass = await generateWithGemini({
      systemText:
        "You are Chimera AI in Deep Search mode. Research thoroughly, compare sources, and be concise. " +
        (hasNoteContext
          ? "An open note context is attached by the app and is directly readable by you. " +
            "Never claim you cannot see the user's screen, files, or note when this context exists. "
          : "") +
        "Never mention model providers, vendors, or product names. " +
        "If asked about internals, say only: 'I run on Chimera's private intelligence stack.'",
      contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 900
      },
      useSearchTool: true
    });

    researchChunks.push(
      `Pass ${index + 1} - ${angle}\n${pass.reply}`.slice(0, 3800)
    );
    pass.sources.forEach((url) => sourcePool.add(url));

    if (sourcePool.size >= DEEP_SEARCH_TARGET_SOURCES) {
      break;
    }
  }

  const sources = Array.from(sourcePool);
  const sourceListForPrompt = sources
    .slice(0, 120)
    .map((url, idx) => `${idx + 1}. ${url}`)
    .join("\n");
  const finalPrompt =
    `User question: ${message}\n\n` +
    (noteBlock ? `${noteBlock}\n` : "") +
    `Research passes:\n${researchChunks.join("\n\n")}\n\n` +
    `Source pool (${sources.length} links):\n${sourceListForPrompt}\n\n` +
    "Now generate:\n" +
    "1) Quick answer (short)\n" +
    "2) Deep summary (clear sections)\n" +
    "3) Action steps\n" +
    "Use plain language and keep it practical.\n" +
    "Important: do not include source names, source sections, or URLs in your output.";

  const finalResult = await generateWithGemini({
    systemText:
      "You are Chimera AI. Friendly, clear, practical. " +
      (hasNoteContext
        ? "An open note context is attached by the app and is directly readable by you. " +
          "Never claim you cannot access the user's note, files, or screen context. "
        : "") +
      "Never mention model providers, vendors, or product names. " +
      "If asked about internals, say only: 'I run on Chimera's private intelligence stack.'",
    contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1500
    },
    useSearchTool: false
  });

  return {
    reply: removeSourceDetails(finalResult.reply),
    sources
  };
}

async function callGemini({ message, history, mode, noteContext }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const normalizedMode = normalizeAiMode(mode);
  const safeNoteContext = sanitizeNoteContext(noteContext);

  if (normalizedMode === "deep-search") {
    return runDeepSearch({
      message,
      history,
      noteContext: safeNoteContext
    });
  }

  const noteBlock = buildNoteContextBlock(safeNoteContext);
  const contents = mapHistoryToContents(history);
  contents.push({
    role: "user",
    parts: [
      {
        text:
          `${message}\n\n` +
          (noteBlock
            ? "Important: The following open note context is provided directly by the app and is available to you now. " +
              "Do not say you cannot access it.\n\n" +
              `${noteBlock}\nUse the note context to suggest improvements when relevant.`
            : "")
      }
    ]
  });

  const result = await generateWithGemini({
    systemText:
      "You are Chimera AI. Friendly and practical. " +
      (safeNoteContext
        ? "An open note context is attached by the app and is directly readable by you. " +
          "Never claim you cannot see the note or that the user must paste it again. "
        : "") +
      "Never mention model providers, vendors, or product names. " +
      "If asked about internals, say only: 'I run on Chimera's private intelligence stack.'",
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 900
    },
    useSearchTool: false
  });

  return {
    reply: result.reply,
    sources: []
  };
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
    let plan = "free";
    if (db) {
      const account = await db.collection("users").findOne(
        { userId: user.userId },
        { projection: { plan: 1 } }
      );
      plan = normalizePlan(account?.plan);
    }
    req.user = { ...user, plan };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    db: Boolean(db),
    dbError: mongoLastError,
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
    const nowIso = new Date().toISOString();

    // Optional: create user doc if not exists
    await db.collection("users").updateOne(
      { userId: user.userId },
      {
        $set: {
          ...user,
          lastLoginAt: nowIso
        },
        $setOnInsert: {
          createdAt: nowIso,
          plan: "free"
        }
      },
      { upsert: true }
    );

    const account = await db.collection("users").findOne(
      { userId: user.userId },
      { projection: { plan: 1 } }
    );
    const plan = normalizePlan(account?.plan);
    const limits = getPlanLimits(plan);

    res.json({
      user: { ...user, plan },
      token: credential,
      plan,
      limits,
      supportEmail: PRO_SUPPORT_EMAIL
    });
  } catch (err) {
    res.status(401).json({ error: "Invalid credential" });
  }
});

app.get("/billing/status", ensureDb, auth, async (req, res) => {
  const plan = normalizePlan(req.user.plan);
  res.json({
    plan,
    limits: getPlanLimits(plan),
    supportEmail: PRO_SUPPORT_EMAIL
  });
});

app.post("/billing/upgrade", ensureDb, auth, async (req, res) => {
  const submittedCode = normalizeInviteCode(req.body?.code);
  const expectedCode = normalizeInviteCode(PRO_INVITE_CODE);

  if (!expectedCode) {
    return res.status(503).json({
      error: "Invite code redemption is not configured on the server yet."
    });
  }

  if (!submittedCode) {
    return res.status(400).json({
      error: "Missing invite code."
    });
  }

  if (submittedCode !== expectedCode) {
    return res.status(403).json({
      error: `Invalid code. Email ${PRO_SUPPORT_EMAIL} to request access.`
    });
  }

  const nowIso = new Date().toISOString();
  await db.collection("users").updateOne(
    { userId: req.user.userId },
    {
      $set: {
        plan: "pro",
        proActivatedAt: nowIso
      },
      $setOnInsert: {
        createdAt: nowIso
      }
    },
    { upsert: true }
  );

  res.json({
    ok: true,
    plan: "pro",
    limits: getPlanLimits("pro"),
    supportEmail: PRO_SUPPORT_EMAIL
  });
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
  const plan = normalizePlan(req.user.plan);
  const limits = getPlanLimits(plan);

  if (plan !== "pro") {
    const charsInNote = countNoteChars(note);
    if (charsInNote > limits.maxCharsPerNote) {
      return res.status(403).json(
        makeLimitErrorResponse({
          plan,
          error: "Oh No! You are out of words on this note.",
          errorCode: "NOTE_CHAR_LIMIT_EXCEEDED",
          limitType: "note_chars",
          limits,
          usage: {
            charsInNote
          }
        })
      );
    }
  }

  const existingById =
    id && ObjectId.isValid(id)
      ? await db.collection("notes").findOne({
          _id: new ObjectId(id),
          userId: req.user.userId
        })
      : null;

  const existingByLocalId =
    !existingById && note.localId
      ? await db.collection("notes").findOne({
          userId: req.user.userId,
          localId: note.localId
        })
      : null;

  const existingTarget = existingById || existingByLocalId;

  if (id) {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid note id" });
    }
    if (!existingTarget) {
      return res.status(404).json({ error: "Note not found" });
    }
  }

  if (plan !== "pro") {
    const notes = await db
      .collection("notes")
      .find({ userId: req.user.userId })
      .project({
        title: 1,
        content: 1,
        folder: 1,
        updatedAt: 1,
        lastModified: 1,
        localId: 1,
        links: 1
      })
      .toArray();

    const currentCount = notes.length;
    const noteCountAfter = existingTarget ? currentCount : currentCount + 1;
    const currentBytes = notes.reduce(
      (sum, item) => sum + estimateNoteBytes(item),
      0
    );
    const oldBytes = existingTarget ? estimateNoteBytes(existingTarget) : 0;
    const newBytes = estimateNoteBytes(note);
    const storageBytesAfter = currentBytes - oldBytes + newBytes;

    if (noteCountAfter > limits.maxNotes) {
      return res.status(403).json(
        makeLimitErrorResponse({
          plan,
          error: "Oh No! You are out of notes.",
          errorCode: "NOTE_COUNT_LIMIT_EXCEEDED",
          limitType: "notes",
          limits,
          usage: {
            noteCount: noteCountAfter
          }
        })
      );
    }

    if (storageBytesAfter > limits.maxStorageBytes) {
      return res.status(403).json(
        makeLimitErrorResponse({
          plan,
          error: "Oh No! You have exceeded all of your storage.",
          errorCode: "STORAGE_LIMIT_EXCEEDED",
          limitType: "storage",
          limits,
          usage: {
            storageBytes: storageBytesAfter
          }
        })
      );
    }
  }

  if (existingTarget?._id) {
    await db.collection("notes").updateOne(
      { _id: existingTarget._id, userId: req.user.userId },
      { $set: note }
    );
    return res.json({
      ok: true,
      id: existingTarget._id.toString(),
      plan,
      limits
    });
  }

  const result = await db.collection("notes").insertOne(note);
  res.json({
    ok: true,
    id: result.insertedId.toString(),
    plan,
    limits
  });
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
  const mode = normalizeAiMode(req.body?.mode);
  const noteContext = sanitizeNoteContext(req.body?.noteContext);

  if (!message) {
    return res.status(400).json({ error: "Missing message" });
  }

  try {
    const result = await callGemini({ message, history, mode, noteContext });
    res.json({
      reply: result?.reply || "",
      mode,
      sources: []
    });
  } catch (error) {
    console.error("AI chat failed:", error.message);
    res.status(503).json({
      error:
        "AI service unavailable. Check GEMINI_API_KEY/model in backend env and Render logs."
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

let reconnectTimer = null;
async function connectMongoWithRetry() {
  try {
    await connectMongo();
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  } catch (error) {
    mongoLastError = error.message;
    console.error("MongoDB connection failed:", error.message);
    if (!reconnectTimer) {
      reconnectTimer = setInterval(async () => {
        try {
          await connectMongo();
          console.log("MongoDB reconnected");
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        } catch (retryError) {
          mongoLastError = retryError.message;
          console.error("MongoDB reconnect attempt failed:", retryError.message);
        }
      }, 10000);
    }
  }
}

function start() {
  app.listen(PORT, () => {
    console.log(`Chimera backend running on port ${PORT}`);
  });
  connectMongoWithRetry().catch((error) => {
    mongoLastError = error?.message || String(error);
    console.error("Initial MongoDB connection boot failed:", mongoLastError);
  });
}

start();
