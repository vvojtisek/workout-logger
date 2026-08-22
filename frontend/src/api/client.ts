const API_KEY_STORAGE_KEY = "workout_logger_api_key";
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

export function getStoredApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

export function setStoredApiKey(value: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, value);
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("X-API-Key", getStoredApiKey());
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
