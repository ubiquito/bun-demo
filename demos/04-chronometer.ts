/**
 * Chronometer, standalone: taste a menu of cron expressions through
 * Bun.cron.parse, watch one bad expression bounce off gracefully, then put
 * the ship's own routines on the wheel — and take them off before landing.
 */
import { deck, dim, fmt, gauge, ok, paint, palette, prose, warn } from "../src/lib/theme.ts";
import { startShipJobs, stopShipJobs, windows } from "../src/systems/chronometer.ts";

const beat = () => Bun.sleep(90);

const whenFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

const inWords = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 90) return `in ${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `in ${m} min`;
  const h = s / 3600;
  if (h < 48) return `in ${h.toFixed(1)} h`;
  return `in ${(h / 24).toFixed(1)} d`;
};

const chart = async (expr: string, blurb: string, count = 3) => {
  await beat();
  const report = windows(expr, count);
  console.log(gauge(paint(palette.sky, expr), blurb, palette.hull));
  for (const iso of report.next) {
    const at = new Date(iso);
    console.log(dim(`      → ${whenFmt.format(at)}   ${inWords(at.getTime() - Date.now())}`));
  }
};

console.log(deck("🕰", "Chronometer", "Bun.cron + Bun.cron.parse — schedules read, windows charted, routines on the wheel"));

console.log(ok("tasting menu — four schedules, next three windows each, parsed just now"));
console.log();
await chart("*/15 * * * *", "quarter-hour proof check");
await chart("30 9 * * MON-FRI", "weekday stand-up, named weekdays");
await chart("@daily", "nickname for 0 0 * * * — inventory at midnight");
await chart("0 0 1 JAN,JUN *", "biannual deep-clean, named months");

await beat();
console.log();
console.log(ok("one schedule, two ports — same expression, {tz} decides the instant"));
const opening = "0 7 * * *";
const newYork = Bun.cron.parse(opening, Date.now(), { tz: "America/New_York" })!;
const tokyo = Bun.cron.parse(opening, Date.now(), { tz: "Asia/Tokyo" })!;
console.log(gauge(`${opening} · tz America/New_York`, `${newYork.toISOString()}`, palette.sky));
console.log(gauge(`${opening} · tz Asia/Tokyo`, `${tokyo.toISOString()}`, palette.glow));
const gapH = Math.abs(newYork.getTime() - tokyo.getTime()) / 3_600_000;
console.log(dim(prose(`Both bakeries open at 07:00 on their own clocks — instants ${gapH.toFixed(0)} h apart on the mission clock.`, 4)));

await beat();
console.log();
console.log(ok("and when a schedule is nonsense, the parser says so — no crash, just a report"));
const bad = windows("61 25 * * PIEDAY");
console.log(gauge(paint(palette.star, bad.expr), bad.valid ? "unexpectedly fine?" : "rejected", palette.star));
console.log(warn(`parser verdict: ${bad.error ?? "—"}`));

await beat();
console.log();
console.log(ok("ship routines going on the wheel — three live in-process jobs"));
startShipJobs(job => console.log(ok(`pulse from ${job}`)));
const shipJobs = windows("* * * * *", 1).jobs;
for (const job of shipJobs) {
  const first = new Date(windows(job.expr, 1).next[0]!);
  console.log(
    gauge(
      `${job.name} · ${paint(palette.sky, job.expr)}`,
      `first fire ${whenFmt.format(first)} · ${inWords(first.getTime() - Date.now())}`,
    ),
  );
}
console.log(dim(prose(
  "We won't loiter for the first fire — jobs run in this process, share its state, never " +
  "stack overlapping runs, and survive `bun --hot` edits without leaking timers.", 4,
)));

await beat();
stopShipJobs();
console.log(ok("wheel cleared — every job stopped, the event loop is free, the ship may land"));

await beat();
console.log();
console.log(dim(prose(
  "Also aboard, not fired today: the OS-level form — `await Bun.cron(\"./worker.ts\", \"30 2 * * MON\", " +
  "\"weekly-report\")` writes a real crontab / launchd / Task Scheduler entry that survives " +
  "reboots, and `Bun.cron.remove(\"weekly-report\")` erases it again.",
)));
console.log();
console.log(dim(prose(
  "Why it matters: scheduling used to mean node-cron or a hand-rolled crontab. Now the runtime " +
  "parses the expression, previews the windows, runs the job, and can even file it with the OS " +
  `— zero dependencies, one clock. ${fmt.int(shipJobs.length)} routines registered and released in this run alone.`,
)));
console.log();
