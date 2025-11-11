import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

const PORT = process.env.PORT || 8080; // WebSocket
const HTTP_PORT = process.env.HTTP_PORT || 8081; // Express
const app = express();

const OGG_DIR = path.join(process.cwd(), "public", "ogg");

if (!fs.existsSync(OGG_DIR)) {
  fs.mkdirSync(OGG_DIR, { recursive: true });
  console.log("Created folder: " + OGG_DIR);
}

const wss = new WebSocketServer({ port: PORT });
console.log("WebSocket server running on port " + PORT);

wss.on("connection", ws => {
  const timestamp = Date.now();
  const pcmFilename = "stream_" + timestamp + ".pcm";
  const oggFilename = "stream_" + timestamp + ".ogg";
  const pcmPath = path.join(OGG_DIR, pcmFilename);
  const oggPath = path.join(OGG_DIR, oggFilename);

  const file = fs.createWriteStream(pcmPath);
  let totalBytes = 0;
  let finalized = false;

  console.log("Client connected");

  const finalizeStream = () => {
    if (finalized) return;
    finalized = true;

    file.end(() => {
      console.log("Stream ended: " + pcmFilename + " (total bytes: " + totalBytes + ")");

      if (totalBytes === 0) {
        console.warn("No audio data received, skip conversion");
        return;
      }

      const command =
        "ffmpeg -y -f s16le -ar 16000 -ac 1 -i \"" + pcmPath + "\" -c:a libopus \"" + oggPath + "\"";

      exec(command, (err, stdout, stderr) => {
        if (err) {
          console.error("ffmpeg error:", stderr);
          return;
        }

        if (!fs.existsSync(oggPath) || fs.statSync(oggPath).size === 0) {
          console.error("OGG file not created or empty: " + oggFilename);
          return;
        }

        console.log("Converted to OGG: " + oggFilename);
        console.log(
          "Web player available at: http://localhost:" + HTTP_PORT + "/player/" + oggFilename
        );
      });
    });
  };

  ws.on("message", data => {
    if (typeof data === "string" && data === "/end") {
      finalizeStream();
      return;
    }

    if (data instanceof Buffer) {
      file.write(data);
      totalBytes += data.length;
      console.log("Chunk received: " + data.length + " bytes (total: " + totalBytes + ")");
    }
  });

  ws.on("close", finalizeStream);
  ws.on("error", err => {
    console.error("WebSocket error:", err);
    finalizeStream();
  });
});

app.get("/player/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(OGG_DIR, filename);

  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

  res.send(
    "<!doctype html>\n" +
      "<html>\n" +
      "  <head><title>Audio Player</title></head>\n" +
      "  <body>\n" +
      "    <h1>Play OGG</h1>\n" +
      "    <audio controls>\n" +
      "      <source src=\"/file/" +
      filename +
      "\" type=\"audio/ogg\">\n" +
      "      Your browser does not support OGG.\n" +
      "    </audio>\n" +
      "    <br>\n" +
      "    <a href=\"/file/" +
      filename +
      "\" download>Download OGG</a>\n" +
      "  </body>\n" +
      "</html>\n"
  );
});

app.use("/file", express.static(OGG_DIR));

app.listen(HTTP_PORT, () => {
  console.log("HTTP server running on port " + HTTP_PORT);
});
