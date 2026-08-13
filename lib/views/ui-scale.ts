/** The bounded, per-window scale preference (MAR-614). */
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2] as const;
export type UiScale = (typeof UI_SCALES)[number];
export const DEFAULT_UI_SCALE: UiScale = 1;

export function parseUiScale(value: unknown): UiScale {
  return UI_SCALES.includes(value as UiScale) ? (value as UiScale) : DEFAULT_UI_SCALE;
}

export function describeUiScale(scale: UiScale): string {
  return `${Math.round(scale * 100)}%`;
}
