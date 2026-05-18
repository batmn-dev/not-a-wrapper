export function AppInfoContent() {
  return (
    <div className="space-y-4">
      <p className="text-foreground leading-relaxed">
        <span className="font-medium">Not A Wrapper</span> is an open-source
        multi-AI chat application.
        <br />
        Access 100+ models from OpenAI, Claude, Gemini, Mistral, and more.
        <br />
        BYOK-ready.
        <br />
      </p>
      <p className="text-foreground leading-relaxed">
        Based on{" "}
        <a
          href="https://github.com/ibelick/zola"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Zola
        </a>
        , the open-source AI chat interface.
      </p>
    </div>
  )
}
