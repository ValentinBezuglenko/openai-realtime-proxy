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
      let flushTimer = null;

      const SAMPLE_RATE = 24000;
      const BYTES_PER_SAMPLE = 2;
      const MIN_SEC = 2;
      const MIN_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MIN_SEC;
      const CHUNK_SIZE = 32 * 1024; // 32 KB

      // --- flush аудио ---
      function flushAudioBuffer(force = false) {
        if (audioBuffer.length === 0 || oa.readyState !== WebSocket.OPEN) return;

        const full = Buffer.concat(audioBuffer);

        if (!force && full.length < MIN_BYTES) {
          console.log(`⏳ Buffer too small (${full.length} bytes), waiting for 2s of audio`);
          return;
        }

        for (let offset = 0; offset < full.length; offset += CHUNK_SIZE) {
          const end = Math.min(offset + CHUNK_SIZE, full.length);
          const chunk = full.slice(offset, end);
          const base64 = chunk.toString("base64");
          oa.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
          console.log(`📤 Sent chunk: ${chunk.length} bytes`);
        }

        audioBuffer = [];
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      // --- commit + response.create ---
      function commitAudio() {
        if (oa.readyState !== WebSocket.OPEN) return;
        oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        oa.send(JSON.stringify({
          type: "response.create",
          response: { modalities: ["text"], instructions: "Return only transcription" }
        }));
        console.log("📨 Commit + response.create sent");
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

      // --- данные от ESP ---
      esp.on("message", (msg) => {
        if (!ready) return;

        if (Buffer.isBuffer(msg)) {
          audioBuffer.push(msg);

          clearTimeout(flushTimer);
          flushTimer = setTimeout(() => flushAudioBuffer(), 2000);
          return;
        }

        const text = msg.toString().trim();
        if (text.includes("STREAM_STOPPED")) {
          flushAudioBuffer(true);
          commitAudio();
        }

        if (text.includes("STREAM_STARTED")) {
          audioBuffer = [];
          flushTimer = null;
          console.log("🎙 Stream started");
        }
      });

      // --- ESP отключился ---
      esp.on("close", () => {
        console.log("🔌 ESP disconnected, flushing remaining buffer");
        flushAudioBuffer(true);
        commitAudio();
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
