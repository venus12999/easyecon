import mascot1Url from "@/assets/mascot.png";
import mascot2Url from "@/assets/mascot2.png";
import mascot3Url from "@/assets/mascot3.png";

export type CompanionId = "sarah" | "venus" | "jason";

export type Companion = {
  id: CompanionId;
  name: string;
  image: string;
  tagline: string;
  intro: string;
};

export const COMPANIONS: Companion[] = [
  {
    id: "sarah",
    name: "Sarah",
    image: mascot1Url,
    tagline: "去年 AP Micro 5 分学姐，笑点低但很靠谱。",
    intro: "接下来由我来陪伴你一起学习呀！我去年也是这样一路刷过来的。",
  },
  {
    id: "venus",
    name: "Venus",
    image: mascot2Url,
    tagline: "去年 AP Micro 5 分学姐，安静温柔的那一款。",
    intro: "接下来由我来陪伴你一起学习呀！我们慢慢来，不急。",
  },
  {
    id: "jason",
    name: "Jason",
    image: mascot3Url,
    tagline: "去年 AP Micro 5 分学长，喜欢吐槽经济学。",
    intro: "接下来由我来陪伴你一起学习呀！有啥不会的直接问我。",
  },
];

export const DEFAULT_COMPANION: CompanionId = "sarah";
export const COMPANION_KEY = "companion-id-v1";

export function getCompanion(id: string | null | undefined): Companion {
  return COMPANIONS.find((c) => c.id === id) ?? COMPANIONS[0];
}

type LineCategory = "daily" | "concept" | "encourage" | "exam_tip" | "comeback" | "night";

const LINES: Record<LineCategory, string[]> = {
  daily: [
    "早呀，今天先来两道简单的热热身？😌",
    "又见面啦，昨天那道弹性题我还在想 🤔",
    "今天状态怎么样？先做十分钟看看。",
    "刷题不用太拼，稳一点反而分高 ✨",
    "打开就是胜利，来做一题吧。",
    "今天目标不用高，先把一个知识点搞透。",
    "考前的每一天都算数，加油 💪",
    "我泡好咖啡了，你要不要来一题 ☕",
  ],
  concept: [
    "今天又碰到 Opportunity Cost 了，这家伙其实纸老虎 😂",
    "需求量沿曲线动，需求整条曲线动，别搞反哦。",
    "看到 ceteris paribus 就深呼吸，其他条件都不变。",
    "税收谁承担多，看谁弹性小，弹性小的躲不掉 🥲",
    "Marginal 和 Total 差一个字，分差一整档，慢点读题。",
    "价格上限低于均衡才有意义，否则就是白写。",
    "画图先标坐标轴，我去年 FRQ 就是这样多拿了 2 分。",
    "垄断题记得先画 MR，那条线才是关键 ✍️",
    "外部性我以前也很头疼，多做两道就熟了。",
    "PPF 那种题看着难，其实套路很固定。",
  ],
  encourage: [
    "错一题不代表什么，弄懂就是赚到 💡",
    "去年这个时候我也一直错，突然某天就开窍了。",
    "别慌，节奏是自己的，跟别人比没意义。",
    "刷题不是比谁快，是比谁记得住。",
    "你能坚持打开这个页面，就已经赢了一半。",
  ],
  exam_tip: [
    "考前一天别刷新题了，把错题本翻一遍就够。",
    "FRQ 记得先写结论再画图，阅卷老师看得快。",
    "考前把公式手写一遍，比看十遍都管用。",
    "选择题拿不准就先跳过，别死磕。",
    "考试当天早点到，坐下来先深呼吸三次 🌿",
  ],
  comeback: [
    "回来啦！我差点以为你不要我了 🥹",
    "好久不见，先随便做一题找找感觉？",
    "没关系，从今天重新开始，节奏我们慢慢找。",
    "回来就好，之前的努力没浪费。",
  ],
  night: [
    "有点晚了，做完这一题就去睡吧 🌙",
    "熬夜刷题效率会掉的，早点休息更划算。",
    "今天的额度用够了，明天再战 💤",
    "晚安啦，梦里也别做经济题哦。",
  ],
};

const LAST_SEEN_KEY = "mascot-last-seen-v1";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick a contextual line based on time-of-day and last-seen. Updates last-seen. */
export function pickContextualLine(): string {
  const now = new Date();
  const hour = now.getHours();
  let daysAway = 0;
  try {
    const last = localStorage.getItem(LAST_SEEN_KEY);
    if (last) {
      const diff = (now.getTime() - Number(last)) / 86_400_000;
      if (Number.isFinite(diff)) daysAway = Math.floor(diff);
    }
    localStorage.setItem(LAST_SEEN_KEY, String(now.getTime()));
  } catch {}

  if (daysAway >= 3) return pick(LINES.comeback);
  if (hour >= 22 || hour < 5) return pick(LINES.night);
  // Mix: 50% concept, 30% daily, 20% encourage
  const roll = Math.random();
  if (roll < 0.5) return pick(LINES.concept);
  if (roll < 0.8) return pick(LINES.daily);
  return pick(LINES.encourage);
}