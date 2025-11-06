import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";

const PORT = process.env.PORT || 8765;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

async function createRealtimeSession() {
  const res = await axios.post("https://api.openai.com/v1/realtime/sessions", {
    model: "gpt-4o-realtime-preview-2024-12-17",
    voice: "alloy"
  }, { headers: { Authorization: `Bearer ${OPENAI_KEY}` }});
  return res.data;
}

async function start() {
  const wss = new WebSocketServer({ port: PORT });
  console.log(`🚀 Proxy listening on ws://0.0.0.0:${PORT}`);

  wss.on("connection", async (esp) => {
    console.log("✅ ESP connected");

    // создаём Realtime-сессию
    const session = await createRealtimeSession();
    const clientSecret = session.client_secret.value || session.client_secret;
    console.log("🌐 Connecting to OpenAI WS...");
    const oa = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17&client_secret=${encodeURIComponent(clientSecret)}`, {
      headers: { Authorization: `Bearer ${clientSecret}`, "OpenAI-Beta": "realtime=v1" }
    });

    let openAIConnected = false;

    oa.on("open", () => {
      console.log("✅ Connected to OpenAI Realtime WS");
      openAIConnected = true;
    });

    oa.on("message", (data) => {
      const msg = data.toString();
      esp.send(msg); // пересылаем обратно на ESP32
    });

    oa.on("close", () => openAIConnected = false);
    oa.on("error", (err) => console.error("OpenAI WS error:", err));

    // принимаем от ESP32
    esp.on("message", (msg, isBinary) => {
      if (!openAIConnected) return;

      if (isBinary) {
        // здесь формируем JSON и отправляем на OpenAI
        oa.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: msg.toString("base64")
        }));
      } else {
        const text = msg.toString();
        if (text.includes("STREAM STOPPED")) {
          oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          oa.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"] }}));
        }
      }
    });

    esp.on("close", () => oa.close());
  });
}

start().catch(console.error);
