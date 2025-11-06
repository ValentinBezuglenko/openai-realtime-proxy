// server-fixed.js
// npm install ws axios
import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";

const PORT = process.env.PORT || 8765;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

async function createRealtimeSession() {
  const res = await axios.post(
    "https://api.openai.com/v1/realtime/sessions",
    { model: "gpt-4o-realtime-preview-2024-12-17", voice: "alloy" },
    { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" } }
  );
  return res.data;
}

async function start() {
  const wss = new WebSocketServer({ port: PORT });
  console.log(`🚀 Proxy listening on ws://0.0.0.0:${PORT}`);

  wss.on("connection", async (esp) => {
    console.log("✅ ESP connected:", esp._socket && esp._socket.remoteAddress);

    // создаём сессию
    let session;
    try {
      console.log("🔧 Creating OpenAI session...");
      session = await createRealtimeSession();
      console.log("✅ OpenAI session created:", session.id);
    } catch (e) {
      console.error("❌ createRealtimeSession failed:", e.message || e);
      esp.send(JSON.stringify({ type: "error", error: "session.create failed" }));
      esp.close();
      return;
    }

    const clientSecret = session.client_secret?.value || session.client_secret;
    if (!clientSecret) {
      console.warn("⚠️ session.client_secret is null — still attempting WS connect");
    }

    const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}&client_secret=${encodeURIComponent(clientSecret || "")}`;
    const oa = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${clientSecret}`, "OpenAI-Beta": "realtime=v1" } });

    let openAIConnected = false;
    let audioChunksSent = 0;

    oa.on("open", () => {
      openAIConnected = true;
      console.log("✅ Connected to OpenAI Realtime WS");
      // Отправляем ACK ESP только когда OpenAI готов
      if (esp.readyState === WebSocket.OPEN) {
        esp.send(JSON.stringify({ type: "connection.ack", event: "connected" }));
        console.log("📣 Sent connection.ack to ESP");
      }
    });

    oa.on("message", (data) => {
      const msg = data.toString();
      // пересылаем все события OpenAI обратно на ESP
      if (esp.readyState === WebSocket.OPEN) esp.send(msg);
      // логируем ошибки/response.done
      try {
        const p = JSON.parse(msg);
        if (p.type === "error") console.error("OpenAI ERROR:", p.error);
        if (p.type === "response.text.done") console.log("🎯 TRANSCRIPTION:", p.text);
      } catch {}
    });

    oa.on("error", (err) => console.error("❌ OpenAI WS error:", err && err.message));
    oa.on("close", (code, reason) => { openAIConnected = false; console.log("🔌 OpenAI WS closed", code, reason && reason.toString()); });

    // Обработка от ESP (текст + бинар)
    esp.on("message", (msg, isBinary) => {
      if (!openAIConnected) {
        // иногда session.created приходит раньше open; логируем, но игнорируем чанки
        if (isBinary) console.log("⚠️ OpenAI not ready yet — binary chunk skipped");
        else console.log("⚠️ OpenAI not ready yet — text skipped:", msg.toString().trim());
        return;
      }

      if (isBinary) {
        console.log(`📥 Received binary chunk: ${msg.length} bytes`);
        // Отправляем на OpenAI в виде base64
        try {
          oa.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.toString("base64") }));
          audioChunksSent++;
          if (audioChunksSent % 10 === 0) console.log(`📊 Sent ${audioChunksSent} chunks to OpenAI`);
        } catch (e) {
          console.error("❌ Failed to forward binary to OpenAI:", e.message || e);
        }
      } else {
        const text = msg.toString().trim();
        console.log("📝 Text from ESP:", text);
        if (/STOP|STREAM STOPPED/i.test(text)) {
          console.log("🛑 STOP received from ESP — committing");
          if (audioChunksSent > 0) {
            oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            setTimeout(() => {
              oa.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"] } }));
            }, 500);
            audioChunksSent = 0;
          } else {
            console.log("⚠️ No audio chunks were sent before STOP");
            // всё равно создаём пустой response, если нужно
            oa.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"] } }));
          }
        }
      }
    });

    esp.on("close", () => {
      console.log("🔌 ESP disconnected");
      if (oa && oa.readyState === WebSocket.OPEN) oa.close();
    });

  });

  wss.on("error", (e) => console.error("WS Server error:", e.message || e));
}

start().catch(console.error);
