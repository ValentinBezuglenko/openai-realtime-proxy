// страница-плеер
app.get("/player/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(OGG_DIR, filename);

  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

  res.send(`
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8">
        <title>${filename}</title>
        <style>
          body {
            font-family: sans-serif;
            background: #fafafa;
            color: #222;
            padding: 30px;
          }
          h1 { font-size: 1.2em; }
          audio { display: block; margin-top: 10px; }
          button {
            margin-top: 15px;
            padding: 8px 14px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.95em;
          }
          button:hover {
            background: #0056b3;
          }
          #result {
            margin-top: 20px;
            padding: 10px;
            border-radius: 8px;
            background: #e9ecef;
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <h1>🎧 ${filename}</h1>
        <audio controls>
          <source src="/file/${filename}" type="audio/ogg">
          Ваш браузер не поддерживает OGG.
        </audio>
        <br>
        <a href="/file/${filename}" download>⬇️ Скачать</a>
        <button id="recognizeBtn">🧠 Распознать</button>

        <div id="result"></div>

        <script>
          const btn = document.getElementById('recognizeBtn');
          const resultDiv = document.getElementById('result');
          btn.addEventListener('click', async () => {
            resultDiv.textContent = '⏳ Отправляем в Yandex STT...';
            btn.disabled = true;
            try {
              const res = await fetch('/recognize/${filename}', { method: 'POST' });
              const text = await res.text();
              resultDiv.textContent = '🗣️ Результат:\\n' + text;
            } catch (e) {
              resultDiv.textContent = '❌ Ошибка: ' + e.message;
            } finally {
              btn.disabled = false;
            }
          });
        </script>
      </body>
    </html>
  `);
});
