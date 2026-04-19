# Learnings - fallback-title-improvement

## Session: ses_268c03c46ffeLNfPUQ7CZ87nfn

## Key Conventions
- CommonJS (require/module.exports)
- JSDoc on all exports
- Chinese inline comments
- No ESLint/Prettier in project
- No test framework

## Model Routing
- `deep` category routes to working models
- `quick` category routes to minimax-m2.7 which TIMES OUT - NEVER use quick

## Code Patterns
- title-utils.js: Pure functions, cleanTitle uses whitelist regex /[^a-zA-Z0-9\u4e00-\u9fa5]/g
- removeBannedWords imported from ./banned-words in title-utils.js
- postProcessTitle pipeline: removeBannedWords → cleanTitle → ensureBlueOceanPrefix → normalizeLength → removeSpaces
