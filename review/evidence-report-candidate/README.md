# Guarded evidence-report review candidate

This directory is a separate source/test candidate. It is not wired into the root application and does not replace its reporting commands or state.

The read-only evidence-report.mjs command requires an explicit journal, candidate, candidate version and mode. Invalid arguments exit2; blocked evidence exits5 with null score/protocol; a diagnostic result exits0 with approval:false. No result grants approval to trade or establishes performance or authenticity.

The included targeted test set uses synthetic temporary fixtures. Run only the ten named test files, not the root application or unrestricted project-wide test discovery. No dependencies need installing for this candidate.

Existing root reporting APIs are unchanged and remain outside this guard. Review and adoption are separate steps.
