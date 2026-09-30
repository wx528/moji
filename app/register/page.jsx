"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import "../login.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!EMAIL_RE.test(form.email.trim())) {
      setError("请输入正确的邮箱地址");
      return;
    }
    if (form.password.length < 6) {
      setError("密码至少需要 6 位字符");
      return;
    }
    if (form.password !== form.confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "注册失败，请稍后再试");
        return;
      }
      router.push("/editor");
    } catch {
      setError("网络异常，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      {/* 左侧品牌区 */}
      <section className="login-brand">
        <div className="login-brand__logo">
          <span className="login-brand__logoMark">墨</span>
          <span className="login-brand__logoText">墨迹 MoJi</span>
        </div>
        <div className="login-brand__slogan">
          <h1>
            落笔成墨，
            <br />
            行迹皆是星河。
          </h1>
          <p>无拘创作，深邃而平静的写作空间</p>
        </div>
        <p className="login-brand__copyright">
          © 2026 墨迹写作. 让创造力在此凝聚.
        </p>
      </section>

      {/* 右侧注册表单 */}
      <section className="login-panel">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-form__head">
            <span className="login-form__logoMark">墨</span>
            <h2>创建账号</h2>
            <p>开始你的写作之旅</p>
          </div>

          {error && <p className="login-form__error" role="alert">{error}</p>}

          <div className="login-form__field">
            <label htmlFor="name">笔名</label>
            <div className="login-form__inputWrap">
              <input
                id="name"
                type="text"
                placeholder="给自己起一个响亮的笔名"
                autoComplete="nickname"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
          </div>

          <div className="login-form__field">
            <label htmlFor="email">电子邮箱</label>
            <div className="login-form__inputWrap">
              <input
                id="email"
                type="email"
                placeholder="请输入您的邮箱地址"
                autoComplete="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
          </div>

          <div className="login-form__field">
            <label htmlFor="password">设置密码</label>
            <div className="login-form__inputWrap">
              <input
                id="password"
                type="password"
                placeholder="至少 6 位字符"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
              />
            </div>
          </div>

          <div className="login-form__field">
            <label htmlFor="confirm">确认密码</label>
            <div className="login-form__inputWrap">
              <input
                id="confirm"
                type="password"
                placeholder="再次输入密码"
                autoComplete="new-password"
                value={form.confirm}
                onChange={(e) => update("confirm", e.target.value)}
              />
            </div>
          </div>

          <button className="login-form__submit" type="submit" disabled={loading}>
            {loading ? "注册中…" : "注 册"}
          </button>

          <p className="login-form__register">
            已有账号？ <Link href="/">直接登录</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
