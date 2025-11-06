// npm install ws axios
import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";

const PORT = process.env.PORT || 10000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

async function createRealtimeSession() {
  const response = await axios.post(
    "https://api.openai.com/v1/realtime/sessions",
    { model: "gpt-4o-realtime-preview-2024-12-17" },
    { headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" } }
  );
  return response.data;
}

async function start() {
  console.log(`🚀 Proxy listening on ws://0.0.0.0:${PORT}`);
  const wss = new WebSocketServer({ port: PORT, path: "/ws" });

  wss.on("connection", async (esp) => {
    console.log("✅ ESP connected", esp._socket.remoteAddress);

    try {
      const session = await createRealtimeSession();
      const clientSecret = session?.client_secret?.value || session?.client_secret;
      if (!clientSecret) throw new Error("No client_secret in OpenAI response");

      const oa = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17&client_secret=${encodeURIComponent(clientSecret)}`,
        { headers: { Authorization: `Bearer ${clientSecret}`, "OpenAI-Beta": "realtime=v1" } }
      );

      // --- состояние ---
      let ready = false;
      let audioBuffer = [];
      const MAX_CHUNK_SIZE = 32768; // 32 KB

      function flushAudioBuffer(force = false) {
        if (audioBuffer.length === 0 || oa.readyState !== WebSocket.OPEN) return;

        let buffer = Buffer.concat(audioBuffer);
        while (buffer.length > 0) {
          const sendSize = Math.min(MAX_CHUNK_SIZE, buffer.length);
          const chunk = buffer.slice(0, sendSize);
          oa.send(JSON.stringify({ type: "input_audio_buffer.append", audio: chunk.toString("base64") }));
          console.log(`📤 Sent chunk: ${sendSize} bytes`);
          buffer = buffer.slice(sendSize);
        }
        audioBuffer = [];
      }

      // --- события OpenAI ---
      oa.on("open", () => console.log("🔗 Connected to OpenAI Realtime"));

      oa.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "session.created") {
            console.log("🟢 OpenAI session ready");
            ready = true;
          }
          if (parsed.type === "response.output_text.delta") process.stdout.write(parsed.delta);
          if (parsed.type === "response.completed") console.log("\n✅ Transcription complete\n");
          if (parsed.type === "error") console.error("❌ OpenAI Error:", parsed.error);
        } catch (err) { console.error("⚠️ Parse error:", err.message); }
      });

      oa.on("close", () => console.log("🔌 OpenAI closed"));
      oa.on("error", (e) => console.error("❌ OpenAI WS Error:", e.message));

      // --- получение данных от ESP ---
      esp.on("message", (msg) => {
        if (!ready) return;

        if (Buffer.isBuffer(msg)) {
          audioBuffer.push(msg);
          if (Buffer.concat(audioBuffer).length >= MAX_CHUNK_SIZE) flushAudioBuffer();
          return;
        }

        const text = msg.toString().trim();
        if (text.includes("STREAM_STOPPED")) {
          flushAudioBuffer(true);
          if (oa.readyState === WebSocket.OPEN) {
            oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            oa.send(JSON.stringify({
              type: "response.create",
              response: { modalities: ["text"], instructions: "Return only transcription" }
            }));
            console.log("📨 Commit + response.create sent");
          }
        }

        if (text.includes("STREAM_STARTED")) {
          audioBuffer = [];
          console.log("🎙 Stream started");
        }
      });

      // --- ESP отключился ---
      esp.on("close", () => {
        console.log("🔌 ESP disconnected, flushing remaining buffer");
        flushAudioBuffer(true);
        if (oa.readyState === WebSocket.OPEN) {
          oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          oa.send(JSON.stringify({
            type: "response.create",
            response: { modalities: ["text"], instructions: "Return only transcription" }
          }));
          console.log("📨 Commit + response.create sent after ESP disconnect");
        }
        oa.close();
      });

      esp.on("error", (e) => console.error("❌ ESP error:", e.message));

    } catch (err) {
      console.error("❌ Setup error:", err.message);
      if (esp.readyState === WebSocket.OPEN) esp.close();
    }
  });
}

start().catch(console.error);
