/** Default timeout for read-only requests (GET, artifact fetch, etc.) */
export const DEFAULT_READ_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

/**
 * Create an AbortSignal that fires after `ms` milliseconds.
 * Returns undefined when ms <= 0 (no timeout).
 * The returned cleanup function MUST be called when the request settles
 * (success or failure) to prevent timer and listener leaks.
 */
function createTimeoutSignal(ms, existingSignal) {
  if (!ms || ms <= 0) return { signal: existingSignal, cleanup() {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  const onExternalAbort = () => { controller.abort(); clearTimeout(timer); };
  if (existingSignal) {
    if (existingSignal.aborted) { controller.abort(); clearTimeout(timer); return { signal: existingSignal, cleanup() {} }; }
    existingSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      if (existingSignal) existingSignal.removeEventListener('abort', onExternalAbort);
    }
  };
}

/**
 * Parse response JSON safely. Re-throws AbortError so timeouts are not
 * silently swallowed as empty objects.
 */
async function parseResponseJson(response) {
  try {
    return await response.json();
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return {};
  }
}

export async function requestPayload(url, options = {}) {
  const { allowApiError = false, body, headers, timeoutMs, ...requestOptions } = options;
  const hasJsonBody = body !== undefined && body !== null && typeof body !== 'string';
  // Only apply default timeout to read-only requests.
  // Write requests (POST) have no default timeout because backend operations
  // like title generation may take minutes. Callers can opt in via timeoutMs.
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const isReadOnly = method === 'GET' || method === 'HEAD';
  const effectiveTimeout = timeoutMs ?? (isReadOnly ? DEFAULT_READ_TIMEOUT_MS : 0);
  const { signal, cleanup } = createTimeoutSignal(effectiveTimeout, requestOptions.signal);
  try {
    const response = await fetch(url, {
      ...requestOptions,
      signal,
      headers: {
        ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: hasJsonBody ? JSON.stringify(body) : body
    });
    const payload = await parseResponseJson(response);

    if (!response.ok || (payload.ok === false && !allowApiError)) {
      throw new ApiError(
        payload.error || payload.userMessage || payload.message || `请求失败: ${response.status}`,
        { status: response.status, payload }
      );
    }
    return payload;
  } finally {
    cleanup();
  }
}

export async function requestJson(url, options = {}) {
  const payload = await requestPayload(url, options);
  return payload.data ?? payload;
}

/**
 * Upload a raw File/Blob body with custom headers.
 *
 * Unlike requestPayload, this does NOT JSON-serialize the body.
 * No default timeout — uploads and backend processing may take arbitrarily long.
 * Callers can opt in via timeoutMs.
 *
 * @param {string} url Request URL (may include query string).
 * @param {File|Blob} file Raw file body.
 * @param {object} [options]
 * @param {string} [options.contentType] MIME type; defaults to file.type or 'application/octet-stream'.
 * @param {object} [options.headers] Additional headers merged after Content-Type/X-File-Name.
 * @param {string} [options.errorPrefix] Error message prefix; defaults to '上传失败'.
 * @param {AbortSignal} [options.signal] AbortSignal for cancellation.
 * @param {boolean} [options.keepalive] Keep-alive hint for background uploads.
 * @param {number} [options.timeoutMs] Optional timeout in ms; no default.
 * @returns {Promise<any>} Unwrapped response data.
 */
export async function requestUpload(url, file, options = {}) {
  const { contentType, headers: extraHeaders, errorPrefix = '上传失败', signal, keepalive, timeoutMs } = options;
  const { signal: combinedSignal, cleanup } = createTimeoutSignal(timeoutMs || 0, signal);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: combinedSignal,
      headers: {
        'Content-Type': contentType || file.type || 'application/octet-stream',
        ...(file.name ? { 'X-File-Name': encodeURIComponent(file.name) } : {}),
        ...extraHeaders
      },
      body: file,
      ...(keepalive !== undefined ? { keepalive } : {})
    });
    const payload = await parseResponseJson(response);
    if (!response.ok || payload.ok === false) {
      throw new ApiError(
        payload.error || `${errorPrefix}: ${response.status}`,
        { status: response.status, payload }
      );
    }
    return payload.data ?? payload;
  } finally {
    cleanup();
  }
}
