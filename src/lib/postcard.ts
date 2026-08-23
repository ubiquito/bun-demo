/**
 * Terminal postcards — when the terminal itself has a viewport, deliver the
 * screenshot straight into it; everywhere else, hand over the saved file path
 * and say nothing in escape bytes. Detection decides; graceful is the default.
 *
 * Two dialects are spoken planet-side:
 *  - Kitty graphics (`t=s` shared-memory transmission) — kitty, WezTerm,
 *    Konsole. Pairs with `view.screenshot({ encoding: "shmem" })`: Bun parks
 *    the PNG in a POSIX shm segment, the terminal reads it directly and
 *    unlinks it when done. Zero copies through the pipe.
 *  - iTerm2 inline images (OSC 1337 `File=`) — base64 through the pipe.
 */

/** Who is on the other end of stdout, as far as pictures are concerned. */
export type PostcardCarrier =
  | { protocol: "kitty"; via: string }
  | { protocol: "iterm2"; via: string }
  | { protocol: "none" };

/**
 * Sniff the environment for a graphics-capable terminal. Pure and injectable
 * so the demo can honor `--no-postcard` and tests could feed fake envs.
 *
 * Note the honest limitation: env vars are hearsay. A terminal that *claims*
 * kitty (`TERM=xterm-kitty` set by hand, or an ssh hop that forwards it) but
 * doesn't actually speak the protocol will never read the shm segment — so
 * shmem callers must sweep the segment name themselves after transmitting
 * (see demo 02). `--no-postcard` is the escape hatch.
 */
export function detectCarrier(
  env: Record<string, string | undefined> = process.env,
): PostcardCarrier {
  if (env.KITTY_WINDOW_ID) return { protocol: "kitty", via: "kitty" };
  if ((env.TERM ?? "").includes("kitty")) return { protocol: "kitty", via: `TERM=${env.TERM}` };
  // WezTerm and Konsole both speak the Kitty graphics protocol.
  if (env.WEZTERM_EXECUTABLE || env.TERM_PROGRAM === "WezTerm") {
    return { protocol: "kitty", via: "WezTerm" };
  }
  if (env.KONSOLE_VERSION) return { protocol: "kitty", via: "Konsole" };
  if (env.TERM_PROGRAM === "iTerm.app") return { protocol: "iterm2", via: "iTerm2" };
  return { protocol: "none" };
}

/**
 * Kitty graphics escape for a PNG already sitting in shared memory:
 * f=100 (PNG), t=s (shm transmission), a=T (transmit + display),
 * S=<byte size>; payload is the base64 of the segment name. A true kitty
 * reads the PNG from shared memory and unlinks the segment — but since
 * detection is hearsay, the caller still sweeps the name afterwards in
 * case nothing was listening (unlink-after-open never disturbs a reader).
 */
export function kittyShmemEscape(name: string, size: number): string {
  return `\x1b_Gf=100,t=s,a=T,S=${size};${btoa(name)}\x1b\\`;
}

/**
 * iTerm2 OSC 1337 inline image: the PNG rides the pipe as base64.
 * `size` (decoded byte count) is advisory — iTerm2 uses it for progress.
 */
export function itermInlineEscape(base64Png: string, filename = "postcard.png"): string {
  const padding = base64Png.endsWith("==") ? 2 : base64Png.endsWith("=") ? 1 : 0;
  const bytes = (base64Png.length / 4) * 3 - padding;
  return `\x1b]1337;File=name=${btoa(filename)};size=${bytes};inline=1:${base64Png}\x07`;
}
