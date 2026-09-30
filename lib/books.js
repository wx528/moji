import crypto from "crypto";
import db from "./db.js";

const newId = () => crypto.randomUUID();

const SEED_CHAPTERS = [
  {
    title: "第一章：荒原上的启航",
    content: "（第一章尚未开始撰写。点击此处，从荒原上的第一声汽笛写起……）",
  },
  { title: "第二章：引力潮汐的脉动", content: "（第二章尚未开始撰写……）" },
  {
    title: "第三章：星际迷途",
    content: [
      "“星河漫游号”的深空雷达在半小时前归于寂静，连同它那最后一下代表恒星回响的绿点，彻底消失在浩瀚尘埃中。",
      "陈迹揉了揉酸痛的太阳穴，从写字台旁站起身。透过厚重的强化舷窗，外头扭曲的光晕宛如浓稠的松节油在稻草纸上洇开。引力透镜将红巨星最后的光芒拉扯成长长的、虚无的橘线，如同神明泼洒在这片荒芜冷寂宇宙中的金色墨痕。",
      "“领航员，动力引擎将在六分钟后进入休眠状态。”人工智能冰冷微弱的女声，通过控制台内敛的簧片结构震颤着，“我们正处于万有引力完全不可测知的黑暗区。”",
      "陈迹将沾满深色墨水的金尖钢笔轻轻搁回瓷架，叹了口气。哪怕在星际飞行的时代，他依然偏爱这套复古的机械书写工具。在笔尖与纸张轻微的沙沙声中，混乱无序的思维才能像沙金在筛斗中一样慢慢沉淀下来。他拉开抽屉，取出一本泛黄的硬皮航行日志，翻到空白的下一页——上面清晰地印着一行小字：“如果迷途是星河的必然，那就把星图画在心上。”",
    ].join("\n\n"),
    sections: [
      { title: "3.1 故障的跃迁引擎", content: "（3.1 尚未开始撰写……）" },
      { title: "3.2 虚空中的异常波段", content: "（3.2 尚未开始撰写……）" },
      { title: "3.3 无法回头的未知深渊", content: "（3.3 尚未开始撰写……）" },
    ],
  },
  { title: "第四章：暗物质的回响", content: "（第四章尚未开始撰写……）" },
  { title: "第五章：星域边缘的微光", content: "（第五章尚未开始撰写……）" },
];

const insertChapter = db.prepare(`
  INSERT INTO chapters (id, book_id, parent_id, title, content, sort_order, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

export function getOrCreateBookForUser(email) {
  let book = db
    .prepare(
      "SELECT * FROM books WHERE user_email = ? AND deleted = 0 ORDER BY created_at LIMIT 1"
    )
    .get(email);

  if (!book) {
    const bookId = newId();
    db.prepare("INSERT INTO books (id, user_email, title, created_at) VALUES (?, ?, ?, ?)").run(
      bookId,
      email,
      "星河漫游指南",
      Date.now()
    );
    SEED_CHAPTERS.forEach((ch, i) => {
      const chapterId = newId();
      insertChapter.run(chapterId, bookId, null, ch.title, ch.content, i, Date.now());
      (ch.sections ?? []).forEach((sec, j) => {
        insertChapter.run(newId(), bookId, chapterId, sec.title, sec.content, j, Date.now());
      });
    });
    book = db.prepare("SELECT * FROM books WHERE id = ?").get(bookId);
  }
  return book;
}

export function getBookById(bookId) {
  return db.prepare("SELECT * FROM books WHERE id = ?").get(bookId);
}

export function getChapterTree(bookId) {
  const toDto = (r) => ({ id: r.id, title: r.title, content: r.content });
  const top = db
    .prepare(
      "SELECT * FROM chapters WHERE book_id = ? AND deleted = 0 AND parent_id IS NULL ORDER BY sort_order"
    )
    .all(bookId);
  const sectionsStmt = db.prepare(
    "SELECT * FROM chapters WHERE book_id = ? AND deleted = 0 AND parent_id = ? ORDER BY sort_order"
  );
  return top.map((r) => ({
    ...toDto(r),
    sections: sectionsStmt.all(bookId, r.id).map(toDto),
  }));
}

export function createChapter({ bookId, title, parentId = null }) {
  const max = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM chapters WHERE book_id = ? AND parent_id IS ?")
    .get(bookId, parentId).m;
  const id = newId();
  insertChapter.run(id, bookId, parentId, title, "", max + 1, Date.now());
  return id;
}

export function getChapterWithBook(chapterId) {
  return db
    .prepare(
      `SELECT c.*, b.user_email FROM chapters c
       JOIN books b ON b.id = c.book_id WHERE c.id = ?`
    )
    .get(chapterId);
}

export function updateChapter(chapterId, { title, content }) {
  const sets = [];
  const args = [];
  if (title !== undefined) {
    sets.push("title = ?");
    args.push(title);
  }
  if (content !== undefined) {
    sets.push("content = ?");
    args.push(content);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  args.push(Date.now(), chapterId);
  db.prepare(`UPDATE chapters SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}

export function softDeleteChapter(chapterId) {
  const now = Date.now();
  db.prepare("UPDATE chapters SET deleted = 1, deleted_at = ? WHERE id = ?").run(now, chapterId);
  db.prepare("UPDATE chapters SET deleted = 1, deleted_at = ? WHERE parent_id = ?").run(now, chapterId);
}

export function restoreChapter(chapterId) {
  db.prepare("UPDATE chapters SET deleted = 0, deleted_at = NULL WHERE id = ? OR parent_id = ?").run(
    chapterId,
    chapterId
  );
}

export function purgeChapter(chapterId) {
  db.prepare("DELETE FROM chapters WHERE id = ? OR parent_id = ?").run(chapterId, chapterId);
}

export function listTrash(userEmail) {
  return db
    .prepare(
      `SELECT c.id, c.title, c.deleted_at, c.parent_id, b.title AS bookTitle
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE b.user_email = ? AND c.deleted = 1
       ORDER BY c.deleted_at DESC`
    )
    .all(userEmail);
}

export function listBooksWithStats(userEmail) {
  const books = db
    .prepare(
      "SELECT id, title, created_at FROM books WHERE user_email = ? AND deleted = 0 ORDER BY created_at"
    )
    .all(userEmail);
  const topStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM chapters WHERE book_id = ? AND deleted = 0 AND parent_id IS NULL"
  );
  const contentStmt = db.prepare(
    "SELECT content FROM chapters WHERE book_id = ? AND deleted = 0"
  );
  return books.map((b) => {
    const chapterCount = topStmt.get(b.id).n;
    const chars = contentStmt
      .all(b.id)
      .reduce((s, r) => s + (r.content ?? "").replace(/\s+/g, "").length, 0);
    return { id: b.id, title: b.title, createdAt: b.created_at, chapterCount, chars };
  });
}

export function createBook(userEmail, title) {
  const id = newId();
  db.prepare("INSERT INTO books (id, user_email, title, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    userEmail,
    title,
    Date.now()
  );
  return id;
}

export function getBookForUser(email, bookId) {
  if (bookId) {
    const book = getBookById(bookId);
    if (book && !book.deleted && book.user_email === email) return book;
  }
  return getOrCreateBookForUser(email);
}

export function deleteBook(userEmail, bookId) {
  const book = getBookById(bookId);
  if (!book || book.user_email !== userEmail) return false;
  db.prepare("UPDATE books SET deleted = 1 WHERE id = ?").run(bookId);
  return true;
}

export function reorderChapters(userEmail, ids) {
  const check = db.prepare(
    `SELECT c.id FROM chapters c JOIN books b ON b.id = c.book_id
     WHERE c.id = ? AND b.user_email = ?`
  );
  const update = db.prepare(
    "UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ?"
  );
  const tx = db.transaction((list) => {
    list.forEach((id, i) => {
      if (check.get(id, userEmail)) update.run(i, Date.now(), id);
    });
  });
  tx(ids);
}
