export function getSiteHostname(): string {
  if (typeof globalThis.location === "undefined") return "this PDS";
  return globalThis.location.hostname || "this PDS";
}
