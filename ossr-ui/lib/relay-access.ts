// Credentials stay in memory and are scoped to an exact relay endpoint.
// Never persist them with receipts, diagnostics, URLs, or localStorage.
const credentials = new Map<string, string>();
const endpointKey = (url: string) => url.trim().replace(/\/$/, '');
export function setRelayAccessToken(url: string, token: string): void {
  if (token) credentials.set(endpointKey(url), token);
  else credentials.delete(endpointKey(url));
}
export function relayAccessHeaders(url: string): Record<string, string> {
  const token = credentials.get(endpointKey(url));
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export function clearRelayAccess(): void { credentials.clear(); }
