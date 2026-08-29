import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export type AiExplainQuestion = {
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e?: string | null;
  correct_answer: string;
  explanation: string;
};

export function AskAi({ q }: { q: AiExplainQuestion }) {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!input.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("请先登录后使用 AI 答疑");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/ai-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: input,
          context: {
            stem: q.stem,
            options: {
              A: q.option_a,
              B: q.option_b,
              C: q.option_c,
              D: q.option_d,
              ...(q.option_e ? { E: q.option_e } : {}),
            },
            correct: q.correct_answer,
            explanation: q.explanation,
          },
        }),
      });
      if (!res.ok || !res.body) {
        if (res.status === 403) {
          toast.error("今日 AI 答疑次数已用完，可在个人资料页升级会员");
        } else if (res.status === 429) {
          toast.error("AI 请求过于频繁，请稍后再试");
        } else if (res.status === 402) {
          toast.error("AI 额度已用完，请联系管理员充值");
        } else {
          toast.error("AI 暂不可用");
        }
        setLoading(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) setAnswer((a) => a + c);
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch {
      toast.error("AI 请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-accent/40 bg-accent/5">
      <CardContent className="space-y-3 p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">还有疑问？问 AI</span>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例：为什么不选 B？shift 和 movement 区别是什么？"
          rows={2}
        />
        <div className="flex justify-end">
          <Button onClick={() => void ask()} disabled={loading || !input.trim()} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "提问"}
          </Button>
        </div>
        {answer && (
          <div className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm leading-relaxed">
            {answer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
