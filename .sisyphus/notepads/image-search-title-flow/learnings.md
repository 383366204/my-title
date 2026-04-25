Learnings from Task 5: Limit timing optimization and on-demand text search
- Prioritized moving limit/clustering steps earlier to reduce unnecessary image search on full result sets.
- Implemented on-demand text search fallback when image search yields no results or fails.
- Ensured --count semantics remain unchanged for final output count.
- Verified syntax: node -c src/index.js passes; image search now uses limited product set.
