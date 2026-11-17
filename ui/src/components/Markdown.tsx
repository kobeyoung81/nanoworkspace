import { createContext, memo, useContext, useState, type ComponentPropsWithoutRef } from 'react'
import { useTranslation } from 'react-i18next'

import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { cn } from '../lib/utils'
import 'highlight.js/styles/github-dark.min.css'

// PreContext lets the `code` override distinguish fenced code blocks from
// inline code. Language-less fenced blocks have no hljs/language- class, so
// without this they would be mistaken for inline code and styled incorrectly.
const PreContext = createContext(false)

type HastNode = {
  value?: string
  children?: HastNode[]
}

function nodeText(node: HastNode | undefined): string {
  if (!node) {
    return ''
  }
  if (typeof node.value === 'string') {
    return node.value
  }
  if (Array.isArray(node.children)) {
    return node.children.map((child) => nodeText(child)).join('')
  }
  return ''
}

// Only render images from the same origin (relative paths or the portal host)
// to avoid leaking page context to arbitrary external servers.
function isAllowedImage(src: string | undefined): boolean {
  if (!src) {
    return false
  }
  if (src.startsWith('/')) {
    return true
  }
  try {
    const url = new URL(src, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    return false
  }
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      },
      () => {},
    )
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={t('markdown.copyCode')}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#8b949e] transition-colors hover:bg-[#30363d] hover:text-[#e6edf3]',
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

type PreProps = ComponentPropsWithoutRef<'pre'> & ExtraProps

function Pre({ children, node }: PreProps) {
  return (
    <PreContext.Provider value={true}>
      <div className="not-prose my-4 overflow-hidden rounded-lg border border-border bg-[#0d1117]">
        <div className="flex items-center justify-between border-b border-[#30363d] bg-[#161b22] px-3 py-1.5">
          <span className="text-xs font-medium text-[#8b949e]">code</span>
          <CopyButton text={nodeText(node as HastNode | undefined)} />
        </div>
        <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed text-[#c9d1d9]">{children}</pre>
      </div>
    </PreContext.Provider>
  )
}

type CodeProps = ComponentPropsWithoutRef<'code'> & ExtraProps

// InlineCode wraps inline code so long unbreakable tokens (paths, commands,
// URLs) wrap inside the bubble instead of forcing a horizontal scroll, and so
// a tap copies the value (useful on mobile where selecting a path is awkward).
function reactText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(reactText).join('')
  }
  return ''
}

function InlineCode({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const text = reactText(children)

  const handleCopy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }

  return (
    <code
      role="button"
      tabIndex={0}
      title={t('markdown.copyCode')}
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleCopy()
        }
      }}
      className={cn(
        'cursor-pointer rounded bg-[#0000001a] px-1.5 py-0.5 font-mono text-[0.85em] text-inherit [overflow-wrap:anywhere]',
        copied && 'bg-primary/20',
      )}
    >
      {children}
    </code>
  )
}

function Code({ className, children }: CodeProps) {
  const inPre = useContext(PreContext)
  const isBlock =
    inPre ||
    (typeof className === 'string' && (className.includes('hljs') || className.includes('language-')))
  if (isBlock) {
    return <code className={className}>{children}</code>
  }
  return <InlineCode>{children}</InlineCode>
}

const components: Components = {
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="break-words underline decoration-current underline-offset-2 transition-opacity [overflow-wrap:anywhere] hover:opacity-80"
      >
        {children}
      </a>
    )
  },
  pre: Pre,
  code: Code,
  img({ src, alt }) {
    if (!isAllowedImage(src)) {
      return <span className="italic text-muted-foreground">[image: {alt || 'blocked'}]</span>
    }
    return <img src={src} alt={alt} className="my-2 max-h-96 max-w-full rounded-md border border-border" />
  },
  table({ children }) {
    return (
      <div className="my-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    )
  },
}

/**
 * Markdown renders rich markdown (GFM tables/task lists, line breaks, syntax
 * highlighted code, same-origin images) for conversation messages. It deliberately
 * does NOT enable raw HTML, so message content can never inject markup.
 *
 * Memoized on the content string so message bubbles do not re-parse/highlight
 * on every parent re-render (only the actively streaming message changes).
 */
const Markdown = memo(function Markdown({ className, children }: { className?: string; children: string }) {
  return (
    <div className={cn('prose prose-sm min-w-0 max-w-none break-words dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})

export default Markdown
