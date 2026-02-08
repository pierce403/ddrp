export const DEFAULT_SNAP_ID = 'npm:erc5630-snap';
export const LOCAL_DEV_SNAP_ID = 'local:http://localhost:8081';
export const DEFAULT_SNAP_VERSION_RANGE = '^0.1.4';

const SNAP_ID_STORAGE_KEY = 'ddrp:snapId';

export function loadSnapId(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_SNAP_ID;
  try {
    const stored = localStorage.getItem(SNAP_ID_STORAGE_KEY);
    if (typeof stored === 'string' && stored.trim().length > 0) return stored.trim();
  } catch {
    // ignore
  }
  return DEFAULT_SNAP_ID;
}

export function saveSnapId(snapId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = snapId.trim();
    if (trimmed.length === 0) {
      localStorage.removeItem(SNAP_ID_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SNAP_ID_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
}

export function buildRequestSnapsParams(snapId: string): Record<string, { version?: string }> {
  const trimmed = snapId.trim();
  if (trimmed === DEFAULT_SNAP_ID) {
    return { [trimmed]: { version: DEFAULT_SNAP_VERSION_RANGE } };
  }
  return { [trimmed]: {} };
}
