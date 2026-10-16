// Retry only explicit provider rejections; never replay ambiguous network failures.
export async function geminiFetch(url: string, init: RequestInit, timeoutMs = 90000, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (![429, 503].includes(response.status) || attempt >= 2) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Math.max(1000 * 2 ** attempt + Math.floor(Math.random() * 250), Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
    if (delay > 10000 || Date.now() + delay + 1000 >= deadline) return response;
    await response.arrayBuffer();
    await pause(delay);
  }
}
