import type { OperatorRecord } from './registry.js';

export type SponsorRequest = { transaction: string; user: string };
export type SponsorResult = { status: 'BROADCAST'; operator: string; transaction_id: string; fee_microstx: string };

/**
 * Sends an unchanged origin-signed transaction to eligible operators in order.
 * It only retries explicit pre-sponsorship capacity rejections, so a request
 * that may already have been signed or broadcast is never duplicated.
 */
export async function sponsorWithFailover(
  operators: readonly OperatorRecord[],
  request: SponsorRequest,
  fetcher: typeof fetch = fetch,
): Promise<SponsorResult> {
  const eligible = operators.filter(operator => operator.status === 'ONLINE' && operator.stxBalanceMicroStx > 0n);
  if (eligible.length === 0) throw new Error('No healthy operator has STX sponsorship capacity.');
  let lastFailure = 'No operator accepted the sponsorship request.';
  for (const operator of eligible) {
    let response: Response;
    try {
      response = await fetcher(`${operator.endpoint.replace(/\/$/, '')}/v1/sponsor`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request),
      });
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      continue;
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && isSponsorResult(body)) return body;
    if (!isCapacityRejection(response.status, body)) throw new Error(`Operator ${operator.operatorId} rejected request (${response.status}): ${JSON.stringify(body)}`);
    lastFailure = `Operator ${operator.operatorId} has insufficient STX.`;
  }
  throw new Error(lastFailure);
}

function isCapacityRejection(status: number, body: unknown): boolean {
  return status === 503 && typeof body === 'object' && body !== null && (body as Record<string, unknown>).error === 'INSUFFICIENT_STX';
}

function isSponsorResult(value: unknown): value is SponsorResult {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).status === 'BROADCAST' &&
    typeof (value as Record<string, unknown>).operator === 'string' && typeof (value as Record<string, unknown>).transaction_id === 'string' &&
    typeof (value as Record<string, unknown>).fee_microstx === 'string';
}
