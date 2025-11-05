# OpenAI Realtime Proxy Server

Прокси-сервер для подключения ESP32 к OpenAI Realtime API через WebSocket.

## Описание

Сервер принимает WebSocket соединения от ESP32 и проксирует аудио в OpenAI Realtime API для транскрипции речи в текст.

## Установка

```bash
npm install
```

## Запуск локально

```bash
npm start
```

Или с указанием порта:
```bash
PORT=8765 node proxy_openai_realtime.js
```

## Переменные окружения

- `PORT` - Порт для WebSocket сервера (по умолчанию: 8765)
- `OPENAI_API_KEY` - API ключ OpenAI (обязательно)

## Деплой на Render

1. Создайте новый Web Service на Render
2. Подключите этот репозиторий
3. Установите переменную окружения `OPENAI_API_KEY`
4. Build Command: `npm install`
5. Start Command: `npm start`

Сервер автоматически будет использовать порт из переменной окружения `PORT`, которую Render устанавливает автоматически.
