"use client";

// 轻量 Promise 化弹窗：替代 window.prompt / window.confirm
// （React 19 开发模式禁用原生阻塞式对话框，会抛 "prompt() is not supported"）
// 用法：const title = await mojiPrompt({ label, initial });
//      if (!(await mojiConfirm({ label, danger }))) return;
import { useSyncExternalStore, useEffect, useRef, useState } from "react";

let current = null; // { kind, label, initial?, placeholder?, confirmText, danger?, resolve }
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export function mojiPrompt({ label = "请输入", initial = "", placeholder = "", confirmText = "确定" }) {
  return new Promise((resolve) => {
    current = { kind: "prompt", label, initial, placeholder, confirmText, resolve };
    emit();
  });
}

export function mojiConfirm({ label = "确定吗？", confirmText = "确定", danger = false }) {
  return new Promise((resolve) => {
    current = { kind: "confirm", label, confirmText, danger, resolve };
    emit();
  });
}

function close(result) {
  const s = current;
  current = null;
  emit();
  s?.resolve?.(result);
}

export function MojiDialogHost() {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null // SSR：服务端渲染时无弹窗状态
  );
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const isPrompt = state?.kind === "prompt";

  useEffect(() => {
    if (isPrompt) {
      setValue(state.initial ?? "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;

  const ok = () => close(isPrompt ? value : true);
  const cancel = () => close(isPrompt ? null : false);
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      ok();
    }
  };

  return (
    <div
      className="mojiDialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div className="mojiDialog__panel" onKeyDown={onKeyDown}>
        <p className="mojiDialog__label">{state.label}</p>
        {isPrompt && (
          <input
            ref={inputRef}
            className="mojiDialog__input"
            value={value}
            placeholder={state.placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="mojiDialog__actions">
          <button className="mojiDialog__btn" onClick={cancel}>
            取消
          </button>
          <button
            className={`mojiDialog__btn mojiDialog__btn--ok${state.danger ? " mojiDialog__btn--danger" : ""}`}
            onClick={ok}
          >
            {state.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
