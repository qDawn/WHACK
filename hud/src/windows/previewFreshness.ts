/**
 * Which window previews need a new frame.
 *
 * A hwnd is captured when it appears, its title changes, or it becomes the
 * foreground window. A hwnd that left the list is not captured. The foreground
 * hwnd is included only when it is a member of `next` and it differs from
 * `previousForeground`. The same lists and the same foreground produce nothing,
 * so a later poll does not grab those windows again.
 */

export type PreviewWindow = {
  hwnd: string;
  title: string;
};

export function dirtyWindows(
  previous: readonly PreviewWindow[],
  next: readonly PreviewWindow[],
  foregroundHwnd: string | null,
  previousForeground: string | null = foregroundHwnd,
): string[] {
  const prior = new Map<string, string>();
  for (const window of previous) {
    if (!prior.has(window.hwnd)) prior.set(window.hwnd, window.title);
  }

  const dirty: string[] = [];
  const seen = new Set<string>();
  for (const window of next) {
    const title = prior.get(window.hwnd);
    const changed = title === undefined || title !== window.title;
    if (!changed || seen.has(window.hwnd)) continue;
    seen.add(window.hwnd);
    dirty.push(window.hwnd);
  }

  const foregroundChanged = foregroundHwnd !== previousForeground;
  if (
    foregroundChanged &&
    foregroundHwnd &&
    next.some((window) => window.hwnd === foregroundHwnd) &&
    !seen.has(foregroundHwnd)
  ) {
    dirty.push(foregroundHwnd);
  }
  return dirty;
}

/** The floating preview follows the selected card, never a hovered or loading neighbour. */
export function selectedPreviewHwnd(windows: readonly { hwnd: string }[], selectedIndex: number): string | null {
  return windows[selectedIndex]?.hwnd ?? null;
}

/**
 * A preview that is still loading does not move the selection.
 * Loading a card other than the selected one leaves `selectedIndex` where it is.
 */
export function indexAfterPreviewLoad(
  selectedIndex: number,
  loadingHwnd: string | null,
  selectedHwnd: string | null,
): number {
  if (loadingHwnd && loadingHwnd !== selectedHwnd) return selectedIndex;
  return selectedIndex;
}
