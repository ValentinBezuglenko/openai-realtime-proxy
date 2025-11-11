import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OGG_DIR = path.join(__dirname, "public/ogg");
if (!fs.existsSync(OGG_DIR)) fs.mkdirSync(OGG_DIR, { recursive: true });

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.YANDEX_API_KEY;
if (!API_KEY) throw new Error("❌ YANDEX_API_KEY not set");

const AUTH_HEADER = API_KEY.startsWith("Api-Key") ? API_KEY : `Api-Key ${API_KEY}`;
const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public"));

// ======================================================
// 🎧 Страница плеера с кнопкой распознавания
// ======================================================
app.get("/player/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(OGG_DIR, filename);

  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

  res.send(`
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8">
        <title>${filename}</title>
        <style>
          body {
            font-family: sans-serif;
            background: #fafafa;
            color: #222;
            padding: 30px;
          }
          h1 { font-size: 1.2em; }
          audio { display: block; margin-top: 10px; }
          button {
            margin-top: 15px;
            padding: 8px 14px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.95em;
          }
          button:hover { background: #0056b3; }
          #result {
            margin-top: 20px;
            padding: 10px;
            border-radius: 8px;
            background: #e9ecef;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <h1>🎧 ${filename}</h1>
        <audio controls>
          <source src="/file/${filename}" type="audio/ogg">
          Ваш браузер не поддерживает OGG.
        </audio>
        <br>
        <a href="/file/${filename}" download>⬇️ Скачать</a>
        <button id="recognizeBtn">🧠 Распознать</button>

        <div id="result"></div>

        <script>
          const btn = document.getElementById('recognizeBtn');
          const resultDiv = document.getElementById('result');
          btn.addEventListener('click', async () => {
            resultDiv.textContent = '⏳ Отправляем в Yandex STT...';
            btn.disabled = true;
            try {
              const res = await fetch('/recognize/${filename}', { method: 'POST' });
              const text = await res.text();
              resultDiv.textContent = '🗣️ Результат:\\n' + text;
            } catch (e) {
              resultDiv.textContent = '❌ Ошибка: ' + e.message;
            } finally {
              btn.disabled = false;
            }
          });
        </script>
      </body>
    </html>
  `);
});

// ======================================================
// 📡 Получение списка OGG файлов
// ======================================================
app.get("/list", (req, res) => {
  const files = fs.readdirSync(OGG_DIR).filter(f => f.endsWith(".ogg"));
  res.json(files);
});

// ======================================================
// 📥 Отдача конкретного файла
// ======================================================
app.get("/file/:filename", (req, res) => {
  const filePath = path.join(OGG_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.sendFile(filePath);
});

// ======================================================
// 🧠 Отправка файла в Yandex SpeechKit для распознавания
// ======================================================
app.post("/recognize/:filename", async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(OGG_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

  try {
    const oggData = fs.readFileSync(filePath);
    const response = await fetch(STT_URL, {
      method: "POST",
      headers: {
        Authorization: AUTH_HEADER,
        "Content-Type": "audio/ogg; codecs=opus",
      },
      body: oggData,
    });

    const text = await response.text();
    console.log("🗣️ Yandex STT:", text);
    res.send(text);
  } catch (err) {
    console.error("❌ STT error:", err);
    res.status(500).send(err.message);
  }
});

// ======================================================
// 🌐 WebSocket для приёма звука от ESP32
// ======================================================
wss.on("connection", (ws) => {
  console.log("🔗 ESP32 connected");

  const timestamp = Date.now();
  const pcmPath = path.join(OGG_DIR, `stream_${timestamp}.pcm`);
  const oggPath = path.join(OGG_DIR, `stream_${timestamp}.ogg`);
  const pcmStream = fs.createWriteStream(pcmPath);

  ws.on("message", (chunk) => pcmStream.write(chunk));

  ws.on("close", async () => {
    pcmStream.end();
    console.log("📁 Audio stream saved:", pcmPath);

    try {
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -f s16le -ar 16000 -ac 1 -i ${pcmPath} -af "volume=3" -c:a libopus ${oggPath}`,
          (err, stdout, stderr) => {
            if (err) {
              console.error("❌ ffmpeg error:", stderr);
              reject(err);
            } else {
              console.log("✅ Converted to OGG:", oggPath);
              resolve();
            }
          }
        );
      });
    } catch (e) {
      console.error("🔥 Conversion failed:", e);
    }
  });
});

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
