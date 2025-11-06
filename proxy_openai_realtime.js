// npm install ws axios express wav
import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import wav from "wav";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8765;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

const app = express();
const RECORD_DIR = path.join(__dirname, "recordings");
if (!fs.existsSync(RECORD_DIR)) fs.mkdirSync(RECORD_DIR);

//
// === 1. Создание Realtime-сессии ===
//
async function createRealtimeSession() {
  const response = await axios.post(
    "https://api.openai.com/v1/realtime/sessions",
    {
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "alloy",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return response.data;
}

//
// === 2. HTTP-сервер для доступа к файлам ===
//
app.get("/recordings/list", (req, res) => {
  const files = fs.readdirSync(RECORD_DIR).filter(f => f.endsWith(".wav"));
  res.json(files);
});

app.get("/recordings/latest.wav", (req, res) => {
  const files = fs.readdirSync(RECORD_DIR)
    .filter(f => f.endsWith(".wav"))
    .sort((a, b) => fs.statSync(path.join(RECORD_DIR, b)).mtimeMs - fs.statSync(path.join(RECORD_DIR, a)).mtimeMs);
  if (!files.length) return res.status(404).send("No recordings yet");
  res.download(path.join(RECORD_DIR, files[0]));
});

app.listen(PORT, () => {
  console.log(`🌐 HTTP endpoint ready at http://localhost:${PORT}`);
});

//
// === 3. WebSocket-прокси ===
//
const wss = new WebSocketServer({ port: PORT + 1, path: "/ws" });
console.log(`🚀 WS proxy on ws://0.0.0.0:${PORT + 1}/ws`);

wss.on("connection", async (esp) => {
  console.log("✅ ESP connected");
  console.log("ESP IP:", esp._socket.remoteAddress);

  const session = await createRealtimeSession();
  const clientSecret = session?.client_secret?.value || session?.client_secret;
  const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17&client_secret=${encodeURIComponent(clientSecret)}`;

  const oa = new WebSocket(wsUrl, {
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let ready = false;
  let audioBuffer = [];
  let currentFile = null;
  let rawStream = null;
  const FLUSH_THRESHOLD = 8;
  const FLUSH_INTERVAL = 200;
  let flushTimer = null;

  function flushAudioBuffer() {
    if (audioBuffer.length === 0 || oa.readyState !== WebSocket.OPEN || !ready) return;

    const full = Buffer.concat(audioBuffer);
    oa.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: full.toString("base64"),
    }));

    if (rawStream) rawStream.write(full);
    console.log(`📤 Sent batch: ${audioBuffer.length} chunks (${full.length} bytes)`);
    audioBuffer = [];
    clearTimeout(flushTimer);
  }

  function convertRawToWav(rawPath, wavPath) {
    return new Promise((resolve, reject) => {
      const reader = fs.createReadStream(rawPath);
      const writer = new wav.FileWriter(wavPath, {
        channels: 1,
        sampleRate: 24000,
        bitDepth: 16,
      });
      reader.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  oa.on("open", () => {
    console.log("🔗 Connected to OpenAI Realtime");
    ready = true;
  });

  oa.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "response.audio_transcript.delta") {
        console.log("🗣", msg.delta);
      }
      if (msg.type === "response.audio_transcript.done") {
        console.log("💬 Full transcript:", msg.transcript);
      }
      if (msg.type === "error") {
        console.error("❌ OpenAI Error:", msg.error);
      }
    } catch (e) {
      console.error("⚠️ Parse error:", e.message);
    }
  });

  esp.on("message", async (msg) => {
    if (Buffer.isBuffer(msg)) {
      if (!ready) return;
      audioBuffer.push(msg);
      if (audioBuffer.length >= FLUSH_THRESHOLD) {
        flushAudioBuffer();
      } else {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flushAudioBuffer, FLUSH_INTERVAL);
      }
      return;
    }

    const text = msg.toString().trim();

    if (text.includes("STREAM STARTED")) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const rawPath = path.join(RECORD_DIR, `session_${ts}.raw`);
      currentFile = rawPath;
      rawStream = fs.createWriteStream(rawPath);
      console.log(`🎙 Recording raw audio to: ${rawPath}`);
    }

    if (text.includes("STREAM STOPPED")) {
      console.log("🛑 Stopping stream — committing + converting...");
      flushAudioBuffer();

      setTimeout(async () => {
        oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        oa.send(JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"] },
        }));

        if (rawStream) rawStream.end();
        if (currentFile) {
          const wavPath = currentFile.replace(".raw", ".wav");
          await convertRawToWav(currentFile, wavPath);
          console.log(`🎧 Saved and converted to: ${wavPath}`);
        }
      }, 400);
    }
  });

  esp.on("close", () => {
    console.log("🔌 ESP disconnected");
    oa.close();
  });
});
