export const COACHING_PROFILE_MAX_BYTES = 8_192;
export const COACHING_NOTES_MAX_BYTES = 4_096;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function formatByteUsage(bytes: number, maxBytes: number): string {
  return `${bytes.toLocaleString("en-US")} / ${maxBytes.toLocaleString("en-US")} bytes`;
}

export function remainingPairingSeconds(
  expiresAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!expiresAtIso) {
    return 0;
  }
  const expiresMs = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((expiresMs - nowMs) / 1000));
}

export function formatPairingCountdown(
  expiresAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const remaining = remainingPairingSeconds(expiresAtIso, nowMs);
  if (remaining <= 0) {
    return null;
  }
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatClientTimestamp(iso: string | null): string {
  if (!iso) {
    return "Never";
  }
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
