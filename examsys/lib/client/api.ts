/** Browser-side fetch helper that understands the contract's error format. */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Network error. Check your connection and retry.");
  }
  const text = await response.text();
  const body = text ? safeParse(text) : null;
  if (!response.ok) {
    const error = body?.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `Request failed (${response.status})`,
      error?.fields ?? {},
      error?.details,
    );
  }
  return body as T;
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
