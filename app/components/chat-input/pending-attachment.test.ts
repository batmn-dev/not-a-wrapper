import { describe, expect, it } from "vitest"
import { createLargePasteFixture } from "./fixtures/large-paste.fixture"
import {
  assembleComposerTurnPayload,
  createGeneratedLargePasteAttachment,
  createSelectedFileAttachment,
  markAttachmentReady,
  restoreLargePasteText,
} from "./pending-attachment"

describe("pending attachment policy", () => {
  it("restores a generated paste at the end and collapses the selection there", () => {
    const attachment = createGeneratedLargePasteAttachment("PASTE", 1)
    expect(restoreLargePasteText("LEFT-RIGHT", attachment)).toEqual({
      text: "LEFT-RIGHTPASTE",
      selectionStart: 15,
      selectionEnd: 15,
    })
  })

  it("uploads generated pastes for authenticated chat turns", () => {
    const attachment = createGeneratedLargePasteAttachment(
      createLargePasteFixture(10_000, "P"),
      1,
      "upload"
    )
    const ready = markAttachmentReady(attachment, {
      name: attachment.file.name,
      contentType: attachment.file.type,
      url: "/api/files/paste/preview",
      attachmentId: "paste",
    })
    expect(
      assembleComposerTurnPayload({
        text: "draft",
        attachments: [ready],
      })
    ).toEqual({
      text: "draft",
      files: [attachment.file],
      attachments: [ready.uploaded],
    })
  })

  it("keeps anonymous and project handoff explicit by flattening only generated text", () => {
    const generated = createGeneratedLargePasteAttachment("PASTE", 1)
    const selectedUploading = createSelectedFileAttachment(
      new File(["file"], "notes.txt", { type: "text/plain" })
    )
    const selected = markAttachmentReady(selectedUploading, {
      name: "notes.txt",
      contentType: "text/plain",
      url: "/api/files/notes/preview",
      attachmentId: "notes",
    })
    expect(
      assembleComposerTurnPayload({
        text: "draft",
        attachments: [generated, selected],
      })
    ).toEqual({
      text: "draft\n\nPASTE",
      files: [selected.file],
      attachments: [selected.uploaded],
    })
  })
})
