"use client";

import { useState } from "react";
import { MessageSquare, Bug, Lightbulb } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { useFeedback } from "@/hooks/use-feedback";
import type { FeedbackType } from "@/lib/db/types";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const feedbackTypes: {
  value: FeedbackType;
  label: string;
  icon: typeof Bug;
  description: string;
}[] = [
  {
    value: "bug",
    label: "Bug Report",
    icon: Bug,
    description: "Something isn't working correctly",
  },
  {
    value: "feature",
    label: "Feature Request",
    icon: Lightbulb,
    description: "Suggest a new feature or improvement",
  },
  {
    value: "general",
    label: "General Feedback",
    icon: MessageSquare,
    description: "Share your thoughts or questions",
  },
];

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("general");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const { submitFeedback, isSubmitting, error } = useFeedback();

  const handleSubmit = async () => {
    if (!title.trim() || !message.trim() || isSubmitting) return;

    const success = await submitFeedback({
      feedback_type: feedbackType,
      title: title.trim(),
      message: message.trim(),
      page_url: typeof window !== "undefined" ? window.location.href : null,
    });

    if (success) {
      setIsSubmitted(true);
      // Reset form after delay
      setTimeout(() => {
        handleClose();
      }, 2000);
    }
  };

  const handleClose = () => {
    setFeedbackType("general");
    setTitle("");
    setMessage("");
    setIsSubmitted(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Send Feedback
          </DialogTitle>
          <DialogDescription>
            Help us improve Plexus by sharing your thoughts, reporting bugs, or
            suggesting features.
          </DialogDescription>
        </DialogHeader>

        {isSubmitted ? (
          <div className="py-4 text-center space-y-2">
            <div className="text-green-500 text-lg font-medium">
              Thank you for your feedback!
            </div>
            <p className="text-sm text-muted-foreground">
              We appreciate you taking the time to help us improve.
            </p>
          </div>
        ) : (
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Type
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {feedbackTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = feedbackType === type.value;
                  return (
                    <Button
                      key={type.value}
                      variant="outline"
                      type="button"
                      onClick={() => setFeedbackType(type.value)}
                      className={`flex flex-col items-center gap-1.5 p-3 h-auto ${
                        isSelected
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs font-medium">{type.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label
                htmlFor="feedback-title"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Title
              </Label>
              <Input
                id="feedback-title"
                placeholder={
                  feedbackType === "bug"
                    ? "Brief description of the issue"
                    : feedbackType === "feature"
                    ? "What feature would you like?"
                    : "What's on your mind?"
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleClose();
                  }
                }}
                className="text-sm"
                autoFocus
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label
                htmlFor="feedback-message"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Details
              </Label>
              <Textarea
                id="feedback-message"
                placeholder={
                  feedbackType === "bug"
                    ? "What happened? What did you expect to happen? Steps to reproduce..."
                    : feedbackType === "feature"
                    ? "Describe the feature and how it would help you..."
                    : "Share your thoughts, questions, or suggestions..."
                }
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && title.trim() && message.trim() && !isSubmitting) {
                    e.preventDefault();
                    handleSubmit();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    handleClose();
                  }
                }}
                rows={5}
                className="text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Press {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to submit
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose} title="Cancel (Escape)">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!title.trim() || !message.trim() || isSubmitting}
                title={`Send Feedback (${typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter)`}
              >
                {isSubmitting ? (
                  <>
                    <Spinner />
                    Sending...
                  </>
                ) : 
               
                 ("Send Feedback")
            
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
