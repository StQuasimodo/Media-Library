/** Central motion preference check: explicit setting first, then the OS. */
export function prefersReducedMotion(): boolean {
  const attr = document.documentElement.dataset.motion;
  if (attr === 'reduce') return true;
  if (attr === 'full') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
