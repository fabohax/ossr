export function isValidRelayUrl(value: string, pageUrl?: string): boolean {
  try {
    // Root-relative paths use the site's relay proxy. Reject protocol-relative
    // URLs and backslashes, which can redirect URL parsing to another host.
    const relative = value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
    const base = new URL(pageUrl ?? 'https://relay-validation.invalid');
    const url = relative ? new URL(value, base) : new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash
      && (!pageUrl || base.protocol !== 'https:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}
