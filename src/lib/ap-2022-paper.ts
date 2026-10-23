import { repairPrintedSpacing } from "@/lib/ap-exam-parse";

/** Official 2022 FRQ 3. The live row was missing parts (a)–(e) and the wage, price, and fixed cost. */
export const AP_2022_FRQ3_CONTENT = `The table represents the total quantity of textbooks that can be produced by a firm using different quantities of workers in a single day.

<table>
<tr><th>Number of Workers</th><th>Total Quantity of Textbooks Produced per Day</th></tr>
<tr><td>1</td><td>10</td></tr>
<tr><td>2</td><td>25</td></tr>
<tr><td>3</td><td>33</td></tr>
<tr><td>4</td><td>36</td></tr>
<tr><td>5</td><td>37</td></tr>
<tr><td>6</td><td>35</td></tr>
</table>

The workers are hired in a perfectly competitive labor market and are paid $200 per day, and these wages are the firm’s only variable cost. The firm also has a daily fixed cost of $500. Every textbook is sold at a unit price of $100.

(a) Calculate the average variable cost of producing 25 textbooks. Show your work.
(b) With the hiring of which worker do diminishing marginal returns begin for this firm? Explain using numbers.
(c) How many workers should this firm hire to maximize profits? Explain using marginal analysis.
(d) Calculate the firm’s economic profit if it hires the number of workers identified in part (c). Show your work.
(e) Assume the daily fixed cost increases to $1,000. What will happen to the profit-maximizing quantity of labor hired?`;

type FrqFace = {
  sort_order?: number | null;
  title?: string | null;
  content?: string | null;
  max_score?: number | null;
};

function isIncomplete2022Frq3(frq: FrqFace, slug?: string | null) {
  const text = `${frq.title ?? ""}\n${frq.content ?? ""}`;
  const textbook = /textbook/i.test(text) || /教材/.test(text);
  const named = (slug ?? "").includes("2022") && (frq.sort_order === 3 || textbook);
  if (!textbook && !named) return false;
  const missingPart = !/\([a-e]\)/i.test(text) || !/\(e\)/i.test(text);
  const missingNumbers = !/\$200/.test(text) || !/\$100/.test(text) || !/\$500/.test(text);
  return missingPart || missingNumbers;
}

export function presentExamFrqs<T extends FrqFace>(frqs: T[], slug?: string | null): T[] {
  return frqs.map((frq) => {
    const next = isIncomplete2022Frq3(frq, slug)
      ? {
          ...frq,
          content: AP_2022_FRQ3_CONTENT,
          max_score: frq.max_score == null || frq.max_score === 0 || frq.max_score === 9 ? 5 : frq.max_score,
        }
      : frq;
    return {
      ...next,
      title: next.title ? repairPrintedSpacing(next.title) : next.title,
      content: next.content ? repairPrintedSpacing(next.content) : next.content,
    };
  });
}
