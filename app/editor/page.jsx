"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { mojiConfirm, mojiPrompt } from "../moji-dialog";
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

  // ===== AI 续写 =====
  const [aiWords, setAiWords] = useState(300);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const aiAbortRef = useRef(null);

  function caretToEnd() {
    const el = editorRef.current;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function handleContinue() {
    if (aiStreaming) {
      aiAbortRef.current?.abort();
      return;
    }
    const el = editorRef.current;
    if (!activeLeaf || !el) return;
    setAiMsg("");

    // 光标不在编辑区时，移到文末再续写
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) caretToEnd();
    el.focus();

    setAiStreaming(true);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const res = await fetch("/api/ai/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: el.innerText,
          bookId: book.id,
          bookTitle: book.title,
          chapterTitle: activeLeaf.title,
          words: aiWords,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setAiMsg(data?.error ?? `请求失败（${res.status}）`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (evt.error) {
            setAiMsg(evt.error);
            controller.abort();
            return;
          }
          if (evt.done) return;
          // 在光标处流式插入，触发 onInput → 走既有自动保存链路
          if (evt.delta) document.execCommand("insertText", false, evt.delta);
        }
      }
    } catch (e) {
      if (e?.name !== "AbortError") setAiMsg("续写中断，请重试");
    } finally {
      setAiStreaming(false);
      aiAbortRef.current = null;
    }
  }

  // ===== 世界观检查 =====
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const checkAbortRef = useRef(null);

  async function handleCheck() {
    if (checkLoading) {
      checkAbortRef.current?.abort();
      return;
    }
    const el = editorRef.current;
    if (!activeLeaf || !el) return;
    setAiMsg("");
    setCheckLoading(true);
    const controller = new AbortController();
    checkAbortRef.current = controller;
    try {
      const res = await fetch("/api/ai/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: el.innerText, bookId: book.id }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAiMsg(data?.error ?? `请求失败（${res.status}）`);
        return;
      }
      setCheckResult(data);
      setCheckOpen(true);
    } catch (e) {
      if (e?.name !== "AbortError") setAiMsg("检查中断，请重试");
    } finally {
      setCheckLoading(false);
      checkAbortRef.current = null;
    }
  }

  // ===== AI 编排（计划驱动的节级长篇生成）=====
  const [orchOpen, setOrchOpen] = useState(false);
  const [orchRunning, setOrchRunning] = useState(false);
  const [orchLog, setOrchLog] = useState([]); // [{key, text, tone}]
  const [orchPreview, setOrchPreview] = useState("");
  const [orchWords, setOrchWords] = useState(800);
  const [orchPlanText, setOrchPlanText] = useState("");
  const [orchExtra, setOrchExtra] = useState("");
  const orchAbortRef = useRef(null);

  function pushOrchLog(text, tone = "info") {
    setOrchLog((prev) => [...prev, { key: `${Date.now()}_${Math.random()}`, text, tone }]);
  }

  function openOrch() {
    if (orchRunning) return;
    setOrchLog([]);
    setOrchPreview("");
    setOrchOpen(true);
  }

  async function handleOrchestrate() {
    setOrchRunning(true);
    setOrchLog([]);
    setOrchPreview("");
    const addedLocal = [];
    const controller = new AbortController();
    orchAbortRef.current = controller;
    try {
      const res = await fetch("/api/ai/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId: book.id,
          words: orchWords,
          planText: orchPlanText,
          extra: orchExtra,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        pushOrchLog(data?.error ?? `请求失败（${res.status}）`, "error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (evt.error) {
            pushOrchLog(evt.error, "error");
            continue;
          }
          if (evt.aborted) {
            pushOrchLog("已停止（已生成的章节会保留）", "warn");
            continue;
          }
          if (evt.done) {
            pushOrchLog(
              evt.arcsLeft > 0
                ? `本节完成，还剩 ${evt.arcsLeft} 节未写——再次点「开始编排」继续下一节`
                : "全书计划完成！可删除右侧「AI 生成计划」卡片后重新规划",
              "ok"
            );
            continue;
          }
          switch (evt.stage) {
            case "ping":
              break;
            case "planGen":
              pushOrchLog("正在生成全书计划…", "info");
              break;
            case "plan":
              pushOrchLog(
                `全书计划：${evt.arcs.length} 节（${evt.arcs
                  .map((a) => `${a.title}×${a.chapters}章`)
                  .join("、")}）${evt.note ? ` — ${evt.note}` : ""}`,
                "plan"
              );
              break;
            case "planExists":
              pushOrchLog(
                `检测到已有计划：${evt.arcs.length} 节，${evt.arcs.filter((a) => a.done).length} 节已完成，从中断处继续`,
                "plan"
              );
              break;
            case "arc":
              setOrchPreview("");
              pushOrchLog(
                `—— 第 ${evt.index}/${evt.total} 节《${evt.title}》（${evt.chapters} 章）——`,
                "head"
              );
              break;
            case "sample":
              pushOrchLog(
                evt.titles.length
                  ? `本节灵感池：随机回顾 ${evt.titles.join("、")}`
                  : "暂无可回顾的旧章节，直接依据设定构思",
                "info"
              );
              break;
            case "summary":
              pushOrchLog(`灵感摘要完成（${evt.summaries.length} 份），本节内共享`, "info");
              break;
            case "resume":
              pushOrchLog(`断点续跑：本节已有 ${evt.skip} 章，从第 ${evt.skip + 1} 章继续`, "warn");
              break;
            case "round":
              setOrchPreview("");
              pushOrchLog(`第 ${evt.round}/${evt.total} 章`, "info");
              break;
            case "beat":
              pushOrchLog(`梗概：《${evt.plan.title}》`, "plan");
              if (evt.plan.twist) pushOrchLog(`变数：${evt.plan.twist}`, "plan");
              break;
            case "write":
              if (evt.replace) setOrchPreview(evt.delta);
              else setOrchPreview((p) => p + evt.delta);
              break;
            case "rewrite":
              pushOrchLog("自检发现矛盾，按建议重写中…", "warn");
              break;
            case "check":
              pushOrchLog(
                evt.conflicts
                  ? `设定自检：发现 ${evt.conflicts} 处矛盾`
                  : "设定自检：未发现矛盾",
                evt.conflicts ? "warn" : "ok"
              );
              break;
            case "saved":
              addedLocal.push({ id: evt.id, title: evt.title });
              pushOrchLog(`已入库：《${evt.title}》（${formatWords(evt.words)} 字）`, "ok");
              break;
            case "arcdone":
              pushOrchLog(`第 ${evt.index} 节完成，进度已写入计划卡片`, "ok");
              break;
          }
        }
      }
    } catch (e) {
      if (e?.name === "AbortError")
        pushOrchLog("已停止（已生成内容保留，再次开始可从断点续写）", "warn");
      else pushOrchLog("编排中断，请重试（进度已保留，可直接续跑）", "error");
    } finally {
      setOrchRunning(false);
      orchAbortRef.current = null;
      await refreshTree();
      if (addedLocal.length) {
        // 新章节是小节（挂在「第X节」下），需定位其父级才能正确选中
        const last = addedLocal[addedLocal.length - 1];
        try {
          const data = await fetch(`/api/book${bookId ? `?bookId=${bookId}` : ""}`).then((r) =>
            r.ok ? r.json() : null
          );
          const parent = (data?.chapters ?? []).find(
            (c) => c.id === last.id || c.sections?.some((s) => s.id === last.id)
          );
          if (parent) {
            setActive(
              parent.id === last.id
                ? { chapterId: last.id, sectionId: null }
                : { chapterId: parent.id, sectionId: last.id }
            );
          }
        } catch {}
      }
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && setTodayWords(s.today))
        .catch(() => {});
    }
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
    const title = await mojiPrompt({ label: "重命名", initial: leaf.title });
    if (title === null || !title.trim() || title === leaf.title) return;
    setChapters((prev) => updateInTree(prev, leaf.id, (n) => ({ ...n, title })));
    await fetch(`/api/chapters/${leaf.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
  }

  async function handleDelete(leaf) {
    const ok = await mojiConfirm({
      label: `确定将「${leaf.title}」移入回收站吗？`,
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
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
    const ok = await mojiConfirm({
      label: "彻底删除后无法恢复，确定吗？",
      confirmText: "彻底删除",
      danger: true,
    });
    if (!ok) return;
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
    const title = await mojiPrompt({ label: "重命名卡片", initial: card.title });
    if (title === null || !title.trim() || title === card.title) return;
    updateCardLocal(card.id, { title: title.trim() });
    await fetch(`/api/cards/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
  }

  async function handleAddCard() {
    const title = await mojiPrompt({ label: "新卡片名称：", initial: "未命名卡片" });
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
            <span className="toolbar__divider" />
            <select
              className="toolbar__aiWords"
              value={aiWords}
              onChange={(e) => setAiWords(Number(e.target.value))}
              disabled={aiStreaming}
              title="续写字数"
            >
              <option value={100}>100字</option>
              <option value={300}>300字</option>
              <option value={500}>500字</option>
            </select>
            <button
              className="toolbar__aiBtn"
              data-streaming={aiStreaming}
              onClick={handleContinue}
              disabled={!activeLeaf}
              title={aiStreaming ? "停止续写" : "AI 续写：在光标处接着往下写"}
            >
              {aiStreaming ? "停止" : "续写"}
            </button>
            <span className="toolbar__divider" />
            <button
              className="toolbar__aiBtn"
              data-streaming={checkLoading}
              onClick={handleCheck}
              disabled={!activeLeaf}
              title="世界观检查：对照设定卡与剧情大纲找冲突"
            >
              {checkLoading ? "停止" : "设定检查"}
            </button>
            <span className="toolbar__divider" />
            <button
              className="toolbar__aiBtn"
              data-streaming={orchRunning}
              onClick={openOrch}
              title="AI 编排：随机回顾旧章 → 规划梗概 → 自动撰写新章节"
            >
              {orchRunning ? "编排中…" : "AI 编排"}
            </button>
            {aiMsg && (
              <span className="toolbar__aiMsg" title={aiMsg}>
                {aiMsg}
              </span>
            )}
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

      {/* ===== AI 编排弹窗 ===== */}
      {orchOpen && (
        <div className="checkModal orchModal" onClick={() => !orchRunning && setOrchOpen(false)}>
          <div className="checkModal__panel orchModal__panel" onClick={(e) => e.stopPropagation()}>
            <header className="checkModal__head">
              <h3>AI 编排 · 长篇生成</h3>
              <button
                className="checkModal__close"
                onClick={() => !orchRunning && setOrchOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </header>

            {!orchRunning && orchLog.length === 0 ? (
              <div className="orchModal__form">
                <label className="orchModal__field orchModal__field--col">
                  <span>总体计划（首次必填，留空则续跑已有计划）</span>
                  <textarea
                    className="orchModal__planText"
                    value={orchPlanText}
                    onChange={(e) => setOrchPlanText(e.target.value)}
                    maxLength={500}
                    placeholder="例：写 5 大节、每节 10 章：第一节流亡与启程，第二节暗流与背叛……；或：续写 2 节，每节 5 章，围绕信号的真相展开"
                  />
                </label>
                <label className="orchModal__field">
                  <span>每章字数</span>
                  <select
                    value={orchWords}
                    onChange={(e) => setOrchWords(Number(e.target.value))}
                  >
                    <option value={500}>约 500 字</option>
                    <option value={800}>约 800 字</option>
                    <option value={1200}>约 1200 字</option>
                    <option value={2000}>约 2000 字</option>
                  </select>
                </label>
                <label className="orchModal__field orchModal__field--col">
                  <span>补充要求（可选）</span>
                  <textarea
                    value={orchExtra}
                    onChange={(e) => setOrchExtra(e.target.value)}
                    maxLength={200}
                    placeholder="例：节奏放缓，偏重人物内心；多用对话推进……"
                  />
                </label>
                <p className="orchModal__hint">
                  编排者按你的计划把全书拆成若干「大节」，本次生成第一个未完成的节：节开始时随机抽 2~3 章旧文建立本节灵感池（节内共享），
                  逐章按计划出梗概（含变数方向）并撰写正文，与设定矛盾时自动重写一次，完成后写入「AI 生成计划」大纲卡片。
                  中途停止进度保留，再次开始自动断点续写；一次跑完一节，想写下一节就再点一次。
                </p>
                <button className="orchModal__start" onClick={handleOrchestrate}>
                  开始编排
                </button>
              </div>
            ) : (
              <div className="orchModal__progress">
                <ul className="orchModal__log">
                  {orchLog.map((it) => (
                    <li key={it.key} data-tone={it.tone}>
                      {it.text}
                    </li>
                  ))}
                </ul>
                {orchPreview && (
                  <pre className="orchModal__preview">
                    {orchPreview.slice(-500)}
                    {orchRunning ? " ▍" : ""}
                  </pre>
                )}
                {orchRunning ? (
                  <button
                    className="orchModal__stop"
                    onClick={() => orchAbortRef.current?.abort()}
                  >
                    停止
                  </button>
                ) : (
                  <button className="orchModal__start" onClick={() => setOrchOpen(false)}>
                    完成，关闭
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 世界观检查结果弹窗 ===== */}
      {checkOpen && checkResult && (
        <div className="checkModal" onClick={() => setCheckOpen(false)}>
          <div className="checkModal__panel" onClick={(e) => e.stopPropagation()}>
            <header className="checkModal__head">
              <h3>世界观检查</h3>
              <button className="checkModal__close" onClick={() => setCheckOpen(false)} aria-label="关闭">
                ×
              </button>
            </header>
            <p className="checkModal__summary">{checkResult.summary}</p>
            {checkResult.issues.length ? (
              <ul className="checkModal__list">
                {checkResult.issues.map((it, i) => (
                  <li className="checkModal__item" data-sev={it.severity} key={i}>
                    <div className="checkModal__itemHead">
                      <span className="checkModal__sev">{it.severity}</span>
                      <span className="checkModal__card">{it.card}</span>
                    </div>
                    {it.quote && <blockquote className="checkModal__quote">{it.quote}</blockquote>}
                    <p className="checkModal__reason">{it.reason}</p>
                    {it.suggestion && <p className="checkModal__sug">建议：{it.suggestion}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="checkModal__ok">未发现与设定卡冲突的内容。</p>
            )}
          </div>
        </div>
      )}
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
