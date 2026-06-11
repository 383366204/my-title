/**
 * LLM output helpers.
 * Provides JSON extraction/parsing and a simple async retry wrapper.
 */

/**
 * Parse JSON from LLM output.
 * Supports plain JSON, fenced Markdown JSON, JSON embedded in text,
 * trailing commas, and reasoning blocks such as MiniMax `<think>...</think>`.
 *
 * @param {string} content LLM output that may contain JSON and extra text
 * @returns {any} Parsed JSON object or array
 */
function parseJsonFromLLM(content) {
  if (typeof content !== 'string') throw new Error('Expected string input');

  let text = stripReasoningBlocks(content.trim());
  text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/, '').trim();

  const extractedCandidates = extractJsonCandidates(text);
  const candidates = [
    ...extractedCandidates,
    ...(!extractedCandidates.includes(text) ? [text] : [])
  ];

  if (extractedCandidates.length === 0) {
    throw new SyntaxError('No JSON object or array found in LLM output');
  }

  let lastError;
  for (const candidate of candidates) {
    try {
      return parseJsonCandidate(candidate);
    } catch (err) {
      lastError = err;
    }
  }

  try {
    return parseJsonCandidate(text);
  } catch (err) {
    throw lastError || err;
  }
}

/**
 * Validate parsed LLM JSON with a zod schema.
 *
 * @param {any} value Parsed JSON value
 * @param {object} schema Zod schema
 * @param {string} label Human-readable response label
 * @returns {any} Validated value
 */
function validateLLMJson(value, schema, label = 'LLM response') {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const details = result.error.issues
    .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid ${label}: ${details}`);
}

/**
 * Repair and parse a JSON candidate.
 *
 * @param {string} candidate JSON candidate
 * @returns {any} Parsed JSON
 */
function parseJsonCandidate(candidate) {
  const normalized = stripTrailingCommas(candidate);
  try {
    return JSON.parse(normalized);
  } catch (err) {
    return JSON.parse(jsonrepair(normalized));
  }
}

/**
 * Remove model reasoning sections before JSON extraction.
 *
 * @param {string} text LLM output
 * @returns {string} Output with reasoning tags removed
 */
function stripReasoningBlocks(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*?(?=[{[])/i, '')
    .trim();
}

/**
 * Extract balanced JSON objects or arrays from surrounding text.
 *
 * @param {string} text Text that may contain JSON
 * @returns {string[]} JSON candidates, or the original text when none is found
 */
function extractJsonCandidates(text) {
  const candidates = [];

  for (let start = findJsonStart(text, 0); start !== -1; start = findJsonStart(text, start + 1)) {
    const candidate = readBalancedJson(text, start);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

/**
 * Read one balanced JSON object or array at a known start offset.
 *
 * @param {string} text Text that may contain JSON
 * @param {number} start Offset of `{` or `[`
 * @returns {string|null} JSON candidate, or null when unbalanced
 */
function readBalancedJson(text, start) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if ((ch === '}' && open !== '{') || (ch === ']' && open !== '[')) {
        return null;
      }
      if (stack.length === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Remove JSON trailing commas often produced by LLMs.
 *
 * @param {string} text JSON candidate
 * @returns {string} JSON candidate without trailing commas
 */
function stripTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Find the first plausible JSON opening bracket.
 *
 * @param {string} text Text to scan
 * @param {number} [fromIndex=0] Offset to start scanning
 * @returns {number} Offset of the first JSON opener, or -1
 */
function findJsonStart(text, fromIndex = 0) {
  for (let i = fromIndex; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') return i;
  }
  return -1;
}

/**
 * Retry an async function.
 *
 * @param {Function} fn Async function returning a Promise
 * @param {number} [maxRetries=2] Max retry count, excluding the first attempt
 * @param {number} [delayMs=1000] Delay between retries in milliseconds
 * @param {Function} [shouldRetry] Optional predicate that receives the error
 * @returns {Promise<any>} First successful return value
 */
async function retry(fn, maxRetries = 2, delayMs = 1000, shouldRetry = null) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (shouldRetry && !shouldRetry(err)) throw err;

      const retryable = shouldRetry
        ? shouldRetry(err)
        : (err.code || err.response);

      if (!retryable) throw err;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

module.exports = { parseJsonFromLLM, retry, validateLLMJson };
const { jsonrepair } = require('jsonrepair');
