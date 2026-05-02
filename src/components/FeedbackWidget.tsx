import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { MessageSquarePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function FeedbackWidget() {
  const location = useLocation();
  // 不在 admin 页显示
  if (location.pathname.startsWith("/admin")) return null;

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"bug" | "suggestion">("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!message.trim()) {
      toast.error("请填写反馈内容");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.trim(),
          contact: contact.trim() || null,
          page_url: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "提交失败");
      }
      toast.success("反馈已收到，谢谢！");
      setMessage("");
      setContact("");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="fixed bottom-4 right-4 z-50 shadow-lg gap-1.5"
          aria-label="反馈"
        >
          <MessageSquarePlus className="h-4 w-4" />
          反馈
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>报告问题或提建议</DialogTitle>
          <DialogDescription>
            发现 Bug、答案有疑问、想要新功能？告诉我们 👇
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={category === "bug" ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory("bug")}
              className="flex-1"
            >
              🐞 Bug / 错题
            </Button>
            <Button
              type="button"
              variant={category === "suggestion" ? "default" : "outline"}
              size="sm"
              onClick={() => setCategory("suggestion")}
              className="flex-1"
            >
              💡 建议
            </Button>
          </div>
          <Textarea
            placeholder={
              category === "bug"
                ? "描述一下你看到的问题，例如：「Unit 4 第 3 题答案应该是 C」"
                : "你希望我们改进什么？"
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={4000}
          />
          <Input
            placeholder="联系方式（可选，方便我们回复你）"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={200}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            提交反馈
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}