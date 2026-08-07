"use client";

/**
 * Feedback Hook
 * Handles feedback submission to the API.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { FeedbackType } from "@/lib/db/types";

export interface SubmitFeedbackInput {
  feedback_type: FeedbackType;
  title: string;
  message: string;
  page_url?: string | null;
}

export interface UseFeedbackResult {
  /** Submit feedback */
  submitFeedback: (input: SubmitFeedbackInput) => Promise<boolean>;
  /** Whether feedback is being submitted */
  isSubmitting: boolean;
  /** Error message if submission failed */
  error: string | null;
}

export function useFeedback(): UseFeedbackResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitFeedback = useCallback(
    async (input: SubmitFeedbackInput): Promise<boolean> => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to submit feedback");
        }

        toast.success("Feedback submitted", {
          description: "Thank you for your feedback!",
        });

        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to submit feedback";
        setError(message);
        toast.error(message);
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  return {
    submitFeedback,
    isSubmitting,
    error,
  };
}
