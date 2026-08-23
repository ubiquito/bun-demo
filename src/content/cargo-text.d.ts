/**
 * The cargo manifests are imported `with { type: "text" }` so they ship inside
 * the compiled oven-1 binary. bun-types declares `*.jsonl` not at all and
 * `*.xml` as a pre-parsed document; these longer (more specific) patterns win
 * module resolution for the cargo bay and type every embed as the raw string
 * the parsers actually receive.
 */
declare module "*/content/cargo/events.jsonl" {
  const text: string;
  export default text;
}
declare module "*/content/cargo/manifest.xml" {
  const text: string;
  export default text;
}
