/**
 * Toast utility functions for consistent notifications
 * Wraps sonner for a unified API
 */

import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const toast = {
  /**
   * Show a success toast
   */
  success: (message: string, options?: ToastOptions) => {
    return sonnerToast.success(message, {
      description: options?.description,
      duration: options?.duration ?? 3000,
      action: options?.action,
    });
  },

  /**
   * Show an error toast
   */
  error: (message: string, options?: ToastOptions) => {
    return sonnerToast.error(message, {
      description: options?.description,
      duration: options?.duration ?? 5000,
      action: options?.action,
    });
  },

  /**
   * Show a warning toast
   */
  warning: (message: string, options?: ToastOptions) => {
    return sonnerToast.warning(message, {
      description: options?.description,
      duration: options?.duration ?? 4000,
      action: options?.action,
    });
  },

  /**
   * Show an info toast
   */
  info: (message: string, options?: ToastOptions) => {
    return sonnerToast.info(message, {
      description: options?.description,
      duration: options?.duration ?? 3000,
      action: options?.action,
    });
  },

  /**
   * Show a loading toast
   * Returns a dismiss function
   */
  loading: (message: string): (() => void) => {
    const id = sonnerToast.loading(message);
    return () => sonnerToast.dismiss(id);
  },

  /**
   * Show a promise toast that updates based on promise state
   */
  promise: <T>(
    promise: Promise<T>,
    options: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: Error) => string);
    }
  ) => {
    return sonnerToast.promise(promise, options);
  },

  /**
   * Dismiss a specific toast or all toasts
   */
  dismiss: (id?: string | number) => {
    sonnerToast.dismiss(id);
  },
};

/**
 * Wrapper for async operations that shows toast feedback
 * Use for major actions (create, delete) - NOT for inline edits
 *
 * @example
 * await withToast(createTable(data), {
 *   loading: "Creating table...",
 *   success: "Table created",
 * });
 */
export async function withToast<T>(
  promise: Promise<T>,
  messages: {
    loading?: string;
    success: string;
    error?: string;
  }
): Promise<T> {
  const dismiss = messages.loading ? toast.loading(messages.loading) : undefined;
  try {
    const result = await promise;
    dismiss?.();
    toast.success(messages.success);
    return result;
  } catch (err) {
    dismiss?.();
    toast.error(
      messages.error || (err instanceof Error ? err.message : "Operation failed")
    );
    throw err;
  }
}
