import { useState } from "react";
import { AskAi } from "@/components/AskAi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { renderStemWithTerms, highlightTermsInNodes, type TermInfo } from "@/lib/term-render";
import { colorizeExplanation, optionStyles, type OptKey } from "@/lib/option-colors";
import { cn } from "@/lib/utils";

export type McqResultQuestion = {
  id: string;
  stem: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string | null;
  correct_answer: OptKey;
  explanation: string;
  image_url: string | null;
  term_tags: string[] | null;
};

export function McqResultGrid({
  questions,
  answers,
  termDict,
}: {
  questions: McqResultQuestion[];
  answers: Record<string, OptKey>;
  termDict: Record<string, TermInfo>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = questions.find((q) => q.id === openId) ?? null;
  const currentIndex = current ? questions.findIndex((q) => q.id === current.id) : -1;
  const picked = current ? answers[current.id] : undefined;
  const ok = current ? picked === current.correct_answer : false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-sm bg-emerald-500/20 ring-1 ring-emerald-500" /> 正确
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-4 w-4 rounded-sm bg-red-500/20 ring-1 ring-red-500" /> 错误 / 未作答
        </span>
        <span>点击格子查看标准答案与 AI 答疑</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 sm:gap-2">
        {questions.map((q, i) => {
          const isCorrect = answers[q.id] === q.correct_answer;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setOpenId(q.id)}
              title={`第 ${i + 1} 题 · ${isCorrect ? "正确" : answers[q.id] ? "错误" : "未作答"}`}
              className={cn(
                "h-9 rounded-md text-xs font-semibold tabular-nums transition-colors",
                isCorrect
                  ? "bg-emerald-500/15 text-emerald-800 ring-1 ring-emerald-500 hover:bg-emerald-500/25"
                  : "bg-red-500/15 text-red-700 ring-1 ring-red-500 hover:bg-red-500/25",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <Dialog open={!!current} onOpenChange={(open) => { if (!open) setOpenId(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {current && (
            <>
              <DialogHeader>
                <DialogTitle>
                  第 {currentIndex + 1} 题
                  <span
                    className={cn(
                      "ml-2 rounded-full px-2 py-0.5 text-xs font-medium",
                      ok ? "bg-emerald-500/15 text-emerald-800" : "bg-red-500/15 text-red-700",
                    )}
                  >
                    {ok ? "正确" : picked ? "错误" : "未作答"}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  你的答案：{picked ?? "—"}　标准答案：{current.correct_answer}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="leading-relaxed">
                  {renderStemWithTerms(current.stem, current.term_tags ?? [], termDict)}
                </div>
                {current.image_url && (
                  <img src={current.image_url} alt="题图" className="max-h-64 max-w-full h-auto rounded border" />
                )}
                <div className="space-y-2">
                  {(
                    [
                      ["A", current.option_a],
                      ["B", current.option_b],
                      ["C", current.option_c],
                      ["D", current.option_d],
                      ...(current.option_e ? [["E", current.option_e] as const] : []),
                    ] as Array<[OptKey, string]>
                  ).map(([k, v]) => {
                    const isCorrect = k === current.correct_answer;
                    const isPicked = k === picked;
                    const s = optionStyles[k];
                    return (
                      <div
                        key={k}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border-2 px-3 py-2",
                          isCorrect && "ring-1 ring-emerald-500",
                          isPicked && !isCorrect && "ring-1 ring-red-400",
                        )}
                        style={{ background: s.bgSoft, borderColor: isCorrect || isPicked ? s.border : "transparent" }}
                      >
                        <span
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ background: s.bg }}
                        >
                          {k}
                        </span>
                        <span className="flex-1 pt-0.5" style={{ color: s.ink }}>
                          {renderStemWithTerms(v, current.term_tags ?? [], termDict)}
                        </span>
                        {isCorrect && <span className="shrink-0 text-[11px] font-medium text-emerald-700">标准答案</span>}
                        {isPicked && !isCorrect && (
                          <span className="shrink-0 text-[11px] font-medium text-red-600">你的选择</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">官方解析</div>
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {highlightTermsInNodes(colorizeExplanation(current.explanation), termDict)}
                  </div>
                </div>
                <AskAi key={current.id} q={current} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
