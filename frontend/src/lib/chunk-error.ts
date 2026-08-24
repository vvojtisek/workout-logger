// Vite content-hashes each lazy-loaded route chunk, and the build deletes
// the previous build's files (`emptyOutDir: true`). A browser tab left open
// across a deploy still holds route definitions pointing at the old,
// now-deleted chunk filenames -- the first time it navigates to a route it
// hasn't loaded yet in that session, the dynamic import 404s. Browsers phrase
// this differently, so match all three.
const CHUNK_ERROR_PATTERN =
  /dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERN.test(message);
}

/** Guards against a reload loop if the chunk keeps failing for some other
 * reason (offline, a genuinely broken deploy): only worth retrying if the
 * last attempt was more than `windowMs` ago (or never happened). */
export function shouldRetryChunkReload(lastAttemptAt: number, now: number, windowMs: number): boolean {
  return now - lastAttemptAt > windowMs;
}
