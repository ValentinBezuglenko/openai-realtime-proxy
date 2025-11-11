import fs from "fs";
import https from "https";
import { WebSocketServer } from "ws";

// ---------- SSL для wss:// ----------
// На Render обычно есть SSL автоматом, поэтому можно не указывать сертификаты
// Если хочешь локально, надо добавить ключи
const server = https.createServer(); // пустой https сервер
const wss = new WebSocketServer({ server, path: "/ws" }); // путь совпадает с ESP32

const streams = new Map();

wss.on("connection", (ws, req) => {
  const timestamp = Date.now();
  const filename = `stream_${timestamp}.pcm`;
  const file = fs.createWriteStream(filename);
  let totalBytes = 0;

  console.log(`🎙 Client connected: ${req.socket.remoteAddress}`);

  ws.on("message", (data) => {
    if (typeof data === "string") {
      if (data === "/end") {
        file.end();
        console.log(`⏹ Stream ended: ${filename} (total bytes: ${totalBytes})`);
        ws.send("STREAM RECEIVED");
        streams.delete(ws);
      } else {
        console.log(`[WS TXT] ${data}`);
      }
      return;
    }

    if (data instanceof Buffer) {
      file.write(data);
      totalBytes += data.length;
      console.log(`⬇️ Chunk received: ${data.length} bytes (total: ${totalBytes})`);
    }
  });

  ws.on("close", () => {
    if (!file.closed) file.end();
    console.log("❌ Client disconnected");
    streams.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });

  streams.set(ws, { file, totalBytes });
});

// ---------- Запуск сервера ----------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🌐 WebSocket wss:// server running on port ${PORT}`);
  console.log("📌 Path: /ws");
});
