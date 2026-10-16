import { stripPageImage } from "@/lib/exam-flags";

const RUBRIC_MARK = "<<<RUBRIC>>>";

export function splitTeacherFrq(content: string | null | undefined): { content: string; rubric_note: string } {
  const raw = content ?? "";
  const at = raw.indexOf(RUBRIC_MARK);
  if (at < 0) return { content: raw, rubric_note: "" };
  return {
    content: raw.slice(0, at).trim(),
    rubric_note: raw.slice(at + RUBRIC_MARK.length).trim(),
  };
}

export function packTeacherFrq(content: string | null | undefined, rubric: string | null | undefined) {
  const clean = splitTeacherFrq(content).content.trim();
  const note = (rubric ?? "").trim();
  if (!note) return clean;
  return `${clean}\n\n${RUBRIC_MARK}\n${note}`;
}

export function teacherGradingNote(reference: string | null | undefined, rubric: string | null | undefined) {
  const parts: string[] = [];
  const answer = (reference ?? "").trim();
  const note = (rubric ?? "").trim();
  if (answer) parts.push(`【参考答案】\n${answer}`);
  if (note) parts.push(`【评分标准】\n${note}`);
  return parts.join("\n\n");
}

const TEACHER_RUBRIC_MARK = "【教师评分标准】";

export function splitImageTextRubric(imageText: string | null | undefined) {
  const raw = stripPageImage(imageText);
  const at = raw.indexOf(TEACHER_RUBRIC_MARK);
  if (at < 0) return { imageText: raw.trim(), rubric: "" };
  return {
    imageText: raw.slice(0, at).trim(),
    rubric: raw.slice(at + TEACHER_RUBRIC_MARK.length).trim(),
  };
}

export function withTeacherRubric(imageText: string | null | undefined, gradingNote: string) {
  const base = splitImageTextRubric(imageText).imageText;
  if (!gradingNote.trim()) return base || null;
  return [base, `${TEACHER_RUBRIC_MARK}\n${gradingNote.trim()}`].filter(Boolean).join("\n\n");
}
