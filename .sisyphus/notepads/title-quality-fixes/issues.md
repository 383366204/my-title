# Issues — title-quality-fixes

(Audited as of 2026-04-19)
- Must Have: All 8 title-quality criteria appear satisfied in codebase.
- Must NOT Have: A number of files were changed beyond the plan scope (CLI, 1688 search, index, GLM prompts, generate-title, banned words data). See diff report for details.
- Changed files (summary): bin/cli.js, data/banned-words.json, package.json, src/AGENTS.md, src/alibaba1688-client.js, src/generate-title.js, src/glm-client.js, src/index.js, src/search-1688.js, src/title-utils.js, and likely others per diff, totaling 12 files changed.
- Concrete blockers: The task requested a single-task audit with constrained scope; changes across CLI, 1688 search, and core title-generation modules violate the guardrails.
- Suggested follow-up: If the plan is to be revised, re-run audit after gating changes, and ensure all modifications are scoped to Title-quality fixes. Consider moving pre-flight changes into a separate task or sequence with explicit approval.
