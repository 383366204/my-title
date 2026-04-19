# GLMClient Refactor Learnings

- Added shared LLm JSON parsing helper integration: parseJsonFromLLM and retry wrapper.
- Extracted  BANNED_WORDS_LIST and COMMON_TITLE_RULES_TEXT constants for reuse across prompts.
- Replaced 4 inline JSON parsing blocks with parseJsonFromLLM(content).
- Centralized title-rule insertion by using COMMON_TITLE_RULES_TEXT in generateTitles and selectAndGenerate prompts.
- Wrapped selectAndGenerate API call with retry(async () => { ... }, 1, 2000) to improve resilience.
- Confirmed syntax with node -c src/glm-client.js; imports rely on llm-utils existing in project.
- QA steps prepared and ready: syntax check, constant existence verification, and parsing replacements.
