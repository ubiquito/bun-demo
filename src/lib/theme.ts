/**
 * The ship's paint locker: one tiny module that makes every terminal demo
 * feel like the same vessel. Built entirely from Bun's own text utilities —
 * Bun.color for paint, Bun.stringWidth for layout, Bun.wrapAnsi for prose.
 */

const tty = Bun.enableANSIColors;

/** Paint `text` in any CSS color Bun.color understands (truecolor when possible). */
export function paint(color: string, text: string): string {
  if (!tty) return text;
  const code = Bun.color(color, "ansi-16m") ?? "";
  return `${code}${text}\x1b[0m`;
}

export const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s);
export const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[22m` : s);
export const italic = (s: string) => (tty ? `\x1b[3m${s}\x1b[23m` : s);

/** Mission palette — dawn over the curvature of a cinnamon planet. */
export const palette = {
  hull: "#94a3b8", // brushed steel
  glow: "#f9a8d4", // strawberry frosting nebula
  flame: "#fb923c", // engine burn
  caramel: "#d97706", // perfectly baked
  mint: "#6ee7b7", // life support green
  sky: "#7dd3fc", // observation glass
  alarm: "#f87171", // only for real failures
  star: "#fde68a", // distant suns
} as const;

export const ok = (s: string) => `${paint(palette.mint, "◆")} ${s}`;
export const warn = (s: string) => `${paint(palette.star, "◇")} ${s}`;
export const fail = (s: string) => `${paint(palette.alarm, "✕")} ${s}`;

/** A full-width rule, sized to the terminal (or 72 cols when piped). */
export function rule(color: string = palette.hull): string {
  const w = Math.min(process.stdout.columns || 72, 96);
  return paint(color, "─".repeat(w));
}

/** Deck banner: every demo opens with one of these. */
export function deck(emblem: string, name: string, subtitle: string): string {
  const title = `${emblem}  ${bold(paint(palette.glow, name.toUpperCase()))}`;
  return [
    "",
    rule(),
    title,
    dim(`   ${subtitle}`),
    rule(),
    "",
  ].join("\n");
}

/** Right-aligned measurement line: `label ······· value` */
export function gauge(label: string, value: string, color: string = palette.mint): string {
  const w = Math.min(process.stdout.columns || 72, 72);
  const left = `  ${label} `;
  const right = ` ${paint(color, value)}`;
  const dots = Math.max(1, w - Bun.stringWidth(left) - Bun.stringWidth(right));
  return left + dim("·".repeat(dots)) + right;
}

/** Wrap prose to the terminal width, ANSI-aware, with a left margin. */
export function prose(text: string, margin = 2): string {
  const w = Math.min(process.stdout.columns || 72, 88) - margin;
  return Bun.wrapAnsi(text, w)
    .split("\n")
    .map(line => " ".repeat(margin) + line)
    .join("\n");
}

export const fmt = {
  ms(n: number): string {
    if (n < 1) return `${(n * 1000).toFixed(0)} µs`;
    if (n < 1000) return `${n.toFixed(n < 10 ? 2 : 1)} ms`;
    return `${(n / 1000).toFixed(2)} s`;
  },
  us(n: number): string {
    return n < 1000 ? `${n.toFixed(1)} µs` : fmt.ms(n / 1000);
  },
  bytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 ** 2).toFixed(2)} MB`;
  },
  int(n: number): string {
    return Math.round(n).toLocaleString("en-US");
  },
} as const;

/** The ship's mark, for liftoff moments. */
export function emblemBanner(): string {
  const lines = [
    "        .  *       .          ✦",
    "   ✦        ___________          .",
    "        .-'  ORBITAL  '-.    *",
    "  .    /     BAKERY      \\        .",
    "      |   ~ fresh buns ~  |   ✦",
    "       \\  since v1.4.0   /",
    "    *   '-.___________.-'      .",
    "  ✦         |  |  |        *",
    `        ${"▲".padStart(5)}  liftoff  ${"▲".padEnd(2)}`,
  ];
  return lines
    .map((l, i) => paint(i < 3 ? palette.sky : i < 7 ? palette.glow : palette.flame, l))
    .join("\n");
}
