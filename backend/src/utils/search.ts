export function toFtsQuery(input: string): string | null {
  const terms = input.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}
