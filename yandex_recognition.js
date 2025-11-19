import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { io } from "socket.io-client";
import fetch from "node-fetch";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => res.send("✅ Server is alive"));

const server = createServer(app);
const wss = new WebSocketServer({ server });
console.log(`✅ WebSocket proxy запущен на порту ${PORT}`);

// ---------------- Yandex STT ------------------

const API_KEY = process.env.YANDEX_API_KEY;
if (!API_KEY) throw new Error("❌ YANDEX_API_KEY not set");

const AUTH_HEADER = API_KEY.startsWith("Api-Key") ? API_KEY : `Api-Key ${API_KEY}`;
const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";

// ---------------- Emotion keywords ------------

const emotionKeywords = {
  greeting: ["привет", "хай", "здарова", "ёня", "юня"],
  happy: ["супер", "молодец"],
  sad: ["грустно", "печаль"],
  angry: ["злюсь", "сердит", "дурак"],
  laugh: ["ха-ха", "смешно", "смейся"],
  sleep: ["спать", "сон", "спи", "ложись спать"],
  victory: ["победа", "выиграл"],
  idle: []
};

function detectEmotions(text) {
  const recognized = text.toLowerCase();
  const detected = [];

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    if (keywords.some(kw => recognized.includes(kw))) {
      detected.push(emotion);
    }
  }
  return detected;
}

// ---------------- Game phrases ----------------

const gamePhrases = {
  actions: [
    "запусти игру действия",
    "действия открой",
    "запусти действия",
    "открой действия"
  ],
  compare: [
    "запусти игру сравнение",
    "сравнение открой",
    "запусти сравнение",
    "открой сравнение"
  ],
  differences: [
    "запусти игру отличия",
    "отличия открой",
    "запусти отличия",
    "открой отличия"
  ],
  distribution: [
    "запусти игру распределение",
    "распределение открой",
    "запусти распределение",
    "открой распределение"
  ],
  order: [
    "запусти игру очередность",
    "очередность открой",
    "запусти очередность",
    "открой очередность"
  ],
  history: [
    "запусти игру история",
    "история открой",
    "запусти историю",
    "открой историю"
  ]
};

function detectGameCommandByPhrase(text) {
  const lower = text.toLowerCase();

  for (const [game, phrases] of Object.entries(gamePhrases)) {
    if (phrases.some(phrase => lower.includes(phrase))) {
      return game;
    }
  }

  if (lower.includes("запусти игру")) return "default";

  return null;
}

// ----------- Broadcast helper -----------------

function broadcast(json) {
  const message = JSON.stringify(json);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(message);
  });
}

// ----------------- WebSocket audio ------------

wss.on("connection", ws => {
  let pcmChunks = [];

  ws.on("message", async data => {
    if (data.toString() === "/end") {
      if (!pcmChunks.length) return;

      const pcmBuffer = Buffer.concat(pcmChunks);
      pcmChunks = [];

      try {
        // ---- PCM → OGG (in-memory)
        const oggBuffer = await new Promise((resolve, reject) => {
          const ffmpeg = spawn("ffmpeg", [
            "-f", "s16le",
            "-ar", "16000",
            "-ac", "1",
            "-i", "pipe:0",
            "-af", "volume=3",
            "-c:a", "libopus",
            "-f", "ogg",
            "pipe:1"
          ]);

          const chunks = [];
          ffmpeg.stdout.on("data", chunk => chunks.push(chunk));
          ffmpeg.on("close", code =>
            code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("ffmpeg failed"))
          );

          ffmpeg.stdin.write(pcmBuffer);
          ffmpeg.stdin.end();
        });

        // ---- Yandex STT
        const response = await fetch(STT_URL, {
          method: "POST",
          headers: {
            Authorization: AUTH_HEADER,
            "Content-Type": "audio/ogg; codecs=opus"
          },
          body: oggBuffer
        });

        const text = await response.text();
        ws.send(JSON.stringify({ type: "stt_result", text }));

        let recognized = "";
        try {
          const parsed = JSON.parse(text);
          recognized = parsed.result || "";
        } catch {
          recognized = text;
        }

        // ---- Game commands
        const game = detectGameCommandByPhrase(recognized);
        if (game) {
          console.log(`🎮 Команда: запуск игры => ${game}`);
          broadcast({
            type: "run_game_action",
            game
          });
        }

        // ---- Emotions
        detectEmotions(recognized).forEach(emotion => {
          console.log(`🟢 Обнаружена эмоция '${emotion}'`);
          broadcast({ emotion });
        });

      } catch (err) {
        console.error("❌ Ошибка STT:", err);
      }
      return;
    }

    // buffer audio
    if (data instanceof Buffer) pcmChunks.push(data);
  });

  ws.on("close", () => {
    pcmChunks = [];
    console.log("🔌 Client disconnected");
  });
});

// ---------------- backend.enia-kids.ru ---------

const socket = io("ws://backend.enia-kids.ru:8025", { transports: ["websocket"] });

socket.on("connect", () => console.log("🟢 Подключено к backend.enia-kids.ru"));
socket.on("disconnect", () => console.log("🔴 Отключено от backend.enia-kids.ru"));

socket.on("/child/game-level/action", msg => {
  let emotion = null;

  switch (msg.type) {
    case "fail": emotion = "sad"; break;
    case "success": emotion = "happy"; break;
    case "completed": emotion = "victory"; break;
  }

  if (emotion) {
    console.log(`📩 Эмоция от backend: ${emotion}`);
    broadcast({ emotion });
  }
});

server.listen(PORT, () =>
  console.log(`🌐 Server running on port ${PORT}`)
);
