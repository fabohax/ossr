export type DiagnosticStage = 'relay' | 'quote' | 'wallet' | 'submission' | 'confirmation' | 'chain';
export type Diagnostic = { stage: DiagnosticStage; outcome: 'ok' | 'error'; durationMs: number };
// In-memory aggregate observations only. No URLs, addresses, quote IDs, errors,
// transaction IDs, signed bytes, or telemetry uploads.
const recent: Diagnostic[] = [];
export function recordDiagnostic(stage: DiagnosticStage, outcome: Diagnostic['outcome'], started: number) {
  const entry = { stage, outcome, durationMs: Math.max(0, Math.round(performance.now() - started)) };
  recent.push(entry);
  if (recent.length > 100) recent.shift();
}
export function readDiagnostics(): readonly Diagnostic[] { return recent.map(entry => ({ ...entry })); }
export async function measureOperation<T>(stage: DiagnosticStage, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { const value = await operation(); recordDiagnostic(stage, 'ok', started); return value; }
  catch (error) { recordDiagnostic(stage, 'error', started); throw error; }
}
