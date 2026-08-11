const redactUrls = (message: string) =>
  message.replace(/https?:\/\/[^\s)'"]+/g, (value) => {
    try {
      return `${new URL(value).origin}/[redacted]`
    } catch {
      return "[redacted URL]"
    }
  })

const sanitizedMessage = (reason: Error | string) =>
  redactUrls(reason instanceof Error ? reason.message : reason)

export const installSanitizedScriptFailureHandlers = () => {
  const fail = (reason: Error | string) => {
    console.error(sanitizedMessage(reason))
    process.exit(1)
  }
  process.on("unhandledRejection", fail)
  process.on("uncaughtException", fail)
}
