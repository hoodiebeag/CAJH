/**
 * The audit checklist that reaches the model, and the id the journal records so its effect can be
 * measured rather than assumed.
 *
 * WHY THIS IS A SEPARATE FILE WITH A VERSION ID. The text is guidance sent to the decider, so a
 * change to it changes behaviour. Keeping it here makes every revision a diff in version control,
 * and `CHECKLIST_ID` is what the journal stores per batch — without that, the batches decided with
 * this text and the batches decided without it are indistinguishable afterwards and the whole thing
 * is unfalsifiable.
 *
 * WHAT IT IS NOT. These are questions drawn from trading literature (docs/READING-NOTES.md), which
 * is second-hand reading this project has not validated. They establish no edge, set no limit and
 * gate nothing. Every binding number — position cap, batch cap, gross exposure, the drawdown brake —
 * lives in analyst/risk.mjs, is enforced after the model answers, and is unchanged by this file.
 * Nothing here introduces a threshold of its own; there is a test that asserts it introduces no
 * numbers at all.
 *
 * THE FAILURE MODE THIS TEXT IS WRITTEN AGAINST. Prose about what good traders do invites a model to
 * narrate in that register: theses that read as more disciplined without being better informed. That
 * would be invisible to a review asking whether a thesis states a reason that could be wrong,
 * because well-written boilerplate does. So the two fields it asks for are ones that can be checked
 * against the record later, and "not known from this context" is named as an acceptable answer —
 * because the alternative to an honest blank is a confident invention.
 */

/** Bump this whenever AUDIT_CHECKLIST changes. The journal stores it; a silent edit breaks the split. */
export const CHECKLIST_ID = "audit-v1";

export const AUDIT_CHECKLIST = [
  "AUDIT QUESTIONS. These come from trading literature (docs/READING-NOTES.md in this repository),",
  "NOT from anything this system has measured. They establish no edge and impose no limit. The only",
  "numbers that bind you are the HARD CONSTRAINTS above, which come from code that runs after you",
  "answer. Answer these honestly; do not treat them as a template to satisfy.",
  "",
  "Before you choose a size, consider the downside if your thesis is invalidated against the upside",
  "you expect, and whether the two are asymmetric in your favour. Position size, gross exposure and",
  "the drawdown brake are enforced in code and are not yours to set.",
  "",
  "For each position you propose, add these two fields:",
  '  "invalidation": the specific observable that would tell you this thesis is WRONG -- a price',
  "      level, a scheduled release, a deterioration you can name. Something a reader could check",
  '      against the record later. Not "if the market turns", and not a restatement of the thesis.',
  '  "costAssumption": what you are assuming about spread, slippage and your ability to be filled at',
  "      the size implied by your target weight. An edge that dies on execution is not an edge.",
  "",
  "If the evidence in front of you does not support an answer, write exactly",
  '  "not known from this context"',
  "which is an acceptable answer and a useful one. A plausible answer you cannot support from the",
  "candidate data is worse than no answer, because it will be read later as though you had evidence",
  "for it.",
  "",
  "Do not restate these questions back to me. Do not add fields other than the two named above.",
].join("\n");
