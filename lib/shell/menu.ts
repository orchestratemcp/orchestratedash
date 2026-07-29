/**
 * The application menu, decided as data.
 *
 * DASH has not had a menu at all: Electron's default one appeared, which is a
 * File/Edit/View/Window/Help skeleton with nothing of DASH's in it. MAR-423
 * needs one item in front of a novice — *"Try a sample agent"* — and the moment
 * a menu carries product copy it becomes a guided-path surface, which means the
 * plain-language rule applies to it and something has to be able to check that.
 *
 * So the template is data and this module is pure. `electron/main.ts` maps each
 * `action` to a handler; nothing here knows what any of them do.
 *
 * ## Why the sample agent is in a menu at all
 *
 * Because MAR-432 (DASH-20) has not landed, so the packaged renderer is still a
 * placeholder and a button in the Next UI would not exist in the installed
 * product. The menu exists in both. When the real renderer lands the button
 * belongs on the page too — the menu item is not a substitute for it, and it is
 * not a reason to skip it.
 */

/** Everything the menu can ask `electron/main.ts` to do. */
export type MenuAction = "sample_agent";

export interface MenuItemSpec {
  /** Omitted for a separator. */
  label?: string;
  /** Present exactly when this item does something DASH-specific. */
  action?: MenuAction;
  /** An Electron role, for the items the platform words better than we would. */
  role?: string;
  separator?: boolean;
  accelerator?: string;
}

export interface MenuSpec {
  label: string;
  items: MenuItemSpec[];
}

/**
 * Roles rather than labels wherever the platform already has a word for it.
 *
 * "Zoom In" and "Minimise" are spelled differently on each platform and by each
 * locale, and Electron's roles are already translated. Writing our own would be
 * a guided-path surface saying "Zoom In" in English to somebody whose entire
 * operating system is in Swedish.
 */
export function applicationMenu(platform: NodeJS.Platform, appName: string): MenuSpec[] {
  const isMac = platform === "darwin";

  const dashMenu: MenuSpec = {
    label: isMac ? appName : "&DASH",
    items: [
      // First item in the first menu: for a novice with an empty DASH, this is
      // the only thing on screen worth clicking, and it should not be reached
      // past anything.
      { label: "Try a sample agent…", action: "sample_agent" },
      { separator: true },
      ...(isMac
        ? [
            { role: "about" },
            { separator: true },
            { role: "services" },
            { separator: true },
            { role: "hide" },
            { role: "hideOthers" },
            { separator: true },
            { role: "quit" },
          ]
        : [{ role: "quit" }]),
    ],
  };

  return [
    dashMenu,
    {
      label: "&Edit",
      items: [
        { role: "undo" },
        { role: "redo" },
        { separator: true },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "&View",
      items: [
        { role: "reload" },
        { separator: true },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { separator: true },
        { role: "togglefullscreen" },
        // Kept, and deliberately last. It is how anyone reports a renderer bug,
        // and a novice who opens it by accident can close it the same way.
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "&Window",
      items: isMac
        ? [{ role: "minimize" }, { role: "zoom" }, { separator: true }, { role: "front" }]
        : [{ role: "minimize" }, { role: "close" }],
    },
  ];
}

/** Every label a user can read, for the plain-language assertion. */
export function menuLabels(menus: readonly MenuSpec[]): string[] {
  return menus.flatMap((menu) => [
    menu.label,
    ...menu.items.map((item) => item.label).filter((label): label is string => label !== undefined),
  ]);
}
