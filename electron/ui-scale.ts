import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_UI_SCALE, parseUiScale, type UiScale } from "../lib/views/ui-scale";

const FILE_NAME = "ui-scale.json";

export function readUiScale(userData: string): UiScale {
  try {
    return parseUiScale(JSON.parse(readFileSync(path.join(userData, FILE_NAME), "utf8")).factor);
  } catch {
    return DEFAULT_UI_SCALE;
  }
}

export function writeUiScale(userData: string, factor: unknown): UiScale {
  const scale = parseUiScale(factor);
  const target = path.join(userData, FILE_NAME);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify({ factor: scale }), "utf8");
  renameSync(temporary, target);
  return scale;
}
