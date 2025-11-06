// npm install ws axios express
import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";
import fs from "fs";
import path from "path";
import express from "express";

const PORT = process.env.PORT || 8765;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

const RECORD_DIR = "./recordings";
if (!fs.existsSync(RECORD_DIR)) fs.mkdirSync(RECORD_DIR);

let lastWavFile = null;

//
// === Создание OpenAI Realtime session ===
//
async function createRealtimeSession() {
  const res = await axios.post(
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
  return res.data;
}

//
// === HTTP-сервер для отдачи файлов ===
//
const app = express();
app.use("/recordings", express.static(RECORD_DIR));
app.get("/latest.wav", (req, res) => {
  if (!lastWavFile) return res.status(404).send("No file yet");
  res.sendFile(path.resolve(lastWavFile));
});
const httpServer = app.listen(PORT, () => {
  console.log(`🌐 HTTP ready at http://0.0.0.0:${PORT}`);
});

//
// === WebSocket сервер для ESP ===
//
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", async (esp) => {
  console.log("✅ ESP connected");
  console.log("ESP IP:", esp._socket.remoteAddress);

  const session = await createRealtimeSession();
  const clientSecret = session?.client_secret?.value || session?.client_secret;
  if (!clientSecret) {
    console.error("❌ No client_secret in OpenAI response");
    return esp.close();
  }

  const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17&client_secret=${encodeURIComponent(clientSecret)}`;

  const oa = new WebSocket(wsUrl, {
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let ready = false;
  let audioBuffer = [];
  let flushTimer = null;
  let currentFile = null;
  let writeStream = null;

  const FLUSH_THRESHOLD = 8;
  const FLUSH_INTERVAL = 200;

  //
  // === Отправка аудио в OpenAI ===
  //
  function flushAudioBuffer() {
    if (audioBuffer.length === 0 || oa.readyState !== WebSocket.OPEN || !ready) return;
    const full = Buffer.concat(audioBuffer);
    const base64 = full.toString("base64");

    oa.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: base64,
    }));

    if (writeStream) writeStream.write(full);

    console.log(`📤 Sent batch: ${audioBuffer.length} chunks (${full.length} bytes)`);
    audioBuffer = [];

    clearTimeout(flushTimer);
    flushTimer = null;
  }

  oa.on("open", () => {
    console.log("🔗 Connected to OpenAI Realtime");
    ready = true;
  });

  oa.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === "error") console.error("❌ OpenAI Error:", parsed.error);
      if (parsed.type.startsWith("response.")) esp.send(data.toString());
    } catch (err) {
      console.error("⚠️ Parse error:", err.message);
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

    const text = msg.toString().trim().toUpperCase();
    console.log(`📝 ESP: ${text}`);

    if (text.includes("STREAM STARTED")) {
      const filename = `session_${new Date().toISOString().replace(/[:.]/g, "-")}.raw`;
      const filepath = path.join(RECORD_DIR, filename);
      currentFile = filepath;
      writeStream = fs.createWriteStream(filepath);
      console.log(`🎙 Recording raw audio to: ${filepath}`);
    }

    if (text.includes("STREAM STOPPED")) {
      console.log("🛑 Stream stopped");
      flushAudioBuffer();

      if (writeStream) {
        writeStream.end();
        console.log(`💾 Recording saved: ${currentFile}`);
        lastWavFile = currentFile;
      }

      oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      oa.send(JSON.stringify({
        type: "response.create",
        response: { modalities: ["text"], instructions: "Transcribe this audio." },
      }));
      console.log("📨 Sent commit + response.create");
    }
  });

  esp.on("close", () => {
    console.log("🔌 ESP disconnected");
    oa.close();
    if (writeStream) writeStream.end();
  });
});

console.log(`🚀 Proxy ready at ws://0.0.0.0:${PORT}/ws`);
