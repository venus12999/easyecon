const BLANK_ANSWER = /^(未作答|没有作答|未答|无答案|无|空白|没写|空|n\/?a|none|null|nil|blank|—|–|-|--+|\.{1,}|。+|…+|\(空\)|（空）)$/i;

/** True when there is nothing to send to the grader: no file, and the text is empty or a placeholder. */
export function isBlankStudentAnswer(text: string | null | undefined, fileUrl: string | null | undefined) {
  if ((fileUrl ?? "").trim()) return false;
  const trimmed = (text ?? "").replace(/[\s\u00a0\u3000]+/g, " ").trim();
  if (!trimmed) return true;
  return BLANK_ANSWER.test(trimmed);
}
