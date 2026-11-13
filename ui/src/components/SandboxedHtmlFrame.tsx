// A document rendered in an opaque-origin frame: its scripts run, but they
// cannot touch the portal's cookies, storage or DOM.
//
// `sandbox="allow-scripts"` WITHOUT `allow-same-origin` is the whole safety
// story. Adding `allow-same-origin` would give the page the portal's origin —
// and with scripts it could then remove its own sandbox. Rendering the document
// any other way (innerHTML, dangerouslySetInnerHTML) is not an option either:
// by HTML spec scripts inserted that way stay inert, so every interactive block
// would be dead.
export function SandboxedHtmlFrame({
  html,
  title,
  kind,
}: {
  html: string
  title: string
  kind: 'nanowork' | 'html'
}) {
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="fullscreen"
      title={title}
      data-sandbox-preview={kind}
      className="h-full w-full border-0 bg-white"
    />
  )
}
