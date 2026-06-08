export function sanitizeText(input: string, max = 500): string {
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

export const FIXTURE_ID_RE = /^FX-\d{3}-\d{4,}$/;

export function isValidFixtureId(s: string) {
  return FIXTURE_ID_RE.test(s.trim());
}
