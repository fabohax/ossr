/* Recommendations describe observations; they never change relay settings. */
function diagnosticChecks(snapshot) {
  const {relay, node} = snapshot;
  const checks = [];
  const add = (title, state, evidence, action) => checks.push({title, state, evidence, action});
  const endpoint = (title, health, action, required = true) => add(title,
    health.reachable ? 'pass' : required ? 'fail' : 'warn',
    [health.statusCode == null ? 'No HTTP response' : `HTTP ${health.statusCode}`, health.detail,
      health.latencyMs == null ? null : `${health.latencyMs} ms`].filter(Boolean).join(' · '),
    health.reachable ? 'No action needed.' : action);
  endpoint('Relay liveness', relay.live, 'Open Overview and start the relay if it is stopped. If it is already running, check the relay URL, port, and service configuration.');
  let underfunded = false;
  if (/^\d+$/.test(relay.sponsorBalanceMicroStx ?? '') && /^\d+$/.test(relay.minimumBalanceMicroStx ?? '')) {
    underfunded = BigInt(relay.sponsorBalanceMicroStx) < BigInt(relay.minimumBalanceMicroStx);
  }
  endpoint('Relay readiness', relay.ready, underfunded
    ? 'Fund the displayed sponsor principal with testnet STX above the configured minimum, allowing additional STX for transaction fees. Then refresh.'
    : relay.live.reachable
      ? 'Check the relay’s configured Stacks upstream and sponsor balance lookup. Review the relay service locally for configuration errors, then refresh.'
      : 'Restore relay liveness first, then refresh to check sponsor funding.');
  add('Sponsor funding', underfunded ? 'fail' : relay.sponsorBalanceMicroStx == null ? 'warn' : 'pass',
    relay.sponsorBalanceMicroStx == null ? 'Balance could not be verified.'
      : `Available: ${relay.sponsorBalanceMicroStx} microSTX · Minimum: ${relay.minimumBalanceMicroStx ?? 'unknown'} microSTX`,
    underfunded ? `Fund ${relay.sponsorPrincipal || 'the relay sponsor'} with testnet STX. Keep enough above the minimum to pay fees.`
      : relay.sponsorBalanceMicroStx == null ? 'Restore the relay’s upstream connection and refresh to verify funding.' : 'No action needed. Funding alone does not guarantee every request can be sponsored.');
  endpoint('Stacks follower', node.health, 'Start the local Stacks follower and check its RPC URL and port. If it is running, check its network connectivity and configuration.');
  add('Follower synchronization', node.fullySynced === true && node.health.reachable ? 'pass' : 'warn',
    !node.health.reachable ? 'Follower unavailable; synchronization cannot be checked.' : node.fullySynced == null ? 'The follower did not report is_fully_synced.'
      : node.fullySynced ? 'Follower reports fully synchronized.' : 'Follower reports synchronization in progress.',
    !node.health.reachable ? 'Restore the follower connection first.' : node.fullySynced === true ? 'No action needed.'
      : node.fullySynced == null ? 'Check the follower version and RPC response, then refresh.' : 'Allow the follower to catch up. If heights stop advancing, check its peers, disk space, and local service logs.');
  endpoint('Public reference', node.referenceHealth, 'Check internet connectivity and the public reference URL. The reference is advisory and does not block relay readiness.', false);
  add('Chain tip comparison', node.blocksBehind == null ? 'warn' : node.blocksBehind > 0 ? 'warn' : 'pass',
    node.blocksBehind == null ? 'Local and reference heights are not both available.'
      : `Local: ${node.stacksTipHeight} · Reference: ${node.referenceTipHeight} · Behind: ${node.blocksBehind} blocks`,
    node.blocksBehind == null ? 'Restore the missing node/reference connection and refresh.'
      : node.blocksBehind > 0 ? 'Refresh to see whether the gap closes. Heights are sampled separately; a small gap may be temporary.' : 'No action needed. A height comparison does not verify fork agreement.');
  for (const [title, enabled, action] of [
    ['Quote service', relay.quotesEnabled, 'Check the relay quote key, adapter, and sBTC contract configuration, then restart the relay.'],
    ['Sponsorship service', relay.sponsorshipsEnabled, 'Check relay sponsorship configuration and operator controls.']]) {
    add(title, enabled === true ? 'pass' : 'warn', enabled == null ? 'Service capability was not reported.' : enabled ? 'Enabled.' : 'Disabled.',
      enabled === true ? 'No action needed.' : enabled == null ? 'Check the relay /v1/info response and version.' : action);
  }
  return checks;
}
