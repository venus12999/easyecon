const AI_MARK = /\[\[exam-ai:([01])\]\]/g;
const POINT_MARK = /^\[\[pts:(\d{1,2})\]\]\s*/;
const PAGE_MARK = /\[\[page-image:(https?:\/\/[^\]\s]+)\]\]/;

export function stripExamFlags(description: string | null | undefined) {
  return (description ?? "").replace(/\n?\[\[exam-ai:[01]\]\]/g, "").trim();
}

/** Hide staff notes such as the question-bank review line from the student intro. */
export function studentPaperNote(description: string | null | undefined) {
  const text = stripExamFlags(description);
  if (!text || /等待管理员审核|列入题库|教师 PDF 导入/.test(text)) return null;
  return text;
}

export function readExamAiGrade(description: string | null | undefined) {
  const marks = [...(description ?? "").matchAll(AI_MARK)];
  const last = marks.at(-1);
  return last?.[1] === "1";
}

/** School exams grade with AI unless the paper explicitly turns it off. */
export function schoolExamAiOn(description: string | null | undefined) {
  const marks = [...(description ?? "").matchAll(AI_MARK)];
  const last = marks.at(-1);
  if (!last) return true;
  return last[1] === "1";
}

export function withExamAiGrade(description: string | null | undefined, on: boolean) {
  const base = stripExamFlags(description);
  return `${base}${base ? "\n" : ""}[[exam-ai:${on ? "1" : "0"}]]`;
}

export function readPointMarker(explanation: string | null | undefined) {
  const m = (explanation ?? "").match(POINT_MARK);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 20 ? n : 1;
}

export function stripPointMarker(explanation: string | null | undefined) {
  return (explanation ?? "").replace(POINT_MARK, "");
}

export function withPointMarker(explanation: string, points: number) {
  const base = stripPointMarker(explanation);
  const n = Math.round(Number(points) || 1);
  if (n <= 1) return base;
  return `[[pts:${Math.min(20, n)}]] ${base}`;
}

export function readPageImage(text: string | null | undefined) {
  return text?.match(PAGE_MARK)?.[1] ?? null;
}

export function stripPageImage(text: string | null | undefined) {
  return (text ?? "").replace(/\n?\[\[page-image:https?:\/\/[^\]\s]+\]\]/g, "").trim();
}

export function withPageImage(text: string | null | undefined, pageUrl: string | null | undefined) {
  const base = stripPageImage(text);
  if (!pageUrl) return base;
  return `${base}${base ? "\n" : ""}[[page-image:${pageUrl}]]`;
}
