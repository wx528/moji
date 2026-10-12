import { verifySession } from "@/lib/auth";
import { getBookForUser } from "@/lib/books";
import { buildLore } from "@/lib/lore";

// 世界观检查：当前章节正文 vs 本书设定卡/剧情大纲，返回结构化冲突清单
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

  const content = String(body.content ?? "").slice(0, 8000); // 检查整章，超长截断
  const bookId = String(body.bookId ?? "");

  if (!content.trim()) {
    return Response.json({ error: "当前章节还没有正文可检查" }, { status: 400 });
  }

  const book = bookId ? getBookForUser(email, bookId) : null;
  const lore = book ? buildLore(book) : "";
  if (!lore.trim()) {
    return Response.json(
      { error: "这本书还没有任何设定卡，先在右侧面板写几条设定再检查" },
      { status: 400 }
    );
  }

  const messages = [
    {
      role: "system",
      content:
        "你是一位中文小说的设定一致性审校员。对照【设定资料】逐条检查【正文】，找出：与设定直接矛盾、违反世界观规则、人物性格/能力/身份/关系不符的问题。" +
        "只报告有明确依据的问题，不要脑补推测，正文没写到的内容不算问题。" +
        "每条问题包含：severity（'矛盾'=与设定直接冲突，'存疑'=可能冲突需作者确认）、quote（出问题的正文原句，尽量短）、card（冲突的设定来源，形如《卡片标题》）、reason（为什么与设定冲突）、suggestion（一句话修改建议）。" +
        '完全没有问题时 issues 为空数组。严格只输出 JSON：{"issues":[...],"summary":"一句话总体结论"}，不要输出 JSON 以外的任何内容。',
    },
    {
      role: "user",
      content: `【设定资料】${lore}\n\n【正文】\n${content}\n\n请检查以上正文与设定的一致性，输出 JSON。`,
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
        temperature: 0.2,
        max_tokens: 3000,
        // MiniMax M 系列默认开思考且思考内容混在正文字段里，必须关掉
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

  const text = (await upstream.json())?.choices?.[0]?.message?.content ?? "";

  // 解析 JSON（容忍 ```json 代码块包裹或前后杂讯）
  let parsed = null;
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      parsed = JSON.parse(m[0]);
    } catch {}
  }
  if (!parsed || !Array.isArray(parsed.issues)) {
    return Response.json({ error: "AI 返回格式异常，请重试" }, { status: 502 });
  }

  const issues = parsed.issues.slice(0, 20).map((it) => ({
    severity: it.severity === "矛盾" ? "矛盾" : "存疑",
    quote: String(it.quote ?? "").slice(0, 200),
    card: String(it.card ?? "").slice(0, 60),
    reason: String(it.reason ?? "").slice(0, 300),
    suggestion: String(it.suggestion ?? "").slice(0, 200),
  }));

  return Response.json({
    issues,
    summary: String(parsed.summary ?? "").slice(0, 200),
  });
}
