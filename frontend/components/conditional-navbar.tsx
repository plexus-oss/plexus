"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { BookOpen } from "lucide-react";
import { FeedbackModal } from "@/components/feedback-modal";
import { AlertsDropdown } from "@/components/alerts/alerts-dropdown";
import { UserMenu } from "@/components/user-menu";

export const TopNav = () => {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <>
      <div className="h-10 flex items-center justify-end gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => setFeedbackOpen(true)}
        >
          Feedback
        </Button>

        <Button variant="outline" size="sm" className="rounded-full w-7 h-7">
          <BookOpen className="w-3 h-3" />
        </Button>
        <AlertsDropdown />

        <UserMenu />
      </div>
      <FeedbackModal
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </>
  );
};
