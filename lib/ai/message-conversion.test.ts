import { describe, expect, it } from "vitest"
import { convertAttachmentsToFiles } from "./message-conversion"

describe("convertAttachmentsToFiles", () => {
  it("preserves Convex attachment ids on file parts", () => {
    expect(
      convertAttachmentsToFiles([
        {
          name: "notes.txt",
          contentType: "text/plain",
          url: "https://files.example/notes.txt",
          attachmentId: "attachment-1",
        },
      ])
    ).toEqual([
      {
        type: "file",
        filename: "notes.txt",
        mediaType: "text/plain",
        url: "https://files.example/notes.txt",
        attachmentId: "attachment-1",
      },
    ])
  })
})
