# Decisions - fallback-title-improvement

## Session: ses_268c03c46ffeLNfPUQ7CZ87nfn

- Fallback title min length: 20 chars (consistent with postProcessTitle)
- Taobao high-freq word threshold: >= 2 occurrences
- generate-title.js degradation uses products[0].title when available
- No external deps for word extraction - pure string operations
