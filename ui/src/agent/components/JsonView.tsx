type JsonViewProps = {
  value: Record<string, unknown>
}

export function JsonView({ value }: JsonViewProps) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
