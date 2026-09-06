import { getAuthenticatedWorkosSession } from "@/lib/auth/workos"
import { readRetainedChatStream } from "@/lib/chat-stream/server"
import { fetchQuery } from "convex/nextjs"
import { beforeEach, expect, it, vi } from "vitest"
import { GET } from "./route"

vi.mock("@/lib/auth/workos", () => ({ getAuthenticatedWorkosSession: vi.fn() }))
vi.mock("@/lib/chat-stream/server", () => ({ readRetainedChatStream: vi.fn() }))
vi.mock("convex/nextjs", () => ({ fetchQuery: vi.fn() }))

const request = () =>
  new Request("http://localhost/api/chat/chat/stream?runId=run")
const params = { params: Promise.resolve({ chatId: "chat" }) }
const run = {
  runId: "run",
  assistantMessageId: "assistant",
  status: "streaming",
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getAuthenticatedWorkosSession).mockResolvedValue({
    accessToken: "test-token",
    user: { id: "test-user" },
  } as Awaited<ReturnType<typeof getAuthenticatedWorkosSession>>)
})

it("never reads Redis without a session or an owned selected run on the selected path", async () => {
  vi.mocked(getAuthenticatedWorkosSession).mockResolvedValueOnce(null)
  expect((await GET(request(), params)).status).toBe(401)
  expect(fetchQuery).not.toHaveBeenCalled()
  for (const [selected, path] of [
    [null, { selectedMessages: [] }],
    [
      { ...run, runId: "different-run" },
      { selectedMessages: [{ _id: "assistant" }] },
    ],
    [run, { selectedMessages: [{ _id: "different-branch" }] }],
  ]) {
    vi.mocked(fetchQuery)
      .mockResolvedValueOnce(selected)
      .mockResolvedValueOnce(path)
    expect((await GET(request(), params)).status).toBe(404)
  }
  expect(readRetainedChatStream).not.toHaveBeenCalled()
})

it("retries preparation, settles an expired replay, and serves an authorized stream without caching", async () => {
  vi.mocked(readRetainedChatStream).mockResolvedValue(null)
  for (const [status, expected] of [
    ["streaming", 503],
    ["completed", 204],
  ] as const) {
    vi.mocked(fetchQuery)
      .mockResolvedValueOnce({ ...run, status })
      .mockResolvedValueOnce({ selectedMessages: [{ _id: "assistant" }] })
    expect((await GET(request(), params)).status).toBe(expected)
  }
  vi.mocked(fetchQuery)
    .mockResolvedValueOnce(run)
    .mockResolvedValueOnce({ selectedMessages: [{ _id: "assistant" }] })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  vi.mocked(readRetainedChatStream).mockResolvedValue(stream)
  const req = request()
  const response = await GET(req, params)
  expect(response.status).toBe(200)
  expect(response.headers.get("Cache-Control")).toContain("no-store")
  expect(readRetainedChatStream).toHaveBeenLastCalledWith("run", {
    signal: req.signal,
  })
  expect(fetchQuery).toHaveBeenLastCalledWith(
    expect.anything(),
    { chatId: "chat" },
    { token: "test-token" }
  )
})
