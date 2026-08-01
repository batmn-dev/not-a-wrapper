export class PublicChatHttpError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(options: {
    message: string
    statusCode: number
    code: string
    cause?: unknown
  }) {
    super(options.message, { cause: options.cause })
    this.name = "PublicChatHttpError"
    this.code = options.code
    this.statusCode = options.statusCode
  }
}

export function isPublicChatHttpError(
  error: unknown
): error is PublicChatHttpError {
  return error instanceof PublicChatHttpError
}
