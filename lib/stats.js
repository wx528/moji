import db from "./db.js";

export function countWords(text) {
  return (text ?? "").replace(/\s+/g, "").length;
}

const upsert = db.prepare(`
  INSERT INTO writing_stats (user_email, date, words) VALUES (?, ?, ?)
  ON CONFLICT (user_email, date) DO UPDATE SET words = words + excluded.words
`);

export function recordWordDelta(userEmail, delta) {
  if (!delta) return;
  const date = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地时区）
  upsert.run(userEmail, date, delta);
}

export function getStats(userEmail, days = 14) {
  const rows = db
    .prepare(
      `SELECT date, words FROM writing_stats WHERE user_email = ? AND date >= ?
       ORDER BY date`
    )
    .all(userEmail, new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE"));

  const byDate = new Map(rows.map((r) => [r.date, r.words]));

  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toLocaleDateString("sv-SE");
    daily.push({ date: key, words: byDate.get(key) ?? 0 });
  }

  const { total } = db
    .prepare("SELECT COALESCE(SUM(words), 0) AS total FROM writing_stats WHERE user_email = ?")
    .get(userEmail);

  return {
    total,
    today: byDate.get(new Date().toLocaleDateString("sv-SE")) ?? 0,
    days: daily,
  };
}
