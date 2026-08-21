/** @param {string} value */
export function parseRepsPerSet(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number.parseInt(part, 10));
}
