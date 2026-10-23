import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyUserRequest } from "@/lib/user-auth.server";
import { consumeAiQuota, membershipEnvironment, releaseAiQuota } from "@/lib/membership.server";
import { isAdminEmailServer } from "@/lib/admin-emails.server";
import { gradeFrqAnswer } from "@/lib/frq-grade.server";

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Body = {
  frq_id: string;
  paper_id: string;
  mode: "exam" | "practice";
  answer_text?: string | null;
  answer_file_url?: string | null;
  answer_file_kind?: "image" | "pdf" | "doc" | "text" | null;
  assignment_id?: string;
};

export const Route = createFileRoute("/api/frq/grade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const u = await verifyUserRequest(request);
        if (!u) return err("unauthorized", 401);
        const body = (await request.json()) as Body;
        if (!body.frq_id || !body.paper_id || !body.mode) return err("missing fields");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.frq_id) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.paper_id) ||
            !["exam", "practice"].includes(body.mode)) return err("invalid fields");
        if (body.answer_text && body.answer_text.length > 30000) return err("答案文字过长");
        const hasText = !!(body.answer_text && body.answer_text.trim());
        const hasFile = !!body.answer_file_url;
        if (!hasText && !hasFile) return err("请填写或上传答案");
        if (hasFile) {
          let fileUrl: URL;
          try {
            fileUrl = new URL(body.answer_file_url!);
          } catch {
            return err("invalid file URL");
          }
          const storageBase = process.env.SUPABASE_URL;
          if (!storageBase) return err("storage unavailable", 500);
          const allowedPrefix = `${storageBase.replace(/\/$/, "")}/storage/v1/object/public/question-images/frq-answers/${u.userId}/${body.paper_id}/${body.frq_id}/`;
          if (!fileUrl.href.startsWith(allowedPrefix)) return err("invalid file URL");
        }

        const [{ data: frq, error: e1 }, { data: rubric }] = await Promise.all([
          supabaseAdmin
            .from("paper_frqs")
            .select("id,paper_id,title,content,image_url,image_text,max_score,sort_order")
            .eq("id", body.frq_id)
            .eq("paper_id", body.paper_id)
            .maybeSingle(),
          supabaseAdmin
            .from("paper_frq_rubrics")
            .select("rubric_note")
            .eq("frq_id", body.frq_id)
            .maybeSingle(),
        ]);
        if (e1 || !frq) return err("frq not found", 404);

        let skipQuota = false;
        if (body.assignment_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.assignment_id)) {
          const { data: assignment } = await supabaseAdmin
            .from("school_assignments")
            .select("id,class_id")
            .eq("id", body.assignment_id)
            .maybeSingle();
          if (assignment) {
            const [{ data: roster }, { data: staff }] = await Promise.all([
              supabaseAdmin
                .from("school_roster")
                .select("id")
                .eq("class_id", assignment.class_id)
                .eq("user_id", u.userId)
                .maybeSingle(),
              supabaseAdmin.rpc("is_school_staff", { _user_id: u.userId }),
            ]);
            skipQuota = !!roster || staff === true || isAdminEmailServer(u.email);
          }
        }
         const quota = skipQuota
           ? { allowed: true }
           : await consumeAiQuota(supabaseAdmin, u.userId, "frq_grade", membershipEnvironment(request), u.email);
         if (!quota.allowed) return err("membership_quota_exhausted", 403);

        const graded = await gradeFrqAnswer({
          frq,
          rubricNote: rubric?.rubric_note ?? null,
          answerText: body.answer_text ?? null,
          answerFileUrl: body.answer_file_url ?? null,
          answerFileKind: body.answer_file_kind ?? null,
        });
        if (!graded.ok) {
          if (!skipQuota) await releaseAiQuota(supabaseAdmin, u.userId, "frq_grade");
          const status = graded.error === "rate_limited" ? 429 : graded.error === "credits_exhausted" ? 402 : graded.error === "ai_not_configured" || graded.error === "ai_unauthorized" ? 503 : 500;
          return err(graded.error, status);
        }
        const clean = graded.grade;
        const total = clean.total_score;
        const maxScore = clean.max_score;

        // 持久化（使用 service role，但记录 user_id）
        await supabaseAdmin.from("frq_submissions").insert({
          user_id: u.userId,
          paper_id: body.paper_id,
          frq_id: body.frq_id,
          mode: body.mode,
          answer_text: body.answer_text ?? null,
          answer_file_url: body.answer_file_url ?? null,
          answer_file_kind: body.answer_file_kind ?? (hasText ? "text" : null),
          ai_score: total,
          ai_max_score: maxScore,
          ai_breakdown: clean.breakdown,
          ai_overall: clean.overall_comment,
          ai_suggestions: clean.suggestions,
        });

        return Response.json({
          total_score: total,
          max_score: maxScore,
          breakdown: clean.breakdown,
          overall_comment: clean.overall_comment,
          suggestions: clean.suggestions,
        });
      },
    },
  },
});