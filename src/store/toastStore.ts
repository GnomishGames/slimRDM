import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (message: string, durationMs?: number) => void;
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message, durationMs = 1200) => {
    if (dismissTimer) clearTimeout(dismissTimer);
    set({ message });
    dismissTimer = setTimeout(() => {
      set({ message: null });
      dismissTimer = null;
    }, durationMs);
  },
}));
