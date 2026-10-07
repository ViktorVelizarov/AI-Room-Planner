/** The result of reading a number the user typed: the number, or a message to show next to the field. */
export type NumberCheck =
  | { ok: true; value: number }
  | { ok: false; message: string };

/**
 * Reads a number written with a decimal point or a decimal comma: "4", "3.5", "3,5", ".5".
 * Returns null for anything else, such as "abc", "4 m", "-3" or "1e3".
 */
export function readDecimal(text: string): number | null {
  const typed = text.trim();
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(typed)) return null;
  return Number(typed.replace(",", "."));
}
