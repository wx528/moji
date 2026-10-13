import { verifySession } from "@/lib/auth";
import {
  getBookForUser,
  getChapterTree,
  createChapter,
  updateChapter,
  getCards,
  createCard,
  updateCard,
} from "@/lib/books";
import { buildLore } from "@/lib/lore";

// AI 编排者 0.1.7：计划驱动的节级长篇生成
// 总计划（自然语言 → 结构化 JSON，持久化到剧情大纲卡片《AI 生成计划》，跨请求续跑）
// 每次请求执行一个"大节"：节开始时抽一次灵感样本（随机 2~3 章 + 并行摘要，节内共享），
// 节内逐章：编排者按计划出梗概（注入计划状态 + 节级灵感）→ 写作 agent 流式成文
// → 设定自检（矛盾自动重写一次）→ 章节入库（大节=顶级章节，章=小节）
// 中断后再次运行：按卡片进度 + 已建章节树断点续跑（精确到章）
const BASE = (process.env.MOJI_AI_BASE || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");

const PLAN_CARD_TITLE = "AI 生成计划";
const PLAN_CARD_HEAD =
  "本卡片由 AI 编排者自动生成：全书分节创作计划，含各节主题与进度。可手动编辑，删除本卡片后可重新规划。\n";

// 有实质内容的叶子（过滤掉占位符章节）
const isReal = (t) =>
  (t ?? "").replace(/\s+/g, "").length >= 80 && !t.includes("尚未开始撰写");

// 把章节树摊平成叶子：章正文 + 带内容的小节（保持目录顺序）
function flattenLeaves(tree) {
  const leaves = [];
  for (const ch of tree) {
    if (isReal(ch.content)) leaves.push({ title: ch.title, content: ch.content });
    for (const s of ch.sections ?? []) {
      if (isReal(s.content))
        leaves.push({ title: `${ch.title} · ${s.title}`, content: s.content });
    }
  }
  return leaves;
}

async function chat(key, model, { messages, temperature, max_tokens, stream = false, signal }) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      stream,
      // MiniMax M 系列默认开思考且思考内容混在正文字段里，必须关掉
      ...(/minimax/i.test(BASE) ? { thinking: { type: "disabled" } } : {}),
    }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {}
    throw new Error(`AI 服务返回错误（${res.status}）：${detail || "请检查密钥/模型名"}`);
  }
  return res;
}

async function chatText(key, model, opts) {
  const res = await chat(key, model, { ...opts, stream: false });
  return (await res.json())?.choices?.[0]?.message?.content ?? "";
}

function parseJsonLoose(text) {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// 并行摘要 sub-agent：人物状态 / 未回收伏笔 / 情绪基调
async function summarizeChapters(key, model, sample, signal) {
  return Promise.all(
    sample.map(async (ch) => {
      const text = await chatText(key, model, {
        messages: [
          {
            role: "system",
            content:
              "你是中文小说的审读员。用约200字总结给定章节，涵盖：人物当前状态、推进的事件、埋下或未回收的伏笔、情绪基调。只输出总结正文，不要标题和任何解释。",
          },
          {
            role: "user",
            content: `【章节】《${ch.title}》\n\n${ch.content.slice(0, 6000)}\n\n请输出200字摘要。`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
        signal,
      });
      return { title: ch.title, summary: String(text).trim().slice(0, 400) };
    })
  );
}

// 读/建计划卡片，返回 { plan, cardId, created }
async function loadOrCreatePlan(key, model, book, planText, lore, leaves, signal) {
  const cards = getCards(book.id);
  const card = (cards.outline ?? []).find((c) => c.title === PLAN_CARD_TITLE);

  // 已有计划卡片：解析并续跑
  if (card) {
    const parsed = parseJsonLoose(card.body ?? "");
    if (parsed?.arcs?.length) {
      return {
        plan: parsed,
        cardId: card.id,
        created: false,
      };
    }
  }

  // 无卡片（或卡片损坏）：需要用户提供总体计划
  if (!planText.trim()) {
    throw new Error(
      card
        ? "「AI 生成计划」卡片内容无法解析，请在右侧剧情大纲面板修复或删除该卡片后重试"
        : "请先在表单中填写总体计划（例如：写 5 大节、每节 10 章，主题分别是……）"
    );
  }

  // 总编排阶段：自然语言计划 → 结构化 JSON
  const sample = [...leaves].sort(() => Math.random() - 0.5).slice(0, Math.min(leaves.length, 4));
  const summaries = sample.length ? await summarizeChapters(key, model, sample, signal) : [];

  const raw = await chatText(key, model, {
    messages: [
      {
        role: "system",
        content:
          "你是这部中文小说的总编排者。根据【设定资料】【现有内容摘要】【总体计划】，把后续故事规划为若干「大节」，每节包含指定数量的章节。要求：" +
          "1) 严格遵循用户指定的节数与每节章数（用户未明确时默认 2 节、每节 5 章）；" +
          "2) 每节 title 为 2~6 字的阶段名，brief 一段话说明本节要推进的主线、关键事件与情绪走向；" +
          "3) 与设定资料严格一致，各节整体构成完整的起承转合；" +
          "4) 规划只覆盖尚未写作的后续章节，不包含已有内容。" +
          '严格只输出 JSON：{"arcs":[{"title":"...","chapters":数字,"brief":"..."}],"note":"一句话总说明"}，不要输出其他内容。',
      },
      {
        role: "user",
        content:
          `${lore}\n\n` +
          (summaries.length
            ? `【现有内容摘要】\n${summaries.map((s) => `《${s.title}》${s.summary}`).join("\n")}\n\n`
            : "") +
          `【总体计划】\n${planText}\n\n请输出分节规划 JSON。`,
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
    signal,
  });

  const parsed = parseJsonLoose(raw);
  const arcs = (Array.isArray(parsed?.arcs) ? parsed.arcs : [])
    .map((a) => ({
      title: String(a?.title ?? "").trim().slice(0, 12) || "未命名",
      chapters: Math.min(10, Math.max(1, Number(a?.chapters) || 5)),
      brief: String(a?.brief ?? "").slice(0, 300),
      done: false,
    }))
    .slice(0, 8);
  if (!arcs.length) throw new Error("总计划生成失败：AI 未返回有效 JSON，请重试");

  const plan = { arcs, note: String(parsed?.note ?? "").slice(0, 200) };

  // 持久化到剧情大纲卡片（用户可直接查看/编辑/删除）
  const cardId = createCard({ bookId: book.id, tab: "outline", title: PLAN_CARD_TITLE });
  updateCard(cardId, { body: PLAN_CARD_HEAD + JSON.stringify(plan) });
  return { plan, cardId, created: true };
}

function savePlan(cardId, plan) {
  updateCard(cardId, { body: PLAN_CARD_HEAD + JSON.stringify(plan) });
}

export async function POST(req) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const key = process.env.MOJI_AI_KEY;
  const model = process.env.MOJI_AI_MODEL;
  if (!key || !model) {
    return Response.json(
      {
        error:
          "AI 未配置：请在项目根目录 .env.local 中设置 MOJI_AI_KEY 与 MOJI_AI_MODEL（可选 MOJI_AI_BASE，默认智谱 GLM）",
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const words = Math.min(2000, Math.max(300, Number(body.words) || 800));
  const extra = String(body.extra ?? "").slice(0, 200);
  const planText = String(body.planText ?? "").slice(0, 500);
  const book = getBookForUser(email, String(body.bookId ?? ""));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 客户端断开 → 级联取消所有上游请求
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      req.signal?.addEventListener("abort", onAbort);
      const ping = setInterval(() => send({ stage: "ping" }), 15000); // 长阶段保活

      const lore = buildLore(book);

      try {
        let tree = getChapterTree(book.id);
        let leaves = flattenLeaves(tree);
        let ending = leaves.length ? leaves[leaves.length - 1].content.slice(-600) : "";

        // ===== 总计划阶段 =====
        let cardId;
        if (lore.trim() || leaves.length || planText.trim()) {
          if (planText.trim()) send({ stage: "planGen" });
          const loaded = await loadOrCreatePlan(key, model, book, planText, lore, leaves, abort.signal);
          cardId = loaded.cardId;
          const plan = loaded.plan;
          if (loaded.created) {
            send({
              stage: "plan",
              arcs: plan.arcs.map((a) => ({ title: a.title, chapters: a.chapters, done: !!a.done })),
              note: plan.note,
            });
          } else {
            send({
              stage: "planExists",
              arcs: plan.arcs.map((a) => ({ title: a.title, chapters: a.chapters, done: !!a.done })),
            });
          }

          // 找第一个未完成的节
          const arcIdx = plan.arcs.findIndex((a) => !a.done);
          if (arcIdx === -1) {
            send({ error: "全书计划已全部完成。想重新规划，请删除右侧剧情大纲中的「AI 生成计划」卡片" });
          } else {
            const arc = plan.arcs[arcIdx];
            const arcNo = arcIdx + 1;
            send({
              stage: "arc",
              index: arcNo,
              total: plan.arcs.length,
              title: arc.title,
              chapters: arc.chapters,
            });

            // ===== 节级灵感池：节开始时抽一次样，节内共享 =====
            const shuffled = [...leaves].sort(() => Math.random() - 0.5);
            const sample = shuffled.slice(0, Math.min(shuffled.length, 2 + (Math.random() < 0.5 ? 0 : 1)));
            send({ stage: "sample", titles: sample.map((c) => c.title) });
            const summaries = await summarizeChapters(key, model, sample, abort.signal);
            send({ stage: "summary", summaries });

            // ===== 大节入库 / 断点续跑 =====
            tree = getChapterTree(book.id);
            const arcTitle = `第${arcNo}节：${arc.title}`;
            let existing = tree.find((c) => c.title === arcTitle);
            let skip = 0;
            if (existing) {
              skip = existing.sections?.length ?? 0;
              if (skip >= arc.chapters) {
                // 节已写满但未标记（上次中断在收尾前）：直接补标记
                arc.done = true;
                savePlan(cardId, plan);
                send({ stage: "arcdone", index: arcNo });
              }
            } else {
              const arcId = createChapter({ bookId: book.id, title: arcTitle });
              existing = { id: arcId, sections: [] };
            }

            if (skip < arc.chapters) {
              // 断点续跑：已写小节的最后一章结尾作为衔接
              if (skip > 0) {
                const secs = (existing.sections ?? []).filter((s) => isReal(s.content));
                if (secs.length) ending = secs[secs.length - 1].content.slice(-600);
                send({ stage: "resume", skip });
              }

              const planJson = JSON.stringify(plan.arcs.map((a) => ({
                title: a.title,
                chapters: a.chapters,
                brief: a.brief,
                done: !!a.done,
              })));
              const inspiration = summaries.length
                ? summaries.map((s) => `《${s.title}》${s.summary}`).join("\n")
                : "（暂无旧章节可回顾）";

              for (let round = skip + 1; round <= arc.chapters; round++) {
                send({ stage: "round", round, total: arc.chapters });

                // ① 编排者：按计划出梗概（计划状态 + 节级灵感注入）
                const planRaw = await chatText(key, model, {
                  messages: [
                    {
                      role: "system",
                      content:
                        `你是这部小说的编排者，正在按【全书计划】逐章推进。当前任务：为第 ${arcNo} 节《${arc.title}》的第 ${round}/${arc.chapters} 章制定梗概。要求：` +
                        "1) 严格服务本节规划（brief），只推进本节的主题与关键事件，不得提前消耗后续节的情节；" +
                        "2) 自然承接上一章结尾，并包含一个意外但合理的「变数方向」；" +
                        "3) 与设定资料严格一致；" +
                        "4) beats 给 3~5 条一句话的具体情节点；" +
                        "5) title 只出 2~8 字的意象标题，不带任何章节号。" +
                        '严格只输出 JSON：{"title":"...","beats":["..."],"twist":"一句话变数方向"}，不要输出其他内容。',
                    },
                    {
                      role: "user",
                      content:
                        `${lore}\n\n【全书计划】\n${planJson}\n\n` +
                        `【本节规划】第 ${arcNo} 节《${arc.title}》共 ${arc.chapters} 章：${arc.brief}\n\n` +
                        `【本节灵感摘要】\n${inspiration}\n\n` +
                        (ending ? `【上一章结尾】\n…${ending}\n\n` : "") +
                        (extra ? `【作者补充】${extra}\n\n` : "") +
                        `请输出第 ${arcNo} 节第 ${round} 章的梗概 JSON。`,
                    },
                  ],
                  temperature: 0.95,
                  max_tokens: 1000,
                  signal: abort.signal,
                });

                const parsedPlan = parseJsonLoose(planRaw);
                const chapterPlan = {
                  title: String(parsedPlan?.title ?? "").trim().slice(0, 20) || "无题",
                  beats: Array.isArray(parsedPlan?.beats)
                    ? parsedPlan.beats.map((b) => String(b).slice(0, 200)).slice(0, 5)
                    : [],
                  twist: String(parsedPlan?.twist ?? "").slice(0, 200),
                };
                if (!chapterPlan.beats.length) chapterPlan.beats = [planRaw.slice(0, 300)];
                send({ stage: "beat", round, plan: chapterPlan });

                // ② 写作 agent：梗概为纲，世界书为硬约束，流式输出
                const writeMessages = [
                  {
                    role: "system",
                    content:
                      `你是一位中文小说的执笔者，按给定梗概撰写完整一章正文（本节《${arc.title}》的第 ${round} 章）。要求：` +
                      "严格按【梗概】的 beats 展开并落实 twist；与【设定资料】严格一致，人物性格、世界观规则不得矛盾；" +
                      "自然衔接【上一章结尾】的情景与情绪；只输出正文，不要标题、解释或元评论；篇幅遵守字数要求（±20%），在自然段落收尾。",
                  },
                  {
                    role: "user",
                    content:
                      `${lore}\n\n【梗概】\n标题：《${chapterPlan.title}》\n` +
                      chapterPlan.beats.map((b, i) => `${i + 1}. ${b}`).join("\n") +
                      `\n变数方向：${chapterPlan.twist}\n\n` +
                      (ending ? `【上一章结尾】\n…${ending}\n\n` : "") +
                      `请撰写约 ${words} 字的正文。`,
                  },
                ];
                const upstream = await chat(key, model, {
                  messages: writeMessages,
                  temperature: 0.75,
                  max_tokens: Math.ceil(words * 2.5),
                  stream: true,
                  signal: abort.signal,
                });

                let content = "";
                {
                  const decoder = new TextDecoder();
                  let buf = "";
                  for await (const chunk of upstream.body) {
                    buf += decoder.decode(chunk, { stream: true });
                    const lines = buf.split("\n");
                    buf = lines.pop() ?? "";
                    for (const line of lines) {
                      const t = line.trim();
                      if (!t.startsWith("data:")) continue;
                      const payload = t.slice(5).trim();
                      if (payload === "[DONE]") continue;
                      try {
                        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
                        if (delta) {
                          content += delta;
                          send({ stage: "write", round, delta });
                        }
                      } catch {}
                    }
                  }
                }
                if (!content.trim()) throw new Error("写作失败：AI 未返回正文，请重试");
                ending = content.slice(-600); // 下一章衔接

                // ③ 设定自检（复用世界观检查逻辑），矛盾级自动重写一次
                if (lore.trim() && content.replace(/\s+/g, "").length >= 50) {
                  const checkRaw = await chatText(key, model, {
                    messages: [
                      {
                        role: "system",
                        content:
                          "你是中文小说的设定一致性审校员。对照【设定资料】逐条检查【正文】，只报告有明确依据的问题，不要脑补推测。" +
                          "每条问题包含：severity（'矛盾'=与设定直接冲突，'存疑'=可能冲突）、quote（正文原句）、reason（冲突原因）、suggestion（一句话修改建议）。" +
                          "没有问题时 issues 为空数组。严格只输出 JSON：{\"issues\":[...],\"summary\":\"一句话结论\"}，不要输出其他内容。",
                      },
                      {
                        role: "user",
                        content: `【设定资料】${lore}\n\n【正文】\n${content.slice(0, 8000)}\n\n请检查一致性，输出 JSON。`,
                      },
                    ],
                    temperature: 0.2,
                    max_tokens: 3000,
                    signal: abort.signal,
                  });

                  const issues = parseJsonLoose(checkRaw)?.issues ?? [];
                  const conflicts = (Array.isArray(issues) ? issues : [])
                    .filter((it) => it?.severity === "矛盾")
                    .slice(0, 5);
                  send({
                    stage: "check",
                    round,
                    conflicts: conflicts.length,
                    issues: (Array.isArray(issues) ? issues : []).slice(0, 5).map((it) => ({
                      severity: it?.severity === "矛盾" ? "矛盾" : "存疑",
                      reason: String(it?.reason ?? "").slice(0, 150),
                      suggestion: String(it?.suggestion ?? "").slice(0, 100),
                    })),
                  });

                  if (conflicts.length) {
                    send({ stage: "rewrite", round });
                    const fixed = await chatText(key, model, {
                      messages: [
                        ...writeMessages,
                        { role: "assistant", content },
                        {
                          role: "user",
                          content:
                            "以上是你写的初稿，审校发现与设定矛盾：\n" +
                            conflicts
                              .map(
                                (c, i) =>
                                  `${i + 1}. ${String(c.reason ?? "").slice(0, 150)}（建议：${String(
                                    c.suggestion ?? ""
                                  ).slice(0, 100)}）`
                              )
                              .join("\n") +
                            "\n\n请重写整章：只修正上述矛盾，保持情节、文风与篇幅基本不变。只输出修正后的完整正文。",
                        },
                      ],
                      temperature: 0.6,
                      max_tokens: Math.ceil(words * 2.5),
                      signal: abort.signal,
                    });
                    const fixedText = String(fixed).trim();
                    if (fixedText.slice(0, 50) && fixedText !== content) {
                      content = fixedText;
                      ending = content.slice(-600);
                      send({ stage: "write", round, replace: true, delta: content });
                    }
                  }
                } else {
                  send({ stage: "check", round, conflicts: 0, issues: [] });
                }

                // ④ 章节入库：大节=顶级章节，章=小节
                const chTitle = `${arcNo}.${round} ${chapterPlan.title}`;
                const id = createChapter({
                  bookId: book.id,
                  title: chTitle,
                  parentId: existing.id,
                });
                updateChapter(id, { content });
                send({
                  stage: "saved",
                  round,
                  id,
                  title: chTitle,
                  words: content.replace(/\s+/g, "").length,
                });
              }

              // ===== 节完成：更新计划进度 =====
              arc.done = true;
              savePlan(cardId, plan);
              send({ stage: "arcdone", index: arcNo });
            }

            const arcsLeft = plan.arcs.filter((a) => !a.done).length;
            send({ done: true, arcsLeft });
          }
        } else {
          send({ error: "这本书还没有设定卡或章节内容，先写点设定或正文再来编排" });
        }
      } catch (e) {
        if (abort.signal.aborted) {
          send({ aborted: true });
        } else {
          send({ error: String(e?.message ?? "编排失败，请重试").slice(0, 300) });
        }
      } finally {
        clearInterval(ping);
        req.signal?.removeEventListener("abort", onAbort);
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
