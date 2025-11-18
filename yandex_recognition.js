// --- Ключевые слова для эмоций ---
const emotionKeywords = {
  greeting: ["Привет","хай","здарова","ёня"],
  happy: ["ура","супер","здорово"],
  sad: ["грустно","печаль"],
  angry: ["злюсь","сердит","дурак"],
  laugh: ["ха-ха","смешно","смейся"],
  sleep: ["спать","сон","спи"],
  victory: ["победа","выиграл"],
  idle: []
};

// --- Обработка распознанного текста и определение эмоции ---
function detectEmotions(text) {
  const detectedEmotions = [];

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        detectedEmotions.push(emotion);
        break; // чтобы одно ключевое слово не добавляло одну эмоцию дважды
      }
    }
  }

  return detectedEmotions;
}

// --- Пример использования после Yandex STT ---
const sttResponse = '{"result":"Дурак"}';
let recognizedText = "";
try {
  recognizedText = JSON.parse(sttResponse).result || "";
} catch {
  recognizedText = sttResponse;
}

const emotions = detectEmotions(recognizedText);

if (emotions.length > 0) {
  emotions.forEach(em => console.log(`🟢 Обнаружена эмоция '${em}'`));
} else {
  console.log("⚪ Эмоция не определена");
}
