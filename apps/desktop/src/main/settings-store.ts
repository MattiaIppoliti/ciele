// Settings on disk, in the app's per-user data directory.
//
// A hand-rolled JSON file rather than a store dependency: there are four
// fields, and the read has to survive corruption anyway (see parseSettings),
// which is most of what a store would give us.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "../shared/state";

export class SettingsStore {
  private readonly file: string;
  private current: Settings;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "settings.json");
    this.current = this.read();
  }

  private read(): Settings {
    try {
      if (!existsSync(this.file)) return { ...DEFAULT_SETTINGS };
      return parseSettings(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      // Unreadable or malformed: the defaults are a working app, and the next
      // write repairs the file. Losing a base-URL preference is a smaller
      // failure than refusing to start.
      return { ...DEFAULT_SETTINGS };
    }
  }

  get(): Settings {
    return { ...this.current };
  }

  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch };
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(this.current, null, 2)}\n`, {
      mode: 0o600,
    });
    return this.get();
  }
}
