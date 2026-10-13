"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { mojiConfirm, mojiPrompt } from "../moji-dialog";
import "./shelf.css";

const COVERS = [
  { bg: "linear-gradient(160deg, #2b3a4a, #161f28)", accent: "#c8a46b" },
  { bg: "linear-gradient(160deg, #1e1714, #0d0906)", accent: "#a87c53" },
  { bg: "linear-gradient(160deg, #6e4426, #3d2412)", accent: "#e8c9a0" },
  { bg: "linear-gradient(160deg, #3d5245, #1f2b23)", accent: "#bcd2c2" },
  { bg: "linear-gradient(160deg, #55384a, #2e1c28)", accent: "#d9b8cc" },
  { bg: "linear-gradient(160deg, #33465a, #1b2733)", accent: "#9fc0dd" },
];

const coverFor = (id) =>
  COVERS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % COVERS.length];

export default function ShelfPage() {
  const router = useRouter();
  const [books, setBooks] = useState([]);
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadBooks = useCallback(() => {
    fetch("/api/books")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setBooks(data?.books ?? []))
      .catch(() => setBooks([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
    loadBooks();
  }, [loadBooks]);

  async function handleDeleteBook(e, book) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await mojiConfirm({
      label: `确定删除《${book.title}》吗？\n删除后书籍将从书架移除（章节内容保留在数据库中）。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    loadBooks();
  }

  async function handleCreate() {
    const title = await mojiPrompt({ label: "给新书起个名字：", initial: "未命名新作" });
    if (title === null || !title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = await res.json();
      if (data.ok) router.push(`/editor?bookId=${data.id}`);
    } finally {
      setCreating(false);
    }
  }

  const formatChars = (n) =>
    n >= 10000 ? `${(n / 10000).toFixed(1)}万字` : `${n.toLocaleString("en-US")}字`;

  return (
    <main className="shelf">
      <header className="shelf-topbar">
        <Link className="shelf-brand" href="/shelf">
          <span className="shelf-brand__mark">墨</span>
          <span>墨迹 MoJi</span>
        </Link>
        <div className="shelf-topbar__right">
          <span className="shelf-user">{user?.name ?? "墨客"}</span>
        </div>
      </header>

      <section className="shelf-content">
        <div className="shelf-head">
          <h1>我的书架</h1>
          <button className="shelf-create" onClick={handleCreate} disabled={creating}>
            {creating ? "创建中…" : "+ 新建书籍"}
          </button>
        </div>

        {stats && (
          <div className="stats-card">
            <div className="stats-card__summary">
              <div className="stats-card__num">
                <strong>{stats.today.toLocaleString("en-US")}</strong>
                <span>今日新增（字）</span>
              </div>
              <div className="stats-card__num">
                <strong>{stats.total.toLocaleString("en-US")}</strong>
                <span>累计新增（字）</span>
              </div>
              <div className="stats-card__num">
                <strong>
                  {stats.days.reduce((s, d) => (d.words > 0 ? s + 1 : s), 0)}
                </strong>
                <span>近 14 天动笔（天）</span>
              </div>
            </div>
            <div className="stats-card__chart" role="img" aria-label="最近 14 天每日新增字数柱状图">
              {(() => {
                const max = Math.max(...stats.days.map((d) => d.words), 1);
                return stats.days.map((d) => (
                  <div className="stats-bar" key={d.date} title={`${d.date}：${d.words} 字`}>
                    <div
                      className={`stats-bar__fill${d.words > 0 ? "" : " is-zero"}${
                        d.date === stats.days[stats.days.length - 1].date ? " is-today" : ""
                      }`}
                      style={{ height: `${Math.max((d.words / max) * 100, d.words > 0 ? 6 : 2)}%` }}
                    />
                    <em>{d.date.slice(5).replace("-", "/")}</em>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {loading ? (
          <p className="shelf-loading">加载中…</p>
        ) : (
          <div className="shelf-grid">
            {books.map((b) => {
              const cover = coverFor(b.id);
              return (
                <Link className="book-card" href={`/editor?bookId=${b.id}`} key={b.id}>
                  <button
                    className="book-card__delete"
                    title="删除这本书"
                    onClick={(e) => handleDeleteBook(e, b)}
                  >
                    ×
                  </button>
                  <div className="book-cover" style={{ background: cover.bg, "--accent": cover.accent }}>
                    <span className="book-cover__spine" />
                    <span className="book-cover__frame" />
                    <span className="book-cover__seal">{b.title.charAt(0)}</span>
                    <h3 className="book-cover__title">{b.title}</h3>
                    <span className="book-cover__author">{user?.name ?? "墨客"} 著</span>
                  </div>
                  <div className="book-card__footer">
                    <p className="book-card__meta">
                      共 {b.chapterCount} 章 · {formatChars(b.chars)}
                    </p>
                    <span className="book-card__open">继续写作 →</span>
                  </div>
                </Link>
              );
            })}
            <button className="book-card book-card--new" onClick={handleCreate} disabled={creating}>
              <span className="book-card__plus">＋</span>
              <span>新建书籍</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
