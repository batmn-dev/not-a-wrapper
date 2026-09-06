import { validateTypes } from "@ai-sdk/provider-utils"
import { uiMessageChunkSchema, validateUIMessages } from "ai"
import { z } from "zod"

export const retainedChatStreamCursorSchema = z
  .string()
  .max(64)
  .regex(/^\d+-\d+$/)

// SDK schemas are asynchronous. Consume frames with parseAsync, in wire order.
export const retainedChatStreamFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selection"),
    runId: z.string(),
    assistantMessageId: z.string(),
    messages: z
      .array(z.unknown())
      .transform((messages) => validateUIMessages({ messages })),
  }),
  z.object({
    type: z.literal("base"),
    message: z
      .unknown()
      .optional()
      .transform(async (value) => {
        if (value === undefined) return undefined
        const [message] = await validateUIMessages({ messages: [value] })
        return message
      }),
    highWater: retainedChatStreamCursorSchema,
  }),
  z.object({
    type: z.literal("chunk"),
    id: retainedChatStreamCursorSchema,
    chunk: z
      .unknown()
      .transform((value) =>
        validateTypes({ value, schema: uiMessageChunkSchema })
      ),
  }),
  z.object({ type: z.literal("caught-up") }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("unavailable") }),
])

export type RetainedChatStreamFrame = z.infer<
  typeof retainedChatStreamFrameSchema
>
