"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "./editor.css";

const countWords = (text) => (text ?? "").replace(/\s+/g, "").length;

const formatWords = (n) => n.toLocaleString("en-US");

const formatWan = (n) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)}万字` : `${formatWords(n)}字`;

const toolbarIcons = [24, 25, 26, 27, 28, 29, 30, 31, 32, 33];

const chapterIcons = { ch1: 14, ch2: 15, ch3: 16, ch4: 20, ch5: 21 };
const sectionIcons = { sec31: 17, sec32: 18, sec33: 19 };

function updateInTree(chapters, leafId, updater) {
  return chapters.map((ch) => {
    if (ch.id === leafId) return updater(ch);
    if (ch.sections?.some((s) => s.id === leafId)) {
      return {
        ...ch,
        sections: ch.sections.map((s) => (s.id === leafId ? updater(s) : s)),
      };
    }
    return ch;
  });
}

function EditorInner() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [active, setActive] = useState({ chapterId: null, sectionId: null });
  const [activeTab, setActiveTab] = useState("notes");
  const [saveState, setSaveState] = useState("saved"); // saving | saved
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  const [collapsed, setCollapsed] = useState([]);
  const [todayWords, setTodayWords] = useState(0);
  const [cards, setCards] = useState({ notes: [], outline: [] });
  const saveTimer = useRef(null);
  const editorRef = useRef(null);

  const chapter = chapters.find((c) => c.id === active.chapterId);
  const section = chapter?.sections?.find((s) => s.id === active.sectionId);
  const activeLeaf = section ?? chapter;
  const activeKey = chapter ? `${chapter.id}/${section?.id ?? ""}` : "";

  // 获取当前登录用户 + 主题偏好 + 今日字数
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setTodayWords(s.today))
      .catch(() => {});
    if (document.documentElement.dataset.theme === "dark") setTheme("dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next === "dark" ? "dark" : "";
    try {
      localStorage.setItem("moji-theme", next);
    } catch {}
  }

  function refreshTree() {
    return fetch(`/api/book${bookId ? `?bookId=${bookId}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setBook(data.book);
        setChapters(data.chapters);
        setCards(data.cards ?? { notes: [], outline: [] });
        setActive((prev) => {
          const stillThere = data.chapters.some(
            (c) =>
              c.id === prev.chapterId &&
              (!prev.sectionId || c.sections?.some((s) => s.id === prev.sectionId))
          );
          if (stillThere) return prev;
          const first = data.chapters[0];
          return first ? { chapterId: first.id, sectionId: null } : prev;
        });
      });
  }

  // 加载书籍数据（bookId 变化时重新加载，支持书架跳转）
  useEffect(() => {
    refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // 恢复折叠状态
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("moji-collapsed-v1") ?? "[]");
      if (Array.isArray(saved)) setCollapsed(saved);
    } catch {}
  }, []);

  function toggleCollapse(chapterId) {
    setCollapsed((prev) => {
      const next = prev.includes(chapterId)
        ? prev.filter((id) => id !== chapterId)
        : [...prev, chapterId];
      try {
        localStorage.setItem("moji-collapsed-v1", JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  // 点击菜单外部时关闭
  useEffect(() => {
    if (!menuOpen && !exportOpen) return;
    function onClickOutside(e) {
      if (!e.target.closest(".topbar__user, .topbar__menu")) setMenuOpen(false);
      if (!e.target.closest(".topbar__export, .topbar__exportMenu")) setExportOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen, exportOpen]);

  // 切换章节/小节时，把内容填入编辑器
  useEffect(() => {
    if (editorRef.current && activeLeaf) {
      editorRef.current.innerText = activeLeaf.content;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, book?.title]);

  // 实时字数
  const totalWords = chapters.reduce(
    (sum, c) =>
      sum +
      countWords(c.content) +
      (c.sections?.reduce((s, sec) => s + countWords(sec.content), 0) ?? 0),
    0
  );
  const chapterWords = chapter
    ? countWords(chapter.content) +
      (chapter.sections?.reduce((s, sec) => s + countWords(sec.content), 0) ?? 0)
    : 0;

  // 编辑输入：更新本地状态并防抖 PATCH 到数据库
  function handleInput(e) {
    const text = e.currentTarget.innerText;
    const leafId = active.sectionId ?? active.chapterId;
    if (!leafId) return;
    setSaveState("saving");
    setChapters((prev) => updateInTree(prev, leafId, (n) => ({ ...n, content: text })));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await fetch(`/api/chapters/${leafId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        const s = await (await fetch("/api/stats")).json();
        setTodayWords(s.today);
      } finally {
        setSaveState("saved");
      }
    }, 800);
  }

  function selectLeaf(chapterId, sectionId = null) {
    setActive({ chapterId, sectionId });
  }

  async function handleAddChapter() {
    const res = await fetch("/api/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id, title: `第${chapters.length + 1}章：未命名` }),
    });
    const data = await res.json();
    if (!data.ok) return;
    await refreshTree();
    setActive({ chapterId: data.id, sectionId: null });
  }

  async function handleRename(leaf) {
    const title = window.prompt("重命名", leaf.title);
    if (title === null || !title.trim() || title === leaf.title) return;
    setChapters((prev) => updateInTree(prev, leaf.id, (n) => ({ ...n, title })));
    await fetch(`/api/chapters/${leaf.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
  }

  async function handleDelete(leaf) {
    if (!window.confirm(`确定将「${leaf.title}」移入回收站吗？`)) return;
    await fetch(`/api/chapters/${leaf.id}`, { method: "DELETE" });
    if (leaf.id === active.chapterId || leaf.id === active.sectionId) {
      const first = chapters.find((c) => c.id !== leaf.id);
      setActive(first ? { chapterId: first.id, sectionId: null } : { chapterId: null, sectionId: null });
    }
    refreshTree();
  }

  async function fetchTrash() {
    const res = await fetch("/api/trash");
    const data = await res.json();
    setTrashItems(data.items ?? []);
  }

  function toggleTrash() {
    setTrashOpen((v) => {
      if (!v) fetchTrash();
      return !v;
    });
  }

  async function handleRestore(id) {
    await fetch(`/api/chapters/${id}/restore`, { method: "POST" });
    await fetchTrash();
    refreshTree();
  }

  async function handlePurge(id) {
    if (!window.confirm("彻底删除后无法恢复，确定吗？")) return;
    await fetch(`/api/chapters/${id}?permanent=1`, { method: "DELETE" });
    await fetchTrash();
    refreshTree();
  }

  // ===== 卡片笔记 / 剧情大纲 =====
  const activeCards = activeTab === "notes" ? cards.notes : cards.outline;

  function updateCardLocal(cardId, patch) {
    setCards((prev) => ({
      ...prev,
      [activeTab]: prev[activeTab].map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
    }));
  }

  function handleCardBodyBlur(card, e) {
    const body = e.currentTarget.innerText;
    if (body === card.body) return;
    updateCardLocal(card.id, { body });
    fetch(`/api/cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  }

  async function handleCardRename(card) {
    const title = window.prompt("重命名卡片", card.title);
    if (title === null || !title.trim() || title === card.title) return;
    updateCardLocal(card.id, { title: title.trim() });
    await fetch(`/api/cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
  }

  async function handleAddCard() {
    const title = window.prompt("新卡片名称：", "未命名卡片");
    if (title === null || !title.trim()) return;
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id, tab: activeTab, title: title.trim() }),
    });
    const data = await res.json();
    if (!data.ok) return;
    setCards((prev) => ({
      ...prev,
      [activeTab]: [...prev[activeTab], { id: data.id, title: title.trim(), body: "" }],
    }));
  }

  // ===== 拖拽排序 =====
  const [dragItem, setDragItem] = useState(null); // {id, parentId}
  const [dropHint, setDropHint] = useState(null); // {id, before}

  function sortByIds(list, ids) {
    const map = new Map(list.map((x) => [x.id, x]));
    return ids.map((id) => map.get(id)).filter(Boolean);
  }

  function handleDragStart(e, item, parentId = null) {
    setDragItem({ id: item.id, parentId });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  }

  function handleDragOver(e, item, parentId = null) {
    if (!dragItem || dragItem.parentId !== parentId || dragItem.id === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropHint((prev) =>
      prev && prev.id === item.id && prev.before === before ? prev : { id: item.id, before }
    );
  }

  function handleDropCommit(e, list, parentId = null) {
    e.preventDefault();
    if (!dragItem || !dropHint) return;
    const ids = list.map((x) => x.id).filter((id) => id !== dragItem.id);
    let targetIndex = ids.indexOf(dropHint.id);
    if (!dropHint.before) targetIndex += 1;
    ids.splice(targetIndex, 0, dragItem.id);

    if (parentId) {
      setChapters((prev) =>
        prev.map((c) => (c.id === parentId ? { ...c, sections: sortByIds(c.sections ?? [], ids) } : c))
      );
    } else {
      setChapters((prev) => sortByIds(prev, ids));
    }
    fetch("/api/chapters/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setDragItem(null);
    setDropHint(null);
  }

  function handleDragEnd() {
    setDragItem(null);
    setDropHint(null);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  function downloadFile(filename, text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportChapter() {
    if (!activeLeaf) return;
    const head = section
      ? `# ${chapter.title}\n\n## ${section.title}\n\n`
      : `# ${chapter.title}\n\n`;
    downloadFile(`${activeLeaf.title}.md`, head + (activeLeaf.content ?? ""));
    setExportOpen(false);
  }

  function exportBook() {
    const lines = [`# ${book.title}`, ""];
    chapters.forEach((ch) => {
      lines.push(`## ${ch.title}`, "", ch.content ?? "", "");
      (ch.sections ?? []).forEach((sec) => {
        lines.push(`### ${sec.title}`, "", sec.content ?? "", "");
      });
    });
    downloadFile(`${book.title}.md`, lines.join("\n"));
    setExportOpen(false);
  }

  if (!book) {
    return (
      <div className="editor">
        <p className="editor-loading">加载中…</p>
      </div>
    );
  }

  return (
    <div className="editor">
      {/* ===== 顶部栏 ===== */}
      <header className="topbar">
        <div className="topbar__left">
          <Link className="topbar__brand" href="/shelf" title="返回书架">
            <span className="topbar__logoMark">墨</span>
            <span className="topbar__brandName">墨迹 MoJi</span>
          </Link>
          <img src="/assets/2_56/1.svg" alt="" width="1" height="32" />
          <button className="topbar__book">
            <img src="/assets/2_56/2.svg" alt="" width="16" height="16" />
            <span>{book.title}</span>
            <img src="/assets/2_56/3.svg" alt="" width="12" height="12" />
          </button>
        </div>

        <div className="topbar__center">
          <span className="topbar__wordCount">
            全书字数：<strong>{formatWords(totalWords)}</strong>
          </span>
          <img src="/assets/2_56/4.svg" alt="" width="1" height="12" />
          <span className="topbar__today" title="今日新增字数">
            今日 <strong>+{formatWords(todayWords)}</strong>
          </span>
          <img src="/assets/2_56/4.svg" alt="" width="1" height="12" />
          <span className="topbar__saved" data-state={saveState}>
            <img src="/assets/2_56/5.svg" alt="" width="12" height="12" />
            {saveState === "saving" ? "保存中…" : "已自动保存"}
          </span>
        </div>

        <div className="topbar__right">
          <div className="topbar__export">
            <button className="topbar__exportBtn" onClick={() => setExportOpen((v) => !v)}>
              导出
            </button>
            {exportOpen && (
              <div className="topbar__exportMenu">
                <button onClick={exportChapter} disabled={!activeLeaf}>
                  导出本章 Markdown
                </button>
                <button onClick={exportBook}>导出全书 Markdown</button>
              </div>
            )}
          </div>
          <img src="/assets/2_56/6.svg" alt="历史版本" width="18" height="18" />
          <img src="/assets/2_56/7.svg" alt="设置" width="18" height="18" />
          <img src="/assets/2_56/8.svg" alt="更多" width="18" height="18" />
          <button className="topbar__user" onClick={() => setMenuOpen((v) => !v)}>
            <img src="/assets/2_56/9.svg" alt="" width="88" height="32" />
            <span>{user?.name ?? "墨客"}</span>
            <img src="/assets/2_56/10.svg" alt="" width="12" height="12" />
          </button>
          {menuOpen && (
            <div className="topbar__menu">
              <div className="topbar__menuInfo">
                <p className="topbar__menuName">{user?.name ?? "墨客"}</p>
                <p className="topbar__menuEmail">{user?.email ?? "未登录"}</p>
              </div>
              <label className="topbar__menuTheme">
                <span>暗色模式</span>
                <input type="checkbox" checked={theme === "dark"} onChange={toggleTheme} />
              </label>
              <button className="topbar__menuLogout" onClick={handleLogout}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="editor-body">
        {/* ===== 左侧大纲目录 ===== */}
        <aside className="outline">
          <div className="outline__header">
            <h3>大纲目录</h3>
            <div className="outline__actions">
              <img src="/assets/2_56/11.svg" alt="搜索" width="16" height="16" />
              <button onClick={handleAddChapter} title="新建章节">
                <img src="/assets/2_56/12.svg" alt="新建章节" width="16" height="16" />
              </button>
            </div>
          </div>

          <div className="outline__bookCard">
            <img src="/assets/2_56/13.svg" alt="" width="18" height="18" />
            <div>
              <p className="outline__bookTitle">{book.title}</p>
              <p className="outline__bookMeta">
                共 {chapters.length} 章 · {formatWan(totalWords)}
              </p>
            </div>
          </div>

          <nav className="outline__chapters">
            {chapters.map((ch) => {
              const words =
                countWords(ch.content) +
                (ch.sections?.reduce((s, sec) => s + countWords(sec.content), 0) ?? 0);
              const chapterActive = ch.id === active.chapterId && !active.sectionId;
              return (
                <div key={ch.id}>
                  <div
                    className={`outline__chapterRow${
                      dragItem?.id === ch.id ? " is-dragging" : ""
                    }${
                      dropHint?.id === ch.id ? (dropHint.before ? " drop-above" : " drop-below") : ""
                    }`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, ch)}
                    onDragOver={(e) => handleDragOver(e, ch)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDropCommit(e, chapters)}
                  >
                    <button
                      className={`outline__chapter${
                        chapterActive || (ch.sections && ch.id === active.chapterId) ? " is-active" : ""
                      }`}
                      onClick={() => selectLeaf(ch.id)}
                      onDoubleClick={() => handleRename(ch)}
                    >
                      {ch.sections?.length > 0 ? (
                        <span
                          className={`outline__chevron${collapsed.includes(ch.id) ? "" : " is-open"}`}
                          title={collapsed.includes(ch.id) ? "展开小节" : "折叠小节"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(ch.id);
                          }}
                        >
                          <img src="/assets/2_56/3.svg" alt="" width="12" height="12" />
                        </span>
                      ) : (
                        <img
                          src={`/assets/2_56/${chapterIcons[ch.id] ?? 14}.svg`}
                          alt=""
                          width="12"
                          height="12"
                        />
                      )}
                      <span className="outline__chapterTitle">{ch.title}</span>
                      <em>{formatWords(words)} 字</em>
                    </button>
                    <button
                      className="outline__delete"
                      title="移入回收站"
                      onClick={() => handleDelete(ch)}
                    >
                      ×
                    </button>
                  </div>
                  {ch.sections?.length > 0 && !collapsed.includes(ch.id) && (
                    <div className="outline__sections">
                      {ch.sections.map((sec) => (
                        <div
                          key={sec.id}
                          className={`outline__chapterRow${
                            dragItem?.id === sec.id ? " is-dragging" : ""
                          }${
                            dropHint?.id === sec.id
                              ? dropHint.before
                                ? " drop-above"
                                : " drop-below"
                              : ""
                          }`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, sec, ch.id)}
                          onDragOver={(e) => handleDragOver(e, sec, ch.id)}
                          onDragEnd={handleDragEnd}
                          onDrop={(e) => handleDropCommit(e, ch.sections ?? [], ch.id)}
                        >
                          <button
                            className={`outline__section${
                              sec.id === active.sectionId ? " is-active" : ""
                            }`}
                            onClick={() => selectLeaf(ch.id, sec.id)}
                            onDoubleClick={() => handleRename(sec)}
                          >
                            <span>{sec.title}</span>
                            <img
                              src={`/assets/2_56/${sectionIcons[sec.id] ?? 17}.svg`}
                              alt=""
                              width="12"
                              height="12"
                            />
                          </button>
                          <button
                            className="outline__delete"
                            title="移入回收站"
                            onClick={() => handleDelete(sec)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {trashOpen && (
            <div className="trashPanel">
              <p className="trashPanel__title">回收站</p>
              {trashItems.length === 0 ? (
                <p className="trashPanel__empty">回收站是空的</p>
              ) : (
                trashItems.map((item) => (
                  <div className="trashPanel__item" key={item.id}>
                    <span className="trashPanel__name">{item.title}</span>
                    <button onClick={() => handleRestore(item.id)}>恢复</button>
                    <button className="trashPanel__purge" onClick={() => handlePurge(item.id)}>
                      彻底删除
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <button className="outline__trash" onClick={toggleTrash}>
            <img src="/assets/2_56/22.svg" alt="" width="16" height="16" />
            <span>回收站</span>
          </button>
        </aside>

        {/* ===== 中间编辑区 ===== */}
        <main className="canvas">
          <article className="manuscript">
            <header className="manuscript__head">
              <h1
                className="manuscript__title"
                title="双击重命名"
                onDoubleClick={() => activeLeaf && handleRename(activeLeaf)}
              >
                {activeLeaf?.title ?? "未选择章节"}
              </h1>
              <p className="manuscript__meta">
                发布状态：<strong className="manuscript__status">草稿</strong>
                <img src="/assets/2_56/23.svg" alt="" width="1" height="12" />
                本章字数：<strong>{formatWords(chapterWords)} 字</strong>
              </p>
            </header>
            <div
              ref={editorRef}
              key={activeKey}
              className="manuscript__body"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onInput={handleInput}
              aria-label="稿件编辑区"
            />
          </article>

          <div className="toolbar">
            {toolbarIcons.map((n) => (
              <img key={n} src={`/assets/2_56/${n}.svg`} alt="" width="16" height="16" />
            ))}
          </div>
        </main>

        {/* ===== 右侧卡片面板 ===== */}
        <aside className="cards">
          <div className="cards__tabs">
            <button
              className={`cards__tab${activeTab === "notes" ? " is-active" : ""}`}
              onClick={() => setActiveTab("notes")}
            >
              卡片笔记
            </button>
            <button
              className={`cards__tab${activeTab === "outline" ? " is-active" : ""}`}
              onClick={() => setActiveTab("outline")}
            >
              剧情大纲
            </button>
          </div>

          {activeTab === "notes" ? (
            <div className="cards__list">
              <button className="cards__add" onClick={handleAddCard} title="新增卡片">
                ＋ 新增卡片
              </button>
              {activeCards.map((card) => (
                <section className="card" key={card.id}>
                  <header className="card__head">
                    <div
                      className="card__title"
                      title="双击重命名"
                      onDoubleClick={() => handleCardRename(card)}
                    >
                      <img src="/assets/2_56/34.svg" alt="" width="14" height="14" />
                      <span>{card.title}</span>
                    </div>
                    <img src="/assets/2_56/35.svg" alt="更多" width="12" height="12" />
                  </header>
                  <hr className="card__divider" />
                  <div
                    className="card__body card__body--edit"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(e) => handleCardBodyBlur(card, e)}
                  >
                    {card.body}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="cards__list">
              <button className="cards__add" onClick={handleAddCard} title="新增卡片">
                ＋ 新增卡片
              </button>
              {activeCards.map((card) => (
                <section className="card" key={card.id}>
                  <header className="card__head">
                    <div
                      className="card__title"
                      title="双击重命名"
                      onDoubleClick={() => handleCardRename(card)}
                    >
                      <img src="/assets/2_56/36.svg" alt="" width="14" height="14" />
                      <span>{card.title}</span>
                    </div>
                    <img src="/assets/2_56/37.svg" alt="更多" width="12" height="12" />
                  </header>
                  <hr className="card__divider" />
                  <div
                    className="card__body card__body--edit"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(e) => handleCardBodyBlur(card, e)}
                  >
                    {card.body}
                  </div>
                </section>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="editor">
          <p className="editor-loading">加载中…</p>
        </div>
      }
    >
      <EditorInner />
    </Suspense>
  );
}
