import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FeedbackWidget } from "@/components/FeedbackWidget";

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="反馈"
        title="反馈"
        className="glass fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-foreground/80 transition hover:text-foreground"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        反馈
      </button>
      <FeedbackWidget open={open} onOpenChange={setOpen} />
    </>
  );
}
