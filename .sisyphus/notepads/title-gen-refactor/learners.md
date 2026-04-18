Learnings from Task 5 - Title Generation Refactor
- Replaced legacy word-frequency + three-part build with GLM-based generation.
- Introduced robust fallback when GLM fails (coreWord + rigid modifiers concatenation, no spaces).
- Ensured no whitespace-based Chinese tokenization is used in title assembly.
- Kept banned-words filtering via removeBannedWords; no changes to banned words data source.
- Validated via syntax checks and export surface tests.
- Next steps: integrate into index.js workflow and run end-to-end tests.
