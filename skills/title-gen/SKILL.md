# title-gen

Use this skill to generate Taobao-style product titles from a keyword, SYCM keyword data, or prepared 1688 products.

This skill is designed for weak agents. Prefer the CLI. Do not hand-write titles unless the CLI fails and the user asks for a manual fallback.

## Weak Agent Golden Path

Run one keyword:

```bash
node bin/cli.js "<keyword>" --length 60 --json
```

If a weak agent retries after timeout, cap candidate titles:

```bash
node bin/cli.js "<keyword>" --length 60 --count 3 --json
```

If the user or upstream agent can wait longer, pass an explicit runtime budget:

```bash
node bin/cli.js "<keyword>" --length 60 --count 3 --run-timeout-ms 180000 --json
```

Before planning to use `--use-image-search`, run preflight as an independent step:

```bash
node bin/cli.js title-gen-preflight --json
```

If preflight returns `requiresUserAction=true` or exits non-zero, stop before image search and show `userMessage`. Do not wait for the main title command to time out.

Run with SYCM data already collected:

```bash
node bin/cli.js "<keyword>" --keyword-file "<sycm-json-file>" --length 60 --json
```

Run research mode when the user only has a broad direction:

```bash
node bin/cli.js "<keyword>" --research --json
```

Batch mode:

```bash
node bin/cli.js --keywords "<keyword1>,<keyword2>" --length 60 --json
```

## Inputs

- `keyword`: a concrete product/search phrase, for example `戒指女款2026新款`.
- `length`: use `60` by default. This means about 30 Chinese characters.
- `count` / `--count`: candidate title count, not product count. Do not use `--count 10` or `--count 15` to mean "select 10 products".
- `keyword_data` / `--keyword-file`: optional SYCM rows. Use this when available.
- `products`: optional prepared 1688 products. If passed by API, the skill can skip 1688 search.

Set `ECOM_BANNED_WORDS_EXTRA=/path/to/custom-banned-words.json` to add local custom banned words. This is safer than remote auto-sync.

## Success Criteria

A result is usable only if:

- `ok !== false`.
- `products` is a non-empty array, or `titles` is a non-empty array.
- Each distribution candidate has a valid `产品链接` starting with `https://detail.1688.com/offer/`.
- `铺货标题` is not empty.
- The title is close to 60 bytes / 30 Chinese characters unless the source product is too short.
- The title does not contain obvious banned words, brand/IP words, or garbled text such as `????`.

## Output Fields To Trust

Weak agents should read these fields literally:

- `coreWord`: main product word.
- `blueOceanWord`: keyword used for generation.
- `products[].产品链接`: 1688 URL.
- `products[].铺货标题`: generated distribution title.
- `products[].蓝海词`: keyword used in title generation.
- `products[].风险提示`: product/title risk notes.
- `stats`: trace and diagnostics.

## Safe Next Steps

If the user wants distribution, do not submit directly from this skill.

Use this sequence:

```text
title-gen result -> human/IP review -> distribution-batch.txt -> 1688-distribution
```

Distribution line format:

```text
https://detail.1688.com/offer/<id>.html$$<铺货标题>
https://detail.1688.com/offer/<id>.html$$<铺货标题>$$<SYCM推荐类目>
```

## Failure Handling

- LLM JSON parse error: retry once. The project has robust JSON repair, so repeated parse errors usually mean provider output is broken.
- No products: retry with a broader keyword or call `alibaba1688` web search first.
- If result `status` is `no_products_fallback_titles`, these are generic title ideas only. Do not export them to distribution and do not call `1688-distribution`.
- `taobao-native` unavailable: continue without peer titles. Do not block title generation only because Taobao search failed.
- SYCM unavailable, `login_required`, `slider_required`, or `sycm_feature_required`: stop and ask the user to fix SYCM manually. Do not auto-login or drag sliders.
- Title too short: retry once with `--length 60`. If still short, report the exact title and do not pad with meaningless words manually.
- Timeout: retry once with `--count 3 --run-timeout-ms 180000`. For multiple keywords, do not run several full title commands in parallel; use batch mode or `pipeline-flow`.
- Error attribution: `title_generation_timeout` means title generation timed out. Only report 1688 rate limit when JSON has `source: "1688"` or `code: "1688_rate_limited"`.
- If JSON includes `retryWith`, follow it literally. Do not invent GLM/1688 rate-limit causes from timeout alone.

## Never Do These

- Do not invent 1688 product URLs.
- Do not distribute products directly from `title-gen`.
- Do not use `--count 10` or `--count 15` as a product-selection size.
- Do not launch three or more title-generation CLI commands in parallel.
- Do not ignore `风险提示`.
- Do not use products with missing offer id.
- Do not add brand, celebrity, Disney, anime, sports team, or luxury names unless the user explicitly approves the risk.
- Do not bypass human confirmation before final distribution.

## Public API

```js
const { run, batchRun } = require("./skills/title-gen");

const result = await run("戒指女款2026新款", {
  maxLength: 60,
  silent: true
});
```

Use CLI or MCP when possible; API is for internal orchestration.
