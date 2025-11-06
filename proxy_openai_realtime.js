import WebSocket, { WebSocketServer } from "ws";
import axios from "axios";

const PORT = process.env.PORT || 8765;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

async function createRealtimeSession() {
  const response = await axios.post(
    "https://api.openai.com/v1/realtime/sessions",
    {
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "alloy",
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return response.data;
}

async function start() {
  console.log(`🚀 WebSocket proxy listening on ws://0.0.0.0:${PORT}`);
  const wss = new WebSocketServer({ port: PORT });

  wss.on("connection", async (esp) => {
    console.log("✅ ESP connected");
    esp.send(JSON.stringify({ type: "connected" }));

    try {
      console.log("🔧 Creating OpenAI Realtime session...");
      const session = await createRealtimeSession();
      const token =
        session.client_secret?.value || session.client_secret || null;
      if (!token) throw new Error("No client_secret found");

      const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17&client_secret=${encodeURIComponent(
        token
      )}`;

      const oa = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      let ready = false;
      let pendingChunks = [];
      let sent = 0;

      oa.on("open", () => console.log("✅ Connected to OpenAI Realtime"));

      oa.on("message", (data) => {
        const msg = data.toString();
        try {
          const json = JSON.parse(msg);
          if (json.type === "session.created") {
            console.log("🟢 OpenAI session ready");
            ready = true;
            // Отправляем накопленные аудио чанки
            for (const chunk of pendingChunks) {
              oa.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: chunk.toString("base64"),
                })
              );
              sent++;
            }
            pendingChunks = [];
          }

          if (json.type === "response.text.delta") process.stdout.write(json.delta);
          if (json.type === "response.text.done")
            console.log(`\n🎯 Text: "${json.text}"`);
        } catch {}
        esp.send(msg);
      });

      oa.on("close", () => console.log("🔌 OpenAI WS closed"));
      oa.on("error", (err) => console.error("❌ OpenAI WS error:", err.message));

      esp.on("message", (msg) => {
        if (Buffer.isBuffer(msg)) {
          if (oa.readyState !== WebSocket.OPEN) return;

          if (!ready) {
            pendingChunks.push(msg);
            return;
          }

          oa.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: msg.toString("base64"),
            })
          );
          sent++;
          if (sent % 10 === 0) console.log(`📊 Sent ${sent} chunks`);
        } else {
          const txt = msg.toString().trim();
          if (txt === "STOP") {
            console.log("🛑 Stop received");
            oa.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
            setTimeout(() => {
              oa.send(
                JSON.stringify({
                  type: "response.create",
                  response: { modalities: ["text"] },
                })
              );
            }, 300);
          }
        }
      });

      esp.on("close", () => {
        console.log("🔌 ESP disconnected");
        if (oa.readyState === WebSocket.OPEN) oa.close();
      });
    } catch (err) {
      console.error("❌ Setup failed:", err.message);
      esp.send(JSON.stringify({ type: "error", error: err.message }));
      esp.close();
    }
  });
}

start().catch(console.error);
