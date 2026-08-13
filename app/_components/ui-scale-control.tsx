"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_UI_SCALE, UI_SCALES, describeUiScale, parseUiScale, type UiScale } from "../../lib/views/ui-scale";

export function UiScaleControl(): ReactNode {
  const [scale, setScale] = useState<UiScale>(DEFAULT_UI_SCALE);
  useEffect(() => { void window.dashShell?.setUiScale?.().then((result) => {
    if (result.ok) setScale(parseUiScale(result.data?.factor));
  }); }, []);
  return <label className="fleet-view-option" title="Ctrl +, Ctrl -, and Ctrl 0 use the same bounded scale.">
    <span>Scale</span>
    <select value={scale} onChange={(event) => { const next = parseUiScale(Number(event.target.value)); setScale(next); void window.dashShell?.setUiScale?.(next); }}>
      {UI_SCALES.map((option) => <option key={option} value={option}>{describeUiScale(option)}</option>)}
    </select>
  </label>;
}
