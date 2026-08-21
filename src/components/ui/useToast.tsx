import { useCallback, useState } from "react";
import { Icon } from "./Icon";

export interface ToastState {
  message: string;
  type: "success" | "error";
}

/** Small self-dismissing notification (4 s). */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback(
    (message: string, type: ToastState["type"] = "success") => {
      setToast({ message, type });
      setTimeout(() => setToast(null), 4000);
    },
    [],
  );
  return { toast, showToast };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-5 right-5 z-50 px-6 py-4 rounded-xl shadow-lg border text-sm font-medium transition-all duration-300 transform translate-y-0 motion-safe:animate-fade-in flex items-center gap-3 ${
        toast.type === "success"
          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
          : "bg-red-50 border-red-200 text-red-800"
      }`}
    >
      {toast.type === "success" ? (
        <Icon
          name="check"
          className="w-5 h-5 text-emerald-600"
          title="Suksess"
        />
      ) : (
        <Icon
          name="alertCircle"
          className="w-5 h-5 text-red-600"
          title="Feil"
        />
      )}
      <span>{toast.message}</span>
    </div>
  );
}
