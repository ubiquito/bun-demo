/**
 * The mission log ships as markdown, imported `with { type: "text" }`.
 * bun-types' extensions.d.ts covers *.txt and friends but stops short of *.md,
 * so this shim extends the same pattern one extension further.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
