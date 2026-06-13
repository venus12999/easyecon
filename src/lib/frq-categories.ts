export type FrqCategory = {
  unit: number;
  nameEn: string;
  nameZh: string;
};

export const FRQ_CATEGORIES: FrqCategory[] = [
  { unit: 1, nameEn: "Basic Economic Concepts", nameZh: "基本经济学概念" },
  { unit: 2, nameEn: "Supply and Demand", nameZh: "供给与需求" },
  { unit: 3, nameEn: "Production, Cost, and Perfect Competition", nameZh: "生产、成本与完全竞争" },
  { unit: 4, nameEn: "Imperfect Competition", nameZh: "非完全竞争" },
  { unit: 5, nameEn: "Factor Markets", nameZh: "要素市场" },
  { unit: 6, nameEn: "Market Failure and Government", nameZh: "市场失灵与政府作用" },
];

export function getFrqUnit(title: string | null) {
  const value = (title ?? "").toLowerCase();
  if (value.includes("basic economic concepts")) return 1;
  if (value.includes("supply and demand")) return 2;
  if (value.includes("production, cost") || value.includes("perfect competition")) return 3;
  if (value.includes("imperfect competition")) return 4;
  if (value.includes("factor markets")) return 5;
  if (value.includes("market failure") || value.includes("role of government")) return 6;
  return null;
}