const API_BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** The browser authenticates via the HttpOnly session cookie (set by
 * `POST /auth/login`), sent automatically by the browser's default
 * same-origin credential mode -- no header to attach here. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    let code: string | null = null;
    try {
      const errorBody = (await response.json()) as { detail?: string; code?: string };
      detail = errorBody.detail || detail;
      code = errorBody.code || null;
    } catch {
      // ignore body parse failures
    }
    throw new ApiError(detail, response.status, code);
  }
  if (response.status === 204) {
    return null as T;
  }
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function filenameFromContentDisposition(header: string | null): string | null {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1] : null;
}

/** For downloads (export) rather than JSON API calls: same auth header, but
 * returns the raw body and the server-suggested filename instead of parsing JSON. */
export async function apiFetchBlob(
  path: string
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new ApiError(`Request failed (${response.status})`, response.status, null);
  }
  const blob = await response.blob();
  return {
    blob,
    filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")),
  };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
