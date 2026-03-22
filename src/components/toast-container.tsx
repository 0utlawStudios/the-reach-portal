"use client";

import { useToast } from "@/lib/toast-context";
import { CheckCircle, Info, AlertTriangle, XCircle, X, Mail } from "lucide-react";

const typeStyles = {
  success: { bg: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20", icon: <CheckCircle className="w-4 h-4 text-emerald-500" />, text: "text-emerald-800 dark:text-emerald-300" },
  info: { bg: "bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20", icon: <Info className="w-4 h-4 text-blue-500" />, text: "text-blue-800 dark:text-blue-300" },
  warning: { bg: "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20", icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, text: "text-amber-800 dark:text-amber-300" },
  error: { bg: "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20", icon: <XCircle className="w-4 h-4 text-red-500" />, text: "text-red-800 dark:text-red-300" },
};

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const style = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg ${style.bg} animate-in slide-in-from-right-5 fade-in duration-200`}
          >
            <div className="shrink-0 mt-0.5">{style.icon}</div>
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-medium ${style.text} leading-relaxed`}>{toast.message}</p>
              {toast.message.includes("Email dispatched") && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-500">
                  <Mail className="w-3 h-3" />
                  <span>Notification sent via email</span>
                </div>
              )}
            </div>
            <button onClick={() => removeToast(toast.id)} className="shrink-0 text-gray-400 hover:text-gray-600 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
