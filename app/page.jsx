"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import "./login.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", remember: false });
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

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登录失败，请稍后再试");
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

      {/* 右侧登录表单 */}
      <section className="login-panel">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-form__head">
            <span className="login-form__logoMark">墨</span>
            <h2>墨迹写作</h2>
            <p>让灵感自由流淌</p>
          </div>

          {error && <p className="login-form__error" role="alert">{error}</p>}

          <div className="login-form__field">
            <label htmlFor="email">电子邮箱</label>
            <div className="login-form__inputWrap">
              <input
                id="email"
                type="email"
                placeholder="请输入您的注册邮箱地址"
                autoComplete="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
          </div>

          <div className="login-form__field">
            <label htmlFor="password">登录密码</label>
            <div className="login-form__inputWrap">
              <input
                id="password"
                type="password"
                placeholder="请输入您的密码"
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
              />
              <img
                className="login-form__eye"
                src="/assets/2_5/1.svg"
                alt="显示密码"
                width="16"
                height="16"
              />
            </div>
          </div>

          <div className="login-form__row">
            <label className="login-form__remember">
              <input
                type="checkbox"
                checked={form.remember}
                onChange={(e) => update("remember", e.target.checked)}
              />
              <span>记住我</span>
            </label>
            <a className="login-form__forgot" href="#" onClick={(e) => e.preventDefault()}>
              忘记密码?
            </a>
          </div>

          <button className="login-form__submit" type="submit" disabled={loading}>
            {loading ? "登录中…" : "登 录"}
          </button>

          <div className="login-form__divider">
            <span>或使用第三方登录</span>
          </div>

          <div className="login-form__social">
            <button type="button">
              <img src="/assets/2_5/3.svg" alt="" width="18" height="18" />
              <span>微信登录</span>
            </button>
            <button type="button">
              <img src="/assets/2_5/4.svg" alt="" width="18" height="18" />
              <span>Google</span>
            </button>
          </div>

          <p className="login-form__register">
            还没有账号？ <Link href="/register">立即注册</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
