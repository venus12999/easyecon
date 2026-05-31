import { Card, CardContent } from "@/components/ui/card";
import { Check, X } from "lucide-react";

export type GradeResult = {
  total_score: number;
  max_score: number;
  breakdown: { point: string; awarded: boolean; comment: string }[];
  overall_comment: string;
  suggestions: string;
};

export function FrqGradeCard({ grade }: { grade: GradeResult }) {
  const pct =
    grade.max_score > 0 ? Math.round((grade.total_score / grade.max_score) * 100) : 0;
  return (
    <Card className="mt-3">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">AI 评分（按 AP rubric）</div>
          <div className="text-2xl font-bold text-primary">
            {grade.total_score}
            <span className="text-base text-muted-foreground"> / {grade.max_score}</span>
            <span className="ml-2 text-xs text-muted-foreground">({pct}%)</span>
          </div>
        </div>
        {grade.breakdown.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">逐点评分</div>
            <ul className="space-y-1.5">
              {grade.breakdown.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className={`shrink-0 mt-0.5 rounded-full w-5 h-5 inline-flex items-center justify-center text-white ${
                      b.awarded ? "bg-success" : "bg-destructive"
                    }`}
                  >
                    {b.awarded ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </span>
                  <div className="flex-1">
                    <div className="font-medium">{b.point}</div>
                    <div className="text-muted-foreground text-xs leading-relaxed mt-0.5">
                      {b.comment}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {grade.overall_comment && (
          <div>
            <div className="text-sm font-semibold mb-1">整体评语</div>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {grade.overall_comment}
            </p>
          </div>
        )}
        {grade.suggestions && (
          <div>
            <div className="text-sm font-semibold mb-1">改进建议</div>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {grade.suggestions}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}