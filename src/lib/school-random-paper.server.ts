import { supabaseAdmin } from "@/integrations/supabase/client.server";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Q = {
  id: string;
  knowledge_point_id: string;
  type: string | null;
  unit?: number;
  knowledge_points: { unit: number } | { unit: number }[] | null;
};

const UNIT_TARGETS: Record<number, number> = { 1: 8, 2: 14, 3: 12, 4: 11, 5: 7, 6: 8 };
const TYPE_RATIO = { basic: 0.4, application: 0.5, pitfall: 0.1 };

export async function createFixedRandomSchoolPaper(title: string) {
  const { data: questionRows, error: qErr } = await supabaseAdmin
    .from("questions")
    .select("id,knowledge_point_id,type,knowledge_points!inner(unit)")
    .eq("status", "published")
    .eq("exclude_from_pool", false);
  if (qErr) throw qErr;
  const all = ((questionRows ?? []) as Q[]).map((q) => ({
    ...q,
    unit: Array.isArray(q.knowledge_points) ? q.knowledge_points[0]?.unit ?? 0 : q.knowledge_points?.unit ?? 0,
  }));

  const picked: Q[] = [];
  const used = new Set<string>();
  const takeFrom = (bucket: Q[], n: number) => {
    const take = shuffle(bucket.filter((q) => !used.has(q.id))).slice(0, n);
    take.forEach((q) => used.add(q.id));
    picked.push(...take);
    return take;
  };

  for (const [unitStr, target] of Object.entries(UNIT_TARGETS)) {
    const unit = Number(unitStr);
    const unitPool = all.filter((q) => q.unit === unit);
    const rawBasic = Math.floor(target * TYPE_RATIO.basic);
    const rawPitfall = Math.floor(target * TYPE_RATIO.pitfall);
    const rawApp = target - rawBasic - rawPitfall;
    const byType = {
      basic: unitPool.filter((q) => q.type === "basic"),
      application: unitPool.filter((q) => q.type === "application"),
      pitfall: unitPool.filter((q) => q.type === "pitfall"),
    };
    takeFrom(byType.basic, rawBasic);
    takeFrom(byType.application, rawApp);
    takeFrom(byType.pitfall, rawPitfall);
    const still = target - picked.filter((q) => q.unit === unit).length;
    if (still > 0) takeFrom(unitPool, still);
  }
  if (picked.length < 60) takeFrom(all, 60 - picked.length);

  const { data: frqRows } = await supabaseAdmin
    .from("paper_frqs")
    .select("title,content,image_url,image_text,max_score,exclude_from_pool")
    .eq("exclude_from_pool", false);
  const frqs = (frqRows ?? []) as {
    title: string | null;
    content: string;
    image_url: string | null;
    image_text: string | null;
    max_score: number;
  }[];
  const long = shuffle(frqs.filter((f) => (f.max_score ?? 0) >= 8));
  const short = shuffle(frqs.filter((f) => (f.max_score ?? 0) < 8));
  const chosenFrqs = [...long.slice(0, 1), ...short.slice(0, 2)];
  if (chosenFrqs.length < 3) {
    chosenFrqs.push(...shuffle(frqs.filter((f) => !chosenFrqs.includes(f))).slice(0, 3 - chosenFrqs.length));
  }

  const slug = `school-${crypto.randomUUID().slice(0, 8)}`;
  const { data: paper, error: pErr } = await supabaseAdmin
    .from("mock_papers")
    .insert({
      slug,
      title,
      description: "学校计分考 · 开考前抽好的固定随机卷（全班同一套）",
      total_seconds: 70 * 60,
      frq_seconds: 60 * 60,
      break_seconds: 10 * 60,
      sort_order: 900,
    })
    .select("id,slug,title")
    .single();
  if (pErr || !paper) throw pErr ?? new Error("无法创建试卷");

  if (picked.length > 0) {
    const { error } = await supabaseAdmin.from("paper_questions").insert(
      picked.slice(0, 60).map((q, i) => ({ paper_id: paper.id, question_id: q.id, sort_order: i + 1 })),
    );
    if (error) throw error;
  }
  if (chosenFrqs.length > 0) {
    const { error } = await supabaseAdmin.from("paper_frqs").insert(
      chosenFrqs.slice(0, 3).map((f, i) => ({
        paper_id: paper.id,
        sort_order: i + 1,
        title: f.title,
        content: f.content,
        image_url: f.image_url,
        image_text: f.image_text,
        max_score: f.max_score ?? 9,
        exclude_from_pool: true,
      })),
    );
    if (error) throw error;
  }
  return paper;
}

export function makeExamCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
