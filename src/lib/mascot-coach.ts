// Phase 2: 情境反馈 + 主动 Coach 规则引擎
// - 纯读已有表：answer_attempts / frq_submissions / mock_attempts / knowledge_points / profiles
// - 通过 window CustomEvent 派发气泡文案给 FloatingMascot
import { supabase } from "@/integrations/supabase/client";
import { COMPANION_KEY, getCompanion, type CompanionId } from "@/lib/mascot-lines";

function currentCompanion(): CompanionId {
  try {
    const v = localStorage.getItem(COMPANION_KEY) as CompanionId | null;
    return v ?? "sarah";
  } catch {
    return "sarah";
  }
}

function say(line: string) {
  try {
    window.dispatchEvent(new CustomEvent("companion:milestone", { detail: { line } }));
  } catch {}
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------- 答题后即时反馈 ---------- */

type AnswerEventDetail = {
  isCorrect: boolean;
  currentStreakCorrect: number;
  sessionTotal: number;
  sessionCorrect: number;
};

export function reportAnswerEvent(detail: AnswerEventDetail) {
  const cid = currentCompanion();
  if (detail.currentStreakCorrect >= 10 && detail.currentStreakCorrect % 10 === 0) {
    say(pick(streakLines(detail.currentStreakCorrect, cid)));
    return;
  }
  if (detail.sessionTotal >= 10) {
    const acc = detail.sessionCorrect / detail.sessionTotal;
    if (acc < 0.4 && detail.sessionTotal === 10) {
      say(pick(lowAccLines(cid)));
    }
  }
}

export function reportFrqEvent(detail: { firstTime: boolean; scorePct: number | null }) {
  const cid = currentCompanion();
  if (detail.firstTime) { say(pick(firstFrqLines(cid))); return; }
  if (detail.scorePct != null && detail.scorePct >= 100) say(pick(frqPerfectLines(cid)));
}

function streakLines(n: number, c: CompanionId) {
  const name = getCompanion(c).name;
  const banks: Record<CompanionId, string[]> = {
    sarah: [`连对 ${n} 题！这手感稳的呀 🔥`, `${n} 连对，${name} 服气 ✨`],
    venus: [`连对 ${n} 题啦，你今天状态真好。`, `一路 ${n} 对，慢慢来但一直对～`],
  };
  return banks[c];
}
function lowAccLines(c: CompanionId) {
  const banks: Record<CompanionId, string[]> = {
    sarah: ["今天先不贪多，挑一个知识点搞透就够啦 🌱"],
    venus: ["有点难对不对，我们先歇一下，一个知识点一个知识点来。"],
  };
  return banks[c];
}
function firstFrqLines(c: CompanionId) {
  const banks: Record<CompanionId, string[]> = {
    sarah: ["第一道大题写完啦！FRQ 敢写就赢一半 📝"],
    venus: ["第一次大题，慢慢来，表达比对错重要。"],
  };
  return banks[c];
}
function frqPerfectLines(c: CompanionId) {
  const banks: Record<CompanionId, string[]> = {
    sarah: ["FRQ 满分！这波操作我要截图收藏了 🏆"],
    venus: ["满分的大题…你已经很了不起了。"],
  };
  return banks[c];
}

/* ---------- 首页 Coach：读近 7 天数据主动提示 ---------- */

export type CoachSuggestion = {
  kind: "weak_kp" | "frq_stuck" | "mock_near_five" | "exam_countdown";
  message: string;
  actionLabel?: string;
  actionTo?: string;
  actionParams?: Record<string, string>;
};

export async function computeCoachSuggestion(userId: string): Promise<CoachSuggestion | null> {
  const cid = currentCompanion();
  const sevenAgo = new Date();
  sevenAgo.setDate(sevenAgo.getDate() - 7);

  // 优先：考试倒计时
  const { data: profile } = await supabase
    .from("profiles")
    .select("exam_date")
    .eq("user_id", userId)
    .maybeSingle<{ exam_date: string | null }>();
  const examDate = profile?.exam_date ?? null;
  if (examDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exam = new Date(examDate + "T00:00:00");
    const days = Math.round((exam.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return { kind: "exam_countdown", message: examLine(cid, 0) };
    if (days === 1) return { kind: "exam_countdown", message: examLine(cid, 1) };
    if (days > 0 && days <= 7) return { kind: "exam_countdown", message: examLine(cid, days) };
  }

  // 近 7 天错得最多的知识点
  const { data: attempts } = await supabase
    .from("answer_attempts")
    .select("knowledge_point_id,is_correct,created_at")
    .eq("user_id", userId)
    .gte("created_at", sevenAgo.toISOString())
    .limit(2000);
  const wrongByKp = new Map<string, number>();
  (attempts ?? []).forEach((a) => {
    if (!a.is_correct) wrongByKp.set(a.knowledge_point_id, (wrongByKp.get(a.knowledge_point_id) ?? 0) + 1);
  });
  const worst = [...wrongByKp.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 4) {
    const { data: kp } = await supabase
      .from("knowledge_points")
      .select("slug,name_zh")
      .eq("id", worst[0])
      .maybeSingle<{ slug: string; name_zh: string }>();
    if (kp) {
      return {
        kind: "weak_kp",
        message: weakKpLine(cid, kp.name_zh, worst[1]),
        actionLabel: `专练 ${kp.name_zh}`,
        actionTo: "/practice/$slug",
        actionParams: { slug: kp.slug },
      };
    }
  }

  // FRQ 连续三次平均分 ≤ 2
  const { data: frqs } = await supabase
    .from("frq_submissions")
    .select("ai_score,ai_max_score,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(3);
  if ((frqs?.length ?? 0) === 3 && frqs!.every((f) => (f.ai_score ?? 0) <= 2)) {
    return { kind: "frq_stuck", message: frqStuckLine(cid), actionLabel: "去大题合集", actionTo: "/frq" };
  }

  // 模考 5 次内平均正确率 65–75%
  const { data: mocks } = await supabase
    .from("mock_attempts")
    .select("total,correct")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);
  if ((mocks?.length ?? 0) >= 3) {
    const rates = mocks!.filter((m) => m.total > 0).map((m) => m.correct / m.total);
    const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
    if (avg >= 0.65 && avg <= 0.75) {
      return { kind: "mock_near_five", message: nearFiveLine(cid, Math.round(avg * 100)), actionLabel: "再来一套", actionTo: "/mock" };
    }
  }

  return null;
}

function examLine(c: CompanionId, days: number): string {
  if (days === 0) return {
    sarah: "今天就是考试日！深呼吸，你准备很久了 💪",
    venus: "考试日到啦，相信你，去把它写完。",
  }[c];
  if (days === 1) return {
    sarah: "还有 1 天啦！今天翻错题就好，别做新题 🌿",
    venus: "只剩 1 天了，今晚早点睡好吗？",
  }[c];
  return {
    sarah: `距离考试还有 ${days} 天，每天稳住节奏就行 ⏳`,
    venus: `还有 ${days} 天，我们一天一天来。`,
  }[c];
}
function weakKpLine(c: CompanionId, kp: string, n: number): string {
  return {
    sarah: `我发现你最近在「${kp}」上错了 ${n} 次，今天专练 5 题？`,
    venus: `「${kp}」这块最近错得多，我们一起再看一下～`,
  }[c];
}
function frqStuckLine(c: CompanionId): string {
  return {
    sarah: "FRQ 不是不会，只是表达没练，去写一份看看？",
    venus: "大题最近有点卡，我们回去慢慢练结构。",
  }[c];
}
function nearFiveLine(c: CompanionId, pct: number): string {
  return {
    sarah: `模考稳定在 ${pct}%，已经有 5 分实力了，就差稳 ✨`,
    venus: `已经 ${pct}% 啦，你比自己想的更接近 5 分。`,
  }[c];
}