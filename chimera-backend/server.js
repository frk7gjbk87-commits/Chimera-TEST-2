import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import { MongoClient, ObjectId } from "mongodb";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Google client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// MongoDB
let db;
(async () => {
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  db = mongo.db("chimera");
  console.log("MongoDB connected");
})();

// Verify Google ID token
async function verifyGoogleToken(idToken) {
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

// Login route
app.post("/auth/google", async (req, res) => {
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
app.get("/notes", auth, async (req, res) => {
  const notes = await db
    .collection("notes")
    .find({ userId: req.user.userId })
    .toArray();

  res.json(notes);
});

// Save note
app.post("/notes", auth, async (req, res) => {
  const { id, title, content, updatedAt } = req.body;

  const note = {
    userId: req.user.userId,
    title,
    content,
    updatedAt: updatedAt || new Date().toISOString()
  };

  if (id) {
    await db.collection("notes").updateOne(
      { _id: new ObjectId(id), userId: req.user.userId },
      { $set: note }
    );
    return res.json({ ok: true, id });
  }

  const result = await db.collection("notes").insertOne(note);
  res.json({ ok: true, id: result.insertedId.toString() });
});

// Delete note
app.delete("/notes/:id", auth, async (req, res) => {
  const { id } = req.params;

  await db.collection("notes").deleteOne({
    _id: new ObjectId(id),
    userId: req.user.userId
  });

  res.json({ ok: true });
});

app.listen(process.env.PORT, () =>
  console.log(`Chimera backend running on port ${process.env.PORT}`)
);