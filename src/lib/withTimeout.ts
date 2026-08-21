// Races a promise against a timeout so a call with no timeout of its own (a
// native GPS fix, a network request that can stall) always settles one way or
// another within a bounded time, instead of leaving an awaiting caller - and
// anything showing a loading state for it - stuck forever.
export function withTimeout<T>(promise: Promise<T>, ms: number, message = "Request timed out."): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}
