const values: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  one: 1, two: 2, three: 3, four: 4, five: 5,
};

export function normalizeBoundedCountToken(token: string | undefined, maximum = 5) {
  if (!token) return undefined;
  const normalized = token.normalize("NFKC").toLocaleLowerCase();
  const value = values[normalized] ?? Number(normalized);
  return Number.isInteger(value) && value >= 1 && value <= maximum ? value : undefined;
}
