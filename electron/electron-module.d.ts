/**
 * TEMPORARY — delete this file the moment `electron` is a real dependency.
 *
 * This slice ships the main-process *skeleton* without installing Electron.
 * The reason is proportionality: `electron` pulls a ~150 MB platform binary at
 * install time (ADR 0001 accepts that cost for the shipped product), and this
 * slice contains no code that can be run or packaged yet. Paying that on every
 * `pnpm install` and in CI, to typecheck two wiring files, is the wrong trade
 * this early — the dependency belongs with the packaging phase that can
 * actually launch the thing.
 *
 * So the surface `electron/main.ts` and `electron/preload.ts` touch is declared
 * here instead. It is deliberately minimal: only the members those two files
 * use, typed as loosely as is honest. That still gives real value — the wiring
 * is typechecked against a stated API rather than being an untyped island — but
 * it is NOT a substitute for the real types.
 *
 * When the packaging phase runs `pnpm add -D electron`, delete this file. The
 * real package ships its own types, and leaving an ambient `declare module
 * "electron"` beside them will conflict. Failing loudly at that point is
 * intended: it forces the wiring to be rechecked against the true API.
 */

declare module "electron" {
  export interface WebPreferences {
    [key: string]: unknown;
    preload?: string;
  }

  export interface BrowserWindowOptions {
    width?: number;
    height?: number;
    show?: boolean;
    webPreferences?: WebPreferences;
  }

  export interface WebContents {
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" | "allow" }): void;
    on(
      event: "will-navigate",
      listener: (event: { preventDefault(): void }, url: string) => void,
    ): void;
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowOptions);
    static getAllWindows(): BrowserWindow[];
    readonly webContents: WebContents;
    once(event: "ready-to-show", listener: () => void): void;
    show(): void;
    loadURL(url: string): Promise<void>;
  }

  export interface App {
    whenReady(): Promise<void>;
    on(event: "activate" | "window-all-closed", listener: () => void): void;
    quit(): void;
  }

  export const app: App;

  export interface IpcMainInvokeEvent {
    readonly senderFrame: unknown;
  }

  export interface IpcMain {
    handle(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ): void;
  }

  export const ipcMain: IpcMain;

  export interface ContextBridge {
    exposeInMainWorld(key: string, api: unknown): void;
  }

  export const contextBridge: ContextBridge;

  export interface IpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  }

  export const ipcRenderer: IpcRenderer;
}
