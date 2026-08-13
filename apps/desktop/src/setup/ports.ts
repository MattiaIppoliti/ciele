// The setup engine's whole view of the outside world.
//
// The engine is pure: it never imports `electron`, `node:fs`, `node:crypto` or
// anything else that only exists in one process. Everything it can actually
// *do* arrives through these ports — which is why the step list can be tested
// exhaustively against scripted fakes, and why the same steps run unchanged
// against Docker in the app and against nothing at all in CI.
//
// Same pattern as the agent package's host ports and the Db seam: one
// interface, two implementations, one suite of behaviour that must hold for
// both.

export interface CommandResult {
  code: number;
  /** Combined stdout and stderr, in the order it arrived. */
  output: string;
}

export interface DockerPort {
  /**
   * Where the `docker` CLI is, or null when it is not installed.
   *
   * Separate from `isRunning` because they are different problems with
   * different fixes: "install Docker Desktop" versus "start Docker Desktop",
   * and telling a user the wrong one wastes their afternoon.
   */
  locate(): Promise<string | null>;
  /** Whether the daemon answers — installed is not running. */
  isRunning(): Promise<boolean>;
  /** A `docker compose` invocation against the app's own stack. */
  compose(args: readonly string[], onOutput?: (chunk: string) => void): Promise<CommandResult>;
}

export interface FsPort {
  ensureDir(path: string): Promise<void>;
  /** null when the file does not exist — absence is not an error here. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, contents: string, options?: { mode?: number }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface ProbeResponse {
  status: number;
  body: string;
}

export interface ProbePort {
  /** null when the host could not be reached at all, as opposed to answering badly. */
  get(url: string, timeoutMs?: number): Promise<ProbeResponse | null>;
}

/**
 * The two primitives secret generation needs. Not a "generate my secrets"
 * port: the *derivation* — which secrets, how long, how the JWTs are signed —
 * is the part with rules in it, so it belongs in the engine where it can be
 * tested, not behind a seam where a fake would simply agree with itself.
 */
export interface CryptoPort {
  randomBytes(count: number): Uint8Array;
  hmacSha256(key: string, message: string): Uint8Array;
}

export interface ClockPort {
  /** Unix seconds. JWT `iat`/`exp` are the only reason this exists. */
  nowSeconds(): number;
}

export interface SetupPorts {
  docker: DockerPort;
  fs: FsPort;
  probe: ProbePort;
  crypto: CryptoPort;
  clock: ClockPort;
}

/** Everything the steps need to know about *this* installation. */
export interface SetupConfig {
  /** Per-user directory holding the generated env and any state. */
  dataDir: string;
  /** Directory holding the compose file and env template shipped with the app. */
  deployDir: string;
  /**
   * Release tag of the images this build pins, or null when the build was
   * never stamped with a release (see shared/release.ts). The pull step says
   * so rather than failing against a tag that does not exist.
   */
  imageTag: string | null;
  /** Where the local product will serve. */
  appUrl: string;
  /** Where the local Supabase gateway will serve. */
  supabaseUrl: string;
  /** Download page for the one prerequisite the app cannot install itself. */
  dockerDownloadUrl: string;
  /**
   * What separates entries in the COMPOSE_FILE list this platform's Compose
   * expects — `;` on Windows (a colon is a drive letter there), `:` elsewhere.
   * Injected so the engine never asks what platform it is on.
   */
  composePathSeparator: string;
}
