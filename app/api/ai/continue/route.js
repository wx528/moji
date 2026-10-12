import { verifySession } from "@/lib/auth";
import { getBookForUser } from "@/lib/books";
import { buildLore } from "@/lib/lore";

// OpenAI 兼容接口（GLM / DeepSeek / Kimi / OpenAI 均可），SSE 流式转发
const BASE = (process.env.MOJI_AI_BASE || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");

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

  const words = Math.min(2000, Math.max(50, Number(body.words) || 300));
  const content = String(body.content ?? "").slice(-1500); // 只取上文尾部做上下文
  const bookTitle = String(body.bookTitle ?? "").slice(0, 60);
  const chapterTitle = String(body.chapterTitle ?? "").slice(0, 60);

  if (!content.trim()) {
    return Response.json(
      { error: "当前章节还没有正文，先写个开头再让 AI 续写吧" },
      { status: 400 }
    );
  }

  // 世界书：把这本书的设定卡（卡片笔记=世界观/角色等，剧情大纲=情节走向）注入上下文
  let lore = "";
  const bookId = String(body.bookId ?? "");
  if (bookId) {
    const book = getBookForUser(email, bookId);
    if (book) lore = buildLore(book);
  }

  const messages = [
    {
      role: "system",
      content:
        "你是一位中文写作助手，负责续写用户提供的作品片段。要求：顺着上文的情节、人称、时态、语气和文风自然衔接续写；若提供了设定卡与剧情大纲，人物性格、世界观规则、既定情节必须与其严格一致，不得矛盾；只输出续写的正文，不要重复上文，不要输出章节标题，不要任何解释、寒暄或元评论；在自然语段处收尾，篇幅遵守用户要求的字数（±20%）。",
    },
    {
      role: "user",
      content:
        `作品：《${bookTitle}》 章节：《${chapterTitle}》\n` +
        `请续写约 ${words} 字。${lore}` +
        `\n\n【上文】\n${content}\n\n【续写】`,
    },
  ];

  let upstream;
  try {
    upstream = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.8,
        max_tokens: Math.ceil(words * 2.5),
        // MiniMax M 系列默认开思考且思考内容混在正文字段里，续写场景必须关掉
        ...(/minimax/i.test(BASE) ? { thinking: { type: "disabled" } } : {}),
      }),
    });
  } catch {
    return Response.json({ error: "无法连接 AI 服务，请检查 MOJI_AI_BASE 配置" }, { status: 502 });
  }

  if (!upstream.ok) {
    let detail = "";
    try {
      detail = (await upstream.json())?.error?.message ?? "";
    } catch {}
    return Response.json(
      { error: `AI 服务返回错误（${upstream.status}）：${detail || "请检查密钥/模型名"}` },
      { status: 502 }
    );
  }

  // 把上游 OpenAI 格式 SSE 转成自己的轻量事件流
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let buf = "";
      try {
        for await (const chunk of upstream.body) {
          buf += decoder.decode(chunk, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? ""; // 最后一段可能不完整，留到下一轮
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (delta) send({ delta });
            } catch {}
          }
        }
        send({ done: true });
      } catch {
        send({ error: "生成中断，请重试" });
      } finally {
        controller.close();
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
