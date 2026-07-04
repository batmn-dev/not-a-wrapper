import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vitest"
import {
  getLatestUserMessageTextFilePartReferences,
  getTextFilePartReferences,
  prepareTextFilePartsForModelInput,
} from "./text-file-parts"

type AppFileUIPart = Extract<UIMessage["parts"][number], { type: "file" }> & {
  attachmentId?: string
}

type AppUIMessage = Omit<UIMessage, "parts"> & {
  parts: Array<
    Exclude<UIMessage["parts"][number], { type: "file" }> | AppFileUIPart
  >
}

describe("prepareTextFilePartsForModelInput", () => {
  it("converts trusted text/plain file parts into model-safe text content", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello from the file"))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "Upload smoke test" },
          {
            type: "file",
            filename: "not-a-wrapper-upload-smoke.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/smoke.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/smoke.txt",
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://files.example/smoke.txt",
      expect.objectContaining({ signal: expect.any(Object) })
    )
    expect(result.convertedCount).toBe(1)
    expect(result.failedCount).toBe(0)
    expect(result.messages[0].parts).toEqual([
      { type: "text", text: "Upload smoke test" },
      {
        type: "text",
        text: 'Attached plain text file "not-a-wrapper-upload-smoke.txt":\n\nhello from the file',
      },
    ])
  })

  it("fetches the trusted stored URL instead of a forged client URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("trusted content"))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "notes.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "http://169.254.169.254/latest/meta-data",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/notes.txt",
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://files.example/notes.txt",
      expect.any(Object)
    )
    expect(result.failedCount).toBe(0)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "notes.txt":\n\ntrusted content',
      },
    ])
  })

  it("does not fetch forged or data URL text/plain file parts", async () => {
    const fetchImpl = vi.fn()
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "forged.txt",
            mediaType: "text/plain",
            url: "http://169.254.169.254/latest/meta-data",
          },
          {
            type: "file",
            filename: "inline.txt",
            mediaType: "text/plain",
            url: "data:text/plain,hello",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [],
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.convertedCount).toBe(2)
    expect(result.failedCount).toBe(2)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "forged.txt" could not be read for model input: attachment is not available for model input',
      },
      {
        type: "text",
        text: 'Attached plain text file "inline.txt" could not be read for model input: attachment is not available for model input',
      },
    ])
  })

  it("caps network reads and decodes truncated UTF-8 safely", async () => {
    let canceled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"))
        controller.enqueue(new TextEncoder().encode("🙂world"))
      },
      cancel() {
        canceled = true
      },
    })
    const fetchImpl = vi.fn(async () => new Response(stream))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "large.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/large.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      maxBytes: 6,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/large.txt",
        },
      ],
    })

    expect(canceled).toBe(true)
    expect(result.truncatedCount).toBe(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "large.txt":\n\nhello\n\n[File content truncated to 6 bytes for model input.]',
      },
    ])
  })

  it("represents fetch timeouts as text attachment read failures", async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"))
          })
        })
    ) as unknown as typeof fetch
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "slow.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/slow.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      timeoutMs: 1,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/slow.txt",
        },
      ],
    })

    expect(result.failedCount).toBe(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "slow.txt" could not be read for model input: Timed out reading text attachment',
      },
    ])
  })

  it("converts trusted text attachments across earlier and latest user messages by default", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "https://files.example/old.txt") {
        return new Response("old content")
      }
      return new Response("latest content")
    })
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "old.txt",
            mediaType: "text/plain",
            attachmentId: "old-attachment",
            url: "https://files.example/old.txt",
          },
        ],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "ok" }],
      },
      {
        id: "u2",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "latest.txt",
            mediaType: "text/plain",
            attachmentId: "latest-attachment",
            url: "https://files.example/latest.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [
        {
          attachmentId: "old-attachment",
          url: "https://files.example/old.txt",
        },
        {
          attachmentId: "latest-attachment",
          url: "https://files.example/latest.txt",
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://files.example/old.txt",
      expect.any(Object)
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://files.example/latest.txt",
      expect.any(Object)
    )
    expect(result.convertedCount).toBe(2)
    expect(result.skippedCount).toBe(0)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "old.txt":\n\nold content',
      },
    ])
    expect(result.messages[2].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "latest.txt":\n\nlatest content',
      },
    ])
  })

  it("converts only latest user text attachments when requested", async () => {
    const fetchImpl = vi.fn(async () => new Response("latest content"))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "old.txt",
            mediaType: "text/plain",
            attachmentId: "old-attachment",
            url: "https://files.example/old.txt",
          },
        ],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "ok" }],
      },
      {
        id: "u2",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "latest.txt",
            mediaType: "text/plain",
            attachmentId: "latest-attachment",
            url: "https://files.example/latest.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      convertOnlyLatestUserMessage: true,
      trustedAttachments: [
        {
          attachmentId: "old-attachment",
          url: "https://files.example/old.txt",
        },
        {
          attachmentId: "latest-attachment",
          url: "https://files.example/latest.txt",
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://files.example/latest.txt",
      expect.any(Object)
    )
    expect(result.convertedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "old.txt" was provided earlier in the conversation and was not re-read for this turn.',
      },
    ])
    expect(result.messages[2].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "latest.txt":\n\nlatest content',
      },
    ])
  })

  it("applies the request-level text attachment byte budget", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello"))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "one.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/one.txt",
          },
          {
            type: "file",
            filename: "two.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-2",
            url: "https://files.example/two.txt",
          },
          {
            type: "file",
            filename: "three.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-3",
            url: "https://files.example/three.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      maxFiles: 2,
      maxTotalBytes: 5,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/one.txt",
        },
        {
          attachmentId: "attachment-2",
          url: "https://files.example/two.txt",
        },
        {
          attachmentId: "attachment-3",
          url: "https://files.example/three.txt",
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.convertedCount).toBe(3)
    expect(result.failedCount).toBe(2)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "one.txt":\n\nhello',
      },
      {
        type: "text",
        text: 'Attached plain text file "two.txt" could not be read for model input: text attachment byte budget exceeded (5 bytes per request)',
      },
      {
        type: "text",
        text: 'Attached plain text file "three.txt" could not be read for model input: text attachment byte budget exceeded (5 bytes per request)',
      },
    ])
  })

  it("applies the request-level text attachment count budget", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello"))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "one.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/one.txt",
          },
          {
            type: "file",
            filename: "two.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-2",
            url: "https://files.example/two.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      maxFiles: 1,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/one.txt",
        },
        {
          attachmentId: "attachment-2",
          url: "https://files.example/two.txt",
        },
      ],
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.failedCount).toBe(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "one.txt":\n\nhello',
      },
      {
        type: "text",
        text: 'Attached plain text file "two.txt" could not be read for model input: text attachment limit exceeded (1 files per request)',
      },
    ])
  })

  it("fails closed instead of fully reading non-streamable responses with unknown size", async () => {
    const fetchImpl = vi.fn(async () => new Response(null))
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "bodyless.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/bodyless.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/bodyless.txt",
        },
      ],
    })

    expect(result.failedCount).toBe(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "bodyless.txt" could not be read for model input: Text attachment response is not streamable',
      },
    ])
  })

  it("leaves image and PDF file parts unchanged", async () => {
    const fetchImpl = vi.fn()
    const imagePart = {
      type: "file" as const,
      filename: "photo.png",
      mediaType: "image/png",
      url: "https://files.example/photo.png",
    }
    const pdfPart = {
      type: "file" as const,
      filename: "brief.pdf",
      mediaType: "application/pdf",
      url: "https://files.example/brief.pdf",
    }
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "See files" }, imagePart, pdfPart],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [],
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.convertedCount).toBe(0)
    expect(result.messages[0].parts).toEqual([
      { type: "text", text: "See files" },
      imagePart,
      pdfPart,
    ])
  })

  it("removes unsupported text/plain file parts even when storage read fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("missing", { status: 404 })
    )
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "missing.txt",
            mediaType: "text/plain",
            url: "https://files.example/missing.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    const result = await prepareTextFilePartsForModelInput(messages, {
      fetchImpl,
      trustedAttachments: [
        {
          attachmentId: "attachment-1",
          url: "https://files.example/missing.txt",
        },
      ],
    })

    expect(result.convertedCount).toBe(1)
    expect(result.failedCount).toBe(1)
    expect(result.messages[0].parts).toEqual([
      {
        type: "text",
        text: 'Attached plain text file "missing.txt" could not be read for model input: Failed to fetch text attachment (404)',
      },
    ])
  })

  it("extracts only text/plain file references for server-side trust checks", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "See files" },
          {
            type: "file",
            filename: "notes.txt",
            mediaType: "text/plain",
            attachmentId: "attachment-1",
            url: "https://files.example/notes.txt",
          },
          {
            type: "file",
            filename: "image.png",
            mediaType: "image/png",
            url: "https://files.example/image.png",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    expect(getTextFilePartReferences(messages)).toEqual([
      {
        attachmentId: "attachment-1",
        url: "https://files.example/notes.txt",
      },
    ])
  })

  it("extracts only latest user text/plain file references for route-side trust checks", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "old.txt",
            mediaType: "text/plain",
            attachmentId: "old-attachment",
            url: "https://files.example/old.txt",
          },
        ],
      },
      {
        id: "u2",
        role: "user",
        parts: [
          {
            type: "file",
            filename: "latest.txt",
            mediaType: "text/plain",
            attachmentId: "latest-attachment",
            url: "https://files.example/latest.txt",
          },
        ],
      },
    ] satisfies AppUIMessage[]

    expect(getLatestUserMessageTextFilePartReferences(messages)).toEqual([
      {
        attachmentId: "latest-attachment",
        url: "https://files.example/latest.txt",
      },
    ])
  })
})
