export const TRACE_COMPLETION_TIMEOUT_MS = 10_000

/** A missing browser event must not prevent the harness from closing its page. */
export async function waitForTraceCompletion(
  completion: Promise<string | undefined>
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const stream = await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Diagnostic trace completion timed out; no native trace was produced")),
          TRACE_COMPLETION_TIMEOUT_MS
        )
      }),
    ])
    if (!stream) throw new Error("Diagnostic trace did not return a stream")
    return stream
  } finally {
    clearTimeout(timer)
  }
}
