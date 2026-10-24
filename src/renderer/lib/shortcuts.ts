/**
 * Cross-component one-shot signals (opened from global shortcuts).
 * A module-level flag is deliberate: navigating to the library may unmount and
 * remount the page, and an event fired before mount would be missed.
 */
let pendingSearchFocus = false;
let pendingImport = false;

export function requestSearchFocus(): void {
  pendingSearchFocus = true;
}

export function consumeSearchFocus(): boolean {
  const value = pendingSearchFocus;
  pendingSearchFocus = false;
  return value;
}

export function requestImport(): void {
  pendingImport = true;
}

export function consumeImport(): boolean {
  const value = pendingImport;
  pendingImport = false;
  return value;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}
