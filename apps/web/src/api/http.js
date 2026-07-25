export class ApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function requestPayload(url, options = {}) {
  const { allowApiError = false, body, headers, ...requestOptions } = options;
  const hasJsonBody = body !== undefined && body !== null && typeof body !== 'string';
  const response = await fetch(url, {
    ...requestOptions,
    headers: {
      ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: hasJsonBody ? JSON.stringify(body) : body
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || (payload.ok === false && !allowApiError)) {
    throw new ApiError(payload.error || `请求失败: ${response.status}`, {
      status: response.status,
      payload
    });
  }
  return payload;
}

export async function requestJson(url, options = {}) {
  const payload = await requestPayload(url, options);
  return payload.data ?? payload;
}
