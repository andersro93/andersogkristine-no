/**
 * Per-device identity and the remembered name. localStorage can be
 * unavailable (private mode / quota) — fall back to in-memory values so the
 * page still works for the session.
 */
const DEVICE_KEY = "galleri_device";
const NAME_KEY = "galleri_navn";
let memoryDevice: string | null = null;
let memoryName = "";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getDeviceId(): string {
  const stored = read(DEVICE_KEY);
  if (stored) return stored;
  if (!memoryDevice) memoryDevice = crypto.randomUUID();
  write(DEVICE_KEY, memoryDevice);
  return memoryDevice;
}

export function getSavedName(): string {
  return read(NAME_KEY) ?? memoryName;
}

export function saveName(name: string): void {
  memoryName = name;
  write(NAME_KEY, name);
}
