"use client";

import { useSyncExternalStore } from "react";

let isKeyboard = false;
const listeners = new Set<() => void>();

function setKeyboardUser(value: boolean) {
  if (isKeyboard === value) return;
  isKeyboard = value;
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", () => setKeyboardUser(true), {
    passive: true,
  });
  window.addEventListener("mousedown", () => setKeyboardUser(false), {
    passive: true,
  });
  window.addEventListener("touchstart", () => setKeyboardUser(false), {
    passive: true,
  });
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot() {
  return isKeyboard;
}

function getServerSnapshot() {
  return false;
}

export function useKeyboardUser(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
