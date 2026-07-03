// Loads the built event-schemas workspace package exactly once.
// A missing dist/ (gitignored; built by the root pretest / workspace build) is
// a deployment error and must fail LOUD: when this import sat inside the
// per-message validation try/catch, a missing build was misreported as
// bad_schema and every broadcast was silently dropped.
let schemasPromise = null;

export function loadEventSchemas() {
  schemasPromise ??= import('../packages/event-schemas/dist/index.js').catch((err) => {
    schemasPromise = null;
    throw new Error(
      `event-schemas dist missing or broken — run \`npm run --workspaces --if-present build\` (${err.message})`,
    );
  });
  return schemasPromise;
}
