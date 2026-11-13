const PREFERENCES_KEY = "workout_logger_rest_alert_preferences";
const LAST_DEADLINE_KEY = "workout_logger_last_rest_alert_deadline";

export interface RestAlertPreferences {
  sound: boolean;
  vibration: boolean;
}

type RestAlertStorage = Pick<Storage, "getItem" | "setItem">;

const DEFAULT_PREFERENCES: RestAlertPreferences = { sound: true, vibration: true };
const claimedDeadlines = new Set<string>();
let audioContext: AudioContext | null = null;

function browserStorage(): RestAlertStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRestAlertPreferences(
  storage: RestAlertStorage | null = browserStorage(),
): RestAlertPreferences {
  try {
    const saved = storage?.getItem(PREFERENCES_KEY);
    if (!saved) return { ...DEFAULT_PREFERENCES };
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
    const record = value as Record<string, unknown>;
    return {
      sound: typeof record.sound === "boolean" ? record.sound : DEFAULT_PREFERENCES.sound,
      vibration: typeof record.vibration === "boolean" ? record.vibration : DEFAULT_PREFERENCES.vibration,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writeRestAlertPreferences(
  preferences: RestAlertPreferences,
  storage: RestAlertStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Alert preferences are optional when browser storage is blocked.
  }
}

/** Uses both persistent and in-page guards so remounts cannot duplicate a cue. */
export function claimRestAlert(
  deadline: string,
  storage: RestAlertStorage | null = browserStorage(),
): boolean {
  if (!deadline || claimedDeadlines.has(deadline)) return false;
  try {
    if (storage?.getItem(LAST_DEADLINE_KEY) === deadline) {
      claimedDeadlines.add(deadline);
      return false;
    }
    storage?.setItem(LAST_DEADLINE_KEY, deadline);
  } catch {
    // The in-page guard below still protects repeated timer mounts.
  }
  claimedDeadlines.add(deadline);
  return true;
}

/** Called from a user gesture so mobile browsers can unlock Web Audio. */
export function unlockRestAlertAudio(): void {
  if (!readRestAlertPreferences().sound || typeof window === "undefined" || !window.AudioContext) return;
  try {
    if (!audioContext || audioContext.state === "closed") audioContext = new window.AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
  } catch {
    // Haptics and the visible timer remain available without Web Audio.
  }
}

function playTone(): void {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    if (!audioContext || audioContext.state === "closed") audioContext = new window.AudioContext();
    const context = audioContext;
    const play = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.21);
      window.setTimeout(() => {
        if (audioContext === context) {
          void context.close().catch(() => undefined);
          audioContext = null;
        }
      }, 400);
    };
    if (context.state === "suspended") void context.resume().then(play).catch(() => undefined);
    else play();
  } catch {
    // The visible countdown still signals completion if audio is unavailable.
  }
}

/** Claims one cue for an absolute rest deadline, even when effects are disabled. */
export function alertRestComplete(deadline: string): boolean {
  if (!claimRestAlert(deadline)) return false;
  const preferences = readRestAlertPreferences();
  if (preferences.sound) playTone();
  if (preferences.vibration && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate([80, 60, 80]);
  }
  return true;
}
