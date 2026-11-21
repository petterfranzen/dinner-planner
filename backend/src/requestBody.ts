// Runtime type checks for request bodies. Express's JSON parser hands back
// whatever the client sent, so a field the code assumes is a string can arrive
// as a number, an object or an array. Calling `.trim()` on one of those throws
// - and inside an async handler that is an unhandled rejection that takes the
// process down. Every route reads its body through these helpers, so a
// mistyped field is a 400 instead of a crash.

/** True unless the value is a non-blank string (numbers, objects, arrays,
 *  null and undefined all read as blank). */
export function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** The trimmed string when the value is one, else null (absent or wrong type). */
export function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** True when the value is a plain object - not null, and not an array. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the value is a number, or absent (undefined or null). */
export function isOptionalNumber(value: unknown): boolean {
  return value == null || typeof value === "number";
}
