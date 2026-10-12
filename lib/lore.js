import { getCards } from "./books.js";

// 世界书：把一本书的设定卡整理成注入 AI 上下文的文本
// （卡片笔记=世界观/角色等，剧情大纲=情节走向；单卡截 400 字，每组上限 2500 字）
export function buildLore(book) {
  const cards = getCards(book.id); // {notes: [...], outline: [...]}
  const fmt = (list) =>
    list
      .map((c) => `《${c.title}》${String(c.body ?? "").trim().slice(0, 400)}`)
      .join("\n");
  const notes = (cards.notes ?? []).filter((c) => (c.body ?? "").trim());
  const outline = (cards.outline ?? []).filter((c) => (c.body ?? "").trim());
  let lore = "";
  if (notes.length) lore += `\n\n【设定卡 · 世界观/角色】\n${fmt(notes).slice(0, 2500)}`;
  if (outline.length) lore += `\n\n【剧情大纲】\n${fmt(outline).slice(0, 2500)}`;
  return lore;
}
