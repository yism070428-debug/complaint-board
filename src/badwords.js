import { queryAll } from "./db.js";

/**
 * 금칙어 검사 및 필터링 유틸리티
 */
export function filterBadwords(text) {
  if (!text || typeof text !== "string") return { cleanText: text, hasBadword: false, matchedWords: [] };

  const rows = queryAll("SELECT word FROM badwords");
  const words = rows.map((r) => r.word.trim()).filter(Boolean);

  let cleanText = text;
  let hasBadword = false;
  const matchedWords = [];

  for (const w of words) {
    if (cleanText.includes(w)) {
      hasBadword = true;
      matchedWords.push(w);
      // '***'로 치환
      const regex = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      cleanText = cleanText.replace(regex, "*".repeat(w.length));
    }
  }

  return { cleanText, hasBadword, matchedWords };
}
