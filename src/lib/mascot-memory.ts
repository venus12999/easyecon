// Lightweight companion memory system — persists to localStorage so it works offline
// and doesn't require a migration. Tracks: total answers, weak knowledge points,
// preferred units, active hours (作息), and milestone unlocks. When a milestone
// unlocks, dispatches a `companion:milestone` event the FloatingMascot listens for.

import { COMPANION_KEY, getCompanion, type CompanionId } from "@/lib/mascot-lines";

const MEM_KEY = "mascot-memory-v1";

export type MilestoneId =
  | "first_answer"
  | "answers_10"
  | "answers_50"
  | "answers_100"
  | "answers_500"
  | "streak_3"
  | "streak_7"
  | "streak_30"
  | "first_frq"
  | "first_mock"
  | "accuracy_80"
  | "night_owl"
  | "early_bird"
  | "comeback";

export type MascotMemory = {
  totalAnswers: number;
  correctAnswers: number;
  // knowledge_point_id -> wrong count
  weakPoints: Record<string, number>;
  // unit number -> answers count
  unitCounts: Record<string, number>;
  // hour (0-23) -> session count
  hourCounts: Record<string, number>;
  frqSubmissions: number;
  mockAttempts: number;
  // streak tracking
  lastActiveDate: string | null; // YYYY-MM-DD
  currentStreak: number;
  longestStreak: number;
  unlocked: MilestoneId[];
  lastMilestoneAt: number | null;
  currentCompanion: CompanionId | null;
  companionHistory: CompanionId[];
};

const EMPTY: MascotMemory = {
  totalAnswers: 0,
  correctAnswers: 0,
  weakPoints: {},
  unitCounts: {},
  hourCounts: {},
  frqSubmissions: 0,
  mockAttempts: 0,
  lastActiveDate: null,
  currentStreak: 0,
  longestStreak: 0,
  unlocked: [],
  lastMilestoneAt: null,
  currentCompanion: null,
  companionHistory: [],
};

function safeRead(): MascotMemory {
  try {
    const raw = localStorage.getItem(MEM_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<MascotMemory>;
    return { ...EMPTY, ...parsed, weakPoints: { ...(parsed.weakPoints ?? {}) }, unitCounts: { ...(parsed.unitCounts ?? {}) }, hourCounts: { ...(parsed.hourCounts ?? {}) }, unlocked: [...(parsed.unlocked ?? [])] };
  } catch {
    return { ...EMPTY };
  }
}

function safeWrite(mem: MascotMemory) {
  try { localStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch {}
}

export function getMascotMemory(): MascotMemory {
  return safeRead();
}

export function resetMascotMemory() {
  try { localStorage.removeItem(MEM_KEY); } catch {}
}

/** Persist the active companion into memory and broadcast a switch event. */
export function setActiveCompanion(id: CompanionId) {
  try { localStorage.setItem(COMPANION_KEY, id); } catch {}
  const mem = safeRead();
  if (mem.currentCompanion !== id) {
    mem.currentCompanion = id;
    if (!mem.companionHistory.includes(id)) mem.companionHistory.push(id);
    safeWrite(mem);
  }
  try {
    window.dispatchEvent(new CustomEvent("companion:change", { detail: { id } }));
  } catch {}
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function updateStreak(mem: MascotMemory) {
  const today = todayStr();
  if (mem.lastActiveDate === today) return;
  if (mem.lastActiveDate) {
    const last = new Date(mem.lastActiveDate + "T00:00:00");
    const now = new Date(today + "T00:00:00");
    const diff = Math.round((now.getTime() - last.getTime()) / 86_400_000);
    if (diff === 1) mem.currentStreak += 1;
    else if (diff > 1) mem.currentStreak = 1;
  } else {
    mem.currentStreak = 1;
  }
  mem.lastActiveDate = today;
  if (mem.currentStreak > mem.longestStreak) mem.longestStreak = mem.currentStreak;
}

function checkMilestones(mem: MascotMemory): MilestoneId[] {
  const newly: MilestoneId[] = [];
  const add = (id: MilestoneId, cond: boolean) => {
    if (cond && !mem.unlocked.includes(id)) { mem.unlocked.push(id); newly.push(id); }
  };
  add("first_answer", mem.totalAnswers >= 1);
  add("answers_10", mem.totalAnswers >= 10);
  add("answers_50", mem.totalAnswers >= 50);
  add("answers_100", mem.totalAnswers >= 100);
  add("answers_500", mem.totalAnswers >= 500);
  add("streak_3", mem.currentStreak >= 3);
  add("streak_7", mem.currentStreak >= 7);
  add("streak_30", mem.currentStreak >= 30);
  add("first_frq", mem.frqSubmissions >= 1);
  add("first_mock", mem.mockAttempts >= 1);
  const acc = mem.totalAnswers >= 20 ? mem.correctAnswers / mem.totalAnswers : 0;
  add("accuracy_80", acc >= 0.8);
  const nightSessions = ["22", "23", "0", "1"].reduce((s, h) => s + (mem.hourCounts[h] ?? 0), 0);
  add("night_owl", nightSessions >= 10);
  const morningSessions = ["6", "7", "8"].reduce((s, h) => s + (mem.hourCounts[h] ?? 0), 0);
  add("early_bird", morningSessions >= 10);
  return newly;
}

function fireMilestone(id: MilestoneId, mem: MascotMemory) {
  mem.lastMilestoneAt = Date.now();
  try {
    const companionId = (localStorage.getItem(COMPANION_KEY) as CompanionId | null) ?? "sarah";
    const line = milestoneLine(id, companionId, mem);
    window.dispatchEvent(new CustomEvent("companion:milestone", { detail: { id, line } }));
  } catch {}
}

/** Record a MCQ answer attempt. */
export function recordAnswer(input: { knowledgePointId: string; unit?: number | null; isCorrect: boolean }) {
  const mem = safeRead();
  mem.totalAnswers += 1;
  if (input.isCorrect) mem.correctAnswers += 1;
  else mem.weakPoints[input.knowledgePointId] = (mem.weakPoints[input.knowledgePointId] ?? 0) + 1;
  if (input.unit != null) {
    const u = String(input.unit);
    mem.unitCounts[u] = (mem.unitCounts[u] ?? 0) + 1;
  }
  const h = String(new Date().getHours());
  mem.hourCounts[h] = (mem.hourCounts[h] ?? 0) + 1;
  updateStreak(mem);
  const newly = checkMilestones(mem);
  safeWrite(mem);
  newly.forEach((id) => fireMilestone(id, mem));
}

export function recordFrqSubmission() {
  const mem = safeRead();
  mem.frqSubmissions += 1;
  updateStreak(mem);
  const newly = checkMilestones(mem);
  safeWrite(mem);
  newly.forEach((id) => fireMilestone(id, mem));
}

export function recordMockAttempt() {
  const mem = safeRead();
  mem.mockAttempts += 1;
  updateStreak(mem);
  const newly = checkMilestones(mem);
  safeWrite(mem);
  newly.forEach((id) => fireMilestone(id, mem));
}

/** Called on app open to detect "回来啦" comeback line without altering counters. */
export function pingComeback(): { comeback: boolean; daysAway: number } {
  const mem = safeRead();
  if (!mem.lastActiveDate) return { comeback: false, daysAway: 0 };
  const last = new Date(mem.lastActiveDate + "T00:00:00");
  const now = new Date(todayStr() + "T00:00:00");
  const diff = Math.round((now.getTime() - last.getTime()) / 86_400_000);
  if (diff >= 3 && !mem.unlocked.includes("comeback")) {
    mem.unlocked.push("comeback");
    safeWrite(mem);
    fireMilestone("comeback", mem);
    return { comeback: true, daysAway: diff };
  }
  return { comeback: diff >= 3, daysAway: diff };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Per-companion voice: same milestone, different tone.
function milestoneLine(id: MilestoneId, cid: CompanionId, mem: MascotMemory): string {
  const name = getCompanion(cid).name;
  const acc = mem.totalAnswers > 0 ? Math.round((mem.correctAnswers / mem.totalAnswers) * 100) : 0;
  const streak = mem.currentStreak;
  const total = mem.totalAnswers;
  const banks: Record<MilestoneId, Record<CompanionId, string[]>> = {
    first_answer: {
      sarah: [`第一题打卡！我记住你了 ✨ 一起冲 5 分吧。`],
      venus: [`踏出第一步啦，慢慢来我陪你。`],
      jason: [`开搞了？行，那我认真陪你刷。`],
    },
    answers_10: {
      sarah: [`已经 10 题啦，正确率 ${acc}%，进度很稳 💪`],
      venus: [`刷完 10 题啦，来喝口水休息一下再继续～`],
      jason: [`10 题达成，节奏不错，别掉链子。`],
    },
    answers_50: {
      sarah: [`50 题！你比昨天的自己厉害了 🌟 正确率 ${acc}%。`],
      venus: [`50 题达成，你真的一直在坚持，我看到了。`],
      jason: [`50 了。这时候容易开始飘，稳住节奏别浪。`],
    },
    answers_100: {
      sarah: [`破百啦！这已经是很多同学一整个月的量了 🎉`],
      venus: [`100 题达成，你的坚持真的很动人。`],
      jason: [`100 题。可以了，你已经比一半人努力了。`],
    },
    answers_500: {
      sarah: [`500 题！我去年到这个数字的时候就开始稳 5 分了 🏆`],
      venus: [`500 题…你真的走到这里了，为你骄傲。`],
      jason: [`500。这不叫刷题，这叫刻苦。5 分稳了。`],
    },
    streak_3: {
      sarah: [`连续 3 天啦，节奏找到了就别断哦～`],
      venus: [`连着来了 3 天，你比我想的更能坚持。`],
      jason: [`3 天了，习惯正在成形，别停。`],
    },
    streak_7: {
      sarah: [`一周不断更！我给你颁个小奖状 🥇`],
      venus: [`满一周啦，谢谢你没有放弃。`],
      jason: [`连续 7 天，这就是所谓的自律。`],
    },
    streak_30: {
      sarah: [`满月啦！你已经不是新手了 🌙`],
      venus: [`连着 30 天，你已经很不一样了。`],
      jason: [`30 天连击。别人还在计划，你已经跑了一个月。`],
    },
    first_frq: {
      sarah: [`第一道大题！FRQ 写完就赢一半 📝`],
      venus: [`勇敢地写了大题，慢慢来我们一起改进。`],
      jason: [`大题开写了？行，FRQ 才是拉分点。`],
    },
    first_mock: {
      sarah: [`第一次模考！结果不重要，找到手感就是赚 🎯`],
      venus: [`模考很累吧，先深呼吸，等下我们一起看。`],
      jason: [`第一次模考。看数据别看情绪，把错的改了就行。`],
    },
    accuracy_80: {
      sarah: [`正确率破 80% 啦！${total} 题稳住了 🔥`],
      venus: [`80% 正确率，你比自己想的更厉害。`],
      jason: [`80% 了。到了这个阶段就别刷简单题了，找难的做。`],
    },
    night_owl: {
      sarah: [`夜猫子模式启动 🌙 别太拼，明天还要考试呢。`],
      venus: [`你老是晚上学习呀…要不要早一点睡？`],
      jason: [`又是深夜？行吧，我陪你。但记得别熬太狠。`],
    },
    early_bird: {
      sarah: [`早起学习的都是狠人 ☀️ 效率给你拉满。`],
      venus: [`一大早就来啦，先喝口温水暖胃。`],
      jason: [`早起党。我尊敬你。`],
    },
    comeback: {
      sarah: [`回来啦！之前 ${total} 题、连击 ${streak} 天的记录我都给你留着 💾`],
      venus: [`好久不见，你还愿意回来，我很开心。`],
      jason: [`回来了？行，接着刷，别废话。`],
    },
  };
  return pick(banks[id][cid]);
}

/** Human-readable summary for the profile page. */
export function summarizeMemory(): {
  totalAnswers: number;
  accuracy: number;
  streak: number;
  longestStreak: number;
  frqSubmissions: number;
  mockAttempts: number;
  favoriteUnit: string | null;
  activeHour: string | null;
  weakCount: number;
  milestones: MilestoneId[];
} {
  const mem = safeRead();
  const accuracy = mem.totalAnswers > 0 ? Math.round((mem.correctAnswers / mem.totalAnswers) * 100) : 0;
  const favoriteUnit = Object.entries(mem.unitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const activeHour = Object.entries(mem.hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const weakCount = Object.keys(mem.weakPoints).length;
  return {
    totalAnswers: mem.totalAnswers,
    accuracy,
    streak: mem.currentStreak,
    longestStreak: mem.longestStreak,
    frqSubmissions: mem.frqSubmissions,
    mockAttempts: mem.mockAttempts,
    favoriteUnit,
    activeHour,
    weakCount,
    milestones: mem.unlocked,
  };
}