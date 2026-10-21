// Plain-text sanitising for user-generated content (reviews, notes). React escapes on render; this additionally
// removes markup, control / bidi-override characters and collapses whitespace so stored text is always inert.
export function cleanText(v, max = 2000) {
  return String(v ?? '')
    .replace(/<[^>]*>/g, ' ')                                            // tags
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '') // control + bidi overrides
    .replace(/javascript:|data:text\/html/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}
