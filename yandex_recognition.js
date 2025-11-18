import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import http from "http";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ==========================
// 🔐 Yandex STT настройки
// ==========================
const API_KEY = process.env.YANDEX_API_KEY;
if (!API_KEY) throw new Error("❌ YANDEX_API_KEY not set");

const AUTH_HEADER = API_KEY.startsWith("Api-Key") ? API_KEY : `Api-Key ${API_KEY}`;
const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";

// ==========================
// 📁 Директория OGG
// ==========================
const OGG_DIR = path.join(__dirname, "public/ogg");
if (!fs.existsSync(OGG_DIR)) fs.mkdirSync(OGG_DIR, { recursive: true });

// ==========================
// ⚙️ Хелпер: безопасная отправка WS
// ==========================
function sendWsSafe(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(msg)); }
    catch (err) { console.error("❌ WS send error:", err); }
  }
}

// ==========================
// 🎧 Конвертация PCM → OGG
// ==========================
function convertPcmToOgg(pcmPath, oggPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -f s16le -ar 16000 -ac 1 -i "${pcmPath}" -af "volume=3" -c:a libopus "${oggPath}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) { console.error("❌ ffmpeg error:", stderr); return reject(err); }
      if (!fs.existsSync(oggPath)) return reject(new Error("OGG file not created"));
      resolve();
    });
  });
}

// ==========================
// 🧠 Отправка OGG в Yandex STT
// ==========================
async function sendToYandexSTT(oggPath) {
  try {
    const oggData = fs.readFileSync(oggPath);
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: {
        "Authorization": AUTH_HEADER,
        "Content-Type": "audio/ogg; codecs=opus",
      },
      body: oggData,
    });
    return await res.text();
  } catch (err) {
    console.error("❌ STT request failed:", err);
    return "ERROR: STT request failed";
  }
}

// ==========================
// 🔌 WebSocket обработчик
// ==========================
wss.on("connection", (ws) => {
  // Уникальный идентификатор для каждого потока
  const uniqueId = Date.now() + "_" + Math.floor(Math.random() * 10000);
  const pcmPath = path.join(OGG_DIR, `stream_${uniqueId}.pcm`);
  const oggPath = path.join(OGG_DIR, `stream_${uniqueId}.ogg`);

  let totalBytes = 0;
  const pcmStream = fs.createWriteStream(pcmPath);

  console.log(`🎙 Client connected, stream ID: ${uniqueId}`);

  ws.on("message", async (data) => {
    if (typeof data === "string" && data === "/end") {
      pcmStream.end();
      console.log(`⏹ Stream ended (${totalBytes} bytes) ID: ${uniqueId}`);

      try {
        // Конвертация PCM → OGG
        await convertPcmToOgg(pcmPath, oggPath);
        console.log(`🎵 OGG ready: stream_${uniqueId}.ogg`);

        // Распознавание речи
        const text = await sendToYandexSTT(oggPath);
        console.log(`🗣 STT result [${uniqueId}]:`, text);

        // Отправляем результат обратно клиенту
        sendWsSafe(ws, {
          type: "stt_result",
          text,
          filename: `stream_${uniqueId}.ogg`,
        });

      } catch (err) {
        console.error("🔥 Processing error:", err);
        sendWsSafe(ws, { type: "error", message: err.message });
      }

      return;
    }

    // Получение бинарного аудио
    if (data instanceof Buffer) {
      totalBytes += data.length;
      pcmStream.write(data);
    }
  });

  ws.on("close", () => {
    try { pcmStream.end(); } catch {}
    console.log(`🔌 Client disconnected, stream ID: ${uniqueId}`);
  });
});

// ==========================
// 🎧 HTML-плеер для теста
// ==========================
app.get("/player/:filename", (req, res) => {
  const file = path.join(OGG_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).send("Not found");

  res.send(`
    <html>
      <body>
        <h1>${req.params.filename}</h1>
        <audio controls autoplay>
          <source src="/file/${req.params.filename}" type="audio/ogg">
        </audio>
      </body>
    </html>
  `);
});

app.use("/file", express.static(OGG_DIR));

server.listen(process.env.PORT || 8080, () =>
  console.log("🚀 Server started on port", process.env.PORT || 8080)
);
