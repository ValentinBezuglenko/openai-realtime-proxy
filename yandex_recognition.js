import net from "net";
import fs from "fs";

const PORT = 5000;

const server = net.createServer(socket => {
  const timestamp = Date.now();
  const filename = `stream_${timestamp}.pcm`;
  const file = fs.createWriteStream(filename);
  let totalBytes = 0;

  console.log("🎙 Client connected");

  socket.on("data", chunk => {
    file.write(chunk);
    totalBytes += chunk.length;
    console.log(`⬇️ Chunk received: ${chunk.length} bytes (total: ${totalBytes})`);
  });

  socket.on("end", () => {
    file.end();
    console.log(`⏹ Stream ended: ${filename} (total bytes: ${totalBytes})`);
  });

  socket.on("error", err => {
    console.error("❌ Socket error:", err);
  });
});

server.listen(PORT, () => {
  console.log(`🌐 TCP Server running on port ${PORT}`);
});
