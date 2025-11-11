import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";

const PORT = process.env.PORT || 10000; // порт WebSocket
const PATH = "/stream";                 // путь, совпадает с ESP32

const wss = new WebSocketServer({ port: PORT, path: PATH });

console.log(`🌐 WebSocket server running on ws://localhost:${PORT}${PATH}`);

wss.on("connection", ws => {
  const timestamp = Date.now();
  const filename = `stream_${timestamp}.pcm`;
  const file = fs.createWriteStream(filename);
  let totalBytes = 0;

  console.log("🎙 Client connected");

  ws.on("message", data => {
    if (data.toString() === "/end") {
      file.end();
      console.log(`⏹ Stream ended: ${filename} (total bytes: ${totalBytes})`);
      return;
    }

    if (data instanceof Buffer) {
      file.write(data);
      totalBytes += data.length;
      console.log(`⬇️ Chunk received: ${data.length} bytes (total: ${totalBytes})`);
    }
  });

  ws.on("close", () => {
    file.end();
    console.log("❌ Client disconnected");
  });

  ws.on("error", err => {
    console.error("❌ WebSocket error:", err);
  });
});
import WebSocket, { WebSocketServer } from "ws";
import fs from "fs";

const PORT = process.env.PORT || 10000; // порт WebSocket
const PATH = "/stream";                 // путь, совпадает с ESP32

const wss = new WebSocketServer({ port: PORT, path: PATH });

console.log(`🌐 WebSocket server running on ws://localhost:${PORT}${PATH}`);

wss.on("connection", ws => {
  const timestamp = Date.now();
  const filename = `stream_${timestamp}.pcm`;
  const file = fs.createWriteStream(filename);
  let totalBytes = 0;

  console.log("🎙 Client connected");

  ws.on("message", data => {
    if (data.toString() === "/end") {
      file.end();
      console.log(`⏹ Stream ended: ${filename} (total bytes: ${totalBytes})`);
      return;
    }

    if (data instanceof Buffer) {
      file.write(data);
      totalBytes += data.length;
      console.log(`⬇️ Chunk received: ${data.length} bytes (total: ${totalBytes})`);
    }
  });

  ws.on("close", () => {
    file.end();
    console.log("❌ Client disconnected");
  });

  ws.on("error", err => {
    console.error("❌ WebSocket error:", err);
  });
});
