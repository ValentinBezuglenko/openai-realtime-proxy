// npm install ws axios
import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";

const PORT = process.env.PORT || 8765;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

// Создаёт новую Realtime-сессию OpenAI
async function createRealtimeSession() {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/realtime/sessions",
      {
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("✅ OpenAI session created:", response.data.id);
    return response.data;
  } catch (err) {
    console.error("❌ Failed to create OpenAI session:", err.response?.data || err.message);
    throw err;
  }
}

async function start() {
  console.log(`🚀 Starting WebSocket proxy on ws://0.0.0.0:${PORT}`);
  const wss = new WebSocketServer({ port: PORT });

  wss.on("connection", async (esp) => {
    console.log("✅ ESP connected:", esp._socket.remoteAddress);

    // Подтверждение подключения ESP
    esp.send(JSON.stringify({ type: "connection.ack", event: "connected" }));

    let oa; // WebSocket к OpenAI
    let openAIConnected = false;

    try {
      console.log("🔧 Creating OpenAI Realtime session...");
      const session = await createRealtimeSession();

      // Получаем client_secret
      const clientSecret = session.client_secret?.value || session.client_secret;
      if (!clientSecret) throw new Error("No client_secret in session response");

      const wsUrl = `wss://api.openai.com/v1/realtime?model=${session.model}&client_secret=${encodeURIComponent(clientSecret)}`;
      console.log("🌐 Connecting to OpenAI WS...");

      oa = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      oa.on("open", () => {
        console.log("✅ Connected to OpenAI Realtime WS");
        openAIConnected = true;
      });

      oa.on("message", (data) => {
        const msg = data.toString();
        console.log("<<< OpenAI:", msg.slice(0, 200));
        // Просто пересылаем на ESP32
        if (esp.readyState === WebSocket.OPEN) {
          esp.send(msg);
        }
      });

      oa.on("error", (err) => console.error("❌ OpenAI WS error:", err.message));
      oa.on("close", (code, reason) => {
        console.log("🔌 OpenAI WS closed:", code, reason.toString());
        openAIConnected = false;
      });

      esp.on("message", (msg) => {
        if (!openAIConnected) {
          console.log("⚠️ OpenAI not ready, message skipped");
          return;
        }
        // Пересылаем всё бинарное или текстовое на OpenAI
        if (Buffer.isBuffer(msg)) {
          oa.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.toString("base64") }));
        } else {
          const text = msg.toString();
          if (text.includes("STREAM STOPPED")) {
            oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            oa.send(JSON.stringify({ type: "response.create", response: { modalities: ["text"] } }));
          }
        }
      });

      esp.on("close", () => {
        console.log("🔌 ESP disconnected");
        if (oa && oa.readyState === WebSocket.OPEN) oa.close();
      });

    } catch (err) {
      console.error("❌ Error during setup:", err.message);
      if (esp.readyState === WebSocket.OPEN) {
        esp.send(JSON.stringify({ type: "error", error: err.message }));
        esp.close();
      }
    }
  });

  wss.on("error", (err) => console.error("❌ WebSocket server error:", err.message));
}

start().catch(console.error);
