/**
 * 初始化数据脚本
 *
 * 用法：
 *   npm run seed              创建演示账号和示例书籍（已存在则跳过，幂等）
 *   npm run seed -- --reset   先清空 .data 目录再初始化（危险：会删除所有数据）
 *
 * 可用环境变量覆盖默认值：
 *   SEED_EMAIL / SEED_PASSWORD / SEED_NAME
 */
import fs from "fs";
import path from "path";
import { createUser, findUser } from "../lib/auth.js";
import { getOrCreateBookForUser, getChapterTree } from "../lib/books.js";

const args = process.argv.slice(2);
const DATA_DIR = path.join(process.cwd(), ".data");

if (args.includes("--reset")) {
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log("✓ 已清空 .data 目录");
  } else {
    console.log("· .data 目录不存在，跳过清空");
  }
}

// 1. 演示用户
const email = (process.env.SEED_EMAIL ?? "demo@moji.app").toLowerCase();
const password = process.env.SEED_PASSWORD ?? "moji123456";
const name = process.env.SEED_NAME ?? "墨客";

if (findUser(email)) {
  console.log(`· 用户已存在：${email}（跳过创建）`);
} else {
  createUser({ email, name, password });
  console.log(`✓ 已创建用户：${name} <${email}>，密码：${password}`);
}

// 2. 示例书籍（含 5 章 + 第三章 3 个小节）
const book = getOrCreateBookForUser(email);
const chapters = getChapterTree(book.id);

console.log(`✓ 已就绪书籍：《${book.title}》共 ${chapters.length} 章`);
chapters.forEach((c) =>
  console.log(
    `   - ${c.title}${c.sections?.length ? `（含 ${c.sections.length} 小节）` : ""}`
  )
);

console.log("\n完成！运行 npm run dev，然后用该账号登录即可看到初始数据。");
