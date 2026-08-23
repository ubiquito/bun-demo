/**
 * Comms Bay — the ship's Bun.markdown deck. One mission log, three renderers:
 * the built-in HTML and ANSI passes, and a fully custom render() pass that
 * restyles the same document as a flight-deck comms transcript. The custom
 * pass is the point: every block and inline element routes through a plain
 * JavaScript callback, so the output format is entirely ours.
 */
import type { CommsReport, DeckStatus } from "../types.ts";
import { bold, dim, italic, paint, palette } from "../lib/theme.ts";
import log from "../content/mission-log.md" with { type: "text" };

export function commsStatus(): DeckStatus {
  if (typeof Bun.markdown?.render !== "function") {
    return { online: false, note: "Bun.markdown not aboard — this hull predates the comms array (needs Bun ≥ 1.4)" };
  }
  return { online: true, note: "all channels open — html, ansi, and the transcript renderer standing by" };
}

export function missionLog(): string {
  return log;
}

const strike = (s: string) => (Bun.enableANSIColors ? `\x1b[9m${s}\x1b[29m` : s);
const rail = dim("│ ");
const cellSep = " ⋮ ";

/** Re-render markdown as a comms transcript — every element remapped by hand. */
function transcript(markdown: string): string {
  return Bun.markdown.render(
    markdown,
    {
      heading: (c, { level }) =>
        `${paint(palette.glow, level === 1 ? "◈ TRANSMISSION ::" : "◈ SEGMENT ::")} ${bold(c)}\n\n`,
      paragraph: c => `${c}\n\n`,
      blockquote: c =>
        c.trim().split("\n").map(line => paint(palette.caramel, "▌ ") + italic(line)).join("\n") + "\n\n",
      code: (c, meta) =>
        paint(palette.hull, `┌─ data burst${meta?.language ? ` · ${meta.language}` : ""}`) + "\n" +
        c.replace(/\n$/, "").split("\n").map(line => rail + paint(palette.sky, line)).join("\n") +
        "\n" + paint(palette.hull, "└─ end burst") + "\n\n",
      list: (c, { depth }) => (depth === 0 ? `${c}\n` : `\n${c}`),
      listItem: (c, { depth, checked }) => {
        const mark =
          checked === true ? paint(palette.mint, "▣")
          : checked === false ? paint(palette.hull, "□")
          : paint(palette.flame, "▸");
        return `${"  ".repeat(depth)}${mark} ${c.trimEnd()}\n`;
      },
      hr: () => dim("─── ✦ ───") + "\n\n",
      // The table callback sees every finished row at once, so it can align
      // columns after the fact — Bun.stringWidth ignores the ANSI paint.
      table: c => {
        const rows = c.trimEnd().split("\n").map(line => line.split(cellSep));
        const widths: number[] = [];
        for (const cells of rows)
          cells.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, Bun.stringWidth(cell))));
        return rows
          .map(cells => "  " + cells.map((cell, i) => cell + " ".repeat(widths[i]! - Bun.stringWidth(cell))).join(dim(" ⋮ ")))
          .join("\n") + "\n\n";
      },
      tr: c => `${c.endsWith(cellSep) ? c.slice(0, -cellSep.length) : c}\n`,
      th: c => paint(palette.star, bold(c)) + cellSep,
      td: c => c + cellSep,
      // A bare autolink's text IS its href — skip the redundant bracket echo.
      link: (c, { href }) => (c === href ? paint(palette.sky, c) : `${paint(palette.sky, c)} ${dim(`⟨${href}⟩`)}`),
      strong: c => bold(paint(palette.glow, c)),
      emphasis: c => italic(c),
      strikethrough: c => strike(dim(c)),
      codespan: c => paint(palette.star, c),
    },
    { autolinks: true },
  );
}

/** One source, three renderers, every timing measured in this call. */
export function renderAll(markdown: string): CommsReport {
  const t0 = Bun.nanoseconds();
  const html = Bun.markdown.html(markdown, { headings: true, autolinks: true });
  const t1 = Bun.nanoseconds();
  const ansi = Bun.markdown.ansi(markdown);
  const t2 = Bun.nanoseconds();
  const custom = transcript(markdown);
  const t3 = Bun.nanoseconds();

  return {
    html,
    ansi,
    custom,
    chars: markdown.length,
    timings: { htmlUs: (t1 - t0) / 1e3, ansiUs: (t2 - t1) / 1e3, customUs: (t3 - t2) / 1e3 },
  };
}
