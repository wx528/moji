import { verifySession } from "@/lib/auth";
import { getBookForUser, getChapterTree, createChapter, updateChapter } from "@/lib/books";
import { buildLore } from "@/lib/lore";

// AI 编排者：多轮长篇生成流水线
// 每轮：随机抽 2~3 章旧文 → 并行摘要 sub-agent → 编排者出梗概（高温度，注入变数）
//      → 写作 agent 流式成文 → 设定自检（矛盾自动重写一次）→ 章节入库
// "sub-agent" = 同一 LLM 的不同 prompt 独立调用，服务端编排，无需 agent 框架
const BASE = (process.env.MOJI_AI_BASE || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");

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
  const rounds = Math.min(5, Math.max(1, Number(body.rounds) || 1));
  const extra = String(body.extra ?? "").slice(0, 200);
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
        const added = [];
        for (let round = 1; round <= rounds; round++) {
          const tree = getChapterTree(book.id); // 每轮重读，把刚写的章纳入上下文
          const leaves = flattenLeaves(tree);
          const chapterNo = tree.length + 1;
          const last = leaves[leaves.length - 1] ?? null;
          const ending = last ? last.content.slice(-600) : "";

          send({ stage: "round", round, total: rounds });

          // ① 随机抽 2~3 章旧文（灵感来源，也是随机性的第一来源）
          const shuffled = [...leaves].sort(() => Math.random() - 0.5);
          const sample = shuffled.slice(0, Math.min(shuffled.length, 2 + (Math.random() < 0.5 ? 0 : 1)));
          send({ stage: "sample", round, titles: sample.map((c) => c.title) });

          // ② 并行摘要 sub-agent：人物状态 / 未回收伏笔 / 情绪基调
          const summaries = await Promise.all(
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
                signal: abort.signal,
              });
              return { title: ch.title, summary: String(text).trim().slice(0, 400) };
            })
          );
          send({ stage: "summary", round, summaries });

          // ③ 编排者出梗概：高温度 + 变数方向，灵感与随机性的核心注入点
          const planRaw = await chatText(key, model, {
            messages: [
              {
                role: "system",
                content:
                  `你是这部中文小说的编排者，负责为第 ${chapterNo} 章制定梗概。综合【旧章摘要】【上一章结尾】【设定资料】` +
                  `${extra ? "与【作者补充】" : ""}，规划下一章。要求：` +
                  "1) 情节自然承接前文，同时必须包含一个意外但合理的「变数方向」，让故事有新鲜感和变数；" +
                  "2) 与设定资料严格一致，不得矛盾；" +
                  "3) beats 给 3~5 条一句话的具体情节点，可直接执行；" +
                  `4) title 形如「第${chapterNo}章：标题」。` +
                  '严格只输出 JSON：{"title":"...","beats":["..."],"twist":"一句话变数方向"}，不要输出其他内容。',
              },
              {
                role: "user",
                content:
                  `${lore}\n\n` +
                  (summaries.length
                    ? `【旧章摘要】\n${summaries.map((s) => `《${s.title}》${s.summary}`).join("\n")}\n\n`
                    : "") +
                  (ending ? `【上一章结尾】\n…${ending}\n\n` : "") +
                  (extra ? `【作者补充】${extra}\n\n` : "") +
                  `请输出第 ${chapterNo} 章梗概 JSON。`,
              },
            ],
            temperature: 0.95,
            max_tokens: 1000,
            signal: abort.signal,
          });

          const parsedPlan = parseJsonLoose(planRaw);
          const plan = {
            title: String(parsedPlan?.title ?? "").trim().slice(0, 40) || `第${chapterNo}章：新章`,
            beats: Array.isArray(parsedPlan?.beats)
              ? parsedPlan.beats.map((b) => String(b).slice(0, 200)).slice(0, 5)
              : [],
            twist: String(parsedPlan?.twist ?? "").slice(0, 200),
          };
          if (!plan.beats.length) plan.beats = [planRaw.slice(0, 300)];
          send({ stage: "plan", round, plan });

          // ④ 写作 agent：梗概为纲，世界书为硬约束，流式输出
          const writeMessages = [
            {
              role: "system",
              content:
                "你是一位中文小说的执笔者，按给定梗概撰写完整一章正文。要求：" +
                "严格按【梗概】的 beats 展开并落实 twist；与【设定资料】严格一致，人物性格、世界观规则不得矛盾；" +
                "自然衔接【上一章结尾】的情景与情绪；只输出正文，不要标题、解释或元评论；篇幅遵守字数要求（±20%），在自然段落收尾。",
            },
            {
              role: "user",
              content:
                `${lore}\n\n【梗概】\n标题：《${plan.title}》\n` +
                plan.beats.map((b, i) => `${i + 1}. ${b}`).join("\n") +
                `\n变数方向：${plan.twist}\n\n` +
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

          // ⑤ 设定自检（复用世界观检查逻辑），矛盾级自动重写一次
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
                send({ stage: "write", round, replace: true, delta: content });
              }
            }
          } else {
            send({ stage: "check", round, conflicts: 0, issues: [] });
          }

          // ⑥ 章节入库
          const id = createChapter({ bookId: book.id, title: plan.title });
          updateChapter(id, { content });
          added.push({ id, title: plan.title });
          send({
            stage: "saved",
            round,
            id,
            title: plan.title,
            words: content.replace(/\s+/g, "").length,
          });
        }
        send({ done: true, added });
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
