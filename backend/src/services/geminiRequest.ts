// Kept as a compatibility boundary for saved jobs; direct Gemini calls are retired.
export async function geminiFetch(_url: string, _init: RequestInit, _timeoutMs = 90000, _pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<Response> {
  throw new Error("Direct Gemini API access has been disabled. Use an available OpenRouter model.");
}
