// A small unified-diff renderer for the Git Browser (no external deps).

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export type DiffLine = {
  // '+' added, '-' removed, ' ' context, '\' no-newline note
  type: '+' | '-' | ' ' | '\\' | ''
  text: string
}

export type ParsedDiff = {
  files: DiffFile[]
}

export type DiffFile = {
  oldPath: string
  newPath: string
  hunks: DiffHunk[]
  binary: boolean
}

// parseUnifiedDiff turns the raw `git diff` text into structured files/hunks.
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = []
  const lines = raw.split('\n')

  let currentFile: DiffFile | null = null
  let currentHunk: DiffHunk | null = null

  const isFileHeader = (line: string): boolean => line.startsWith('diff --git ')
  const isHunkHeader = (line: string): boolean => /^@@ -\d+/.test(line)

  for (const line of lines) {
    if (line === '') {
      if (currentHunk) {
        currentHunk.lines.push({ type: '', text: '' })
      }
      continue
    }
    if (isFileHeader(line)) {
      if (currentFile) {
        files.push(currentFile)
      }
      const paths = parseDiffPaths(line)
      currentFile = {
        oldPath: paths.old,
        newPath: paths.new,
        hunks: [],
        binary: false,
      }
      currentHunk = null
      continue
    }
    if (!currentFile) {
      // Preamble before the first diff --git (e.g. warning lines).
      continue
    }
    if (line === 'Binary files ' || line.startsWith('Binary files ')) {
      currentFile.binary = true
      continue
    }
    if (isHunkHeader(line)) {
      currentHunk = parseHunkHeader(line)
      currentFile.hunks.push(currentHunk)
      continue
    }
    if (currentHunk) {
      const type: DiffLine['type'] = line.startsWith('+')
        ? '+'
        : line.startsWith('-')
          ? '-'
          : line.startsWith('\\ No newline')
            ? '\\'
            : ' '
      currentHunk.lines.push({ type, text: type === '\\' ? line : line.slice(1) })
    }
  }
  if (currentFile) {
    files.push(currentFile)
  }
  return { files }
}

function parseDiffPaths(line: string): { old: string; new: string } {
  // diff --git a/foo b/foo
  const parts = line.slice('diff --git '.length).split(' ')
  let old = parts[0] ?? ''
  let next = parts[1] ?? ''
  if (old.startsWith('a/')) {
    old = old.slice(2)
  }
  if (next.startsWith('b/')) {
    next = next.slice(2)
  }
  return { old, new: next }
}

function parseHunkHeader(line: string): DiffHunk {
  // @@ -oldStart,oldLines +newStart,newLines @@ section
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line)
  const toInt = (value: string | undefined, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  const hunk: DiffHunk = {
    oldStart: toInt(match?.[1], 1),
    oldLines: toInt(match?.[2], 1),
    newStart: toInt(match?.[3], 1),
    newLines: toInt(match?.[4], 1),
    header: match?.[5]?.trim() ?? '',
    lines: [],
  }
  return hunk
}

// flattenChanges yields a flat list of (type, text) for navigation.
export function flattenHunkLines(hunk: DiffHunk): DiffLine[] {
  return hunk.lines
}

// changeLineIndexes returns the line indexes that carry +/- changes.
export function changedLineIndexes(diff: ParsedDiff): number[] {
  const indexes: number[] = []
  let line = 0
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      for (const diffLine of hunk.lines) {
        if (diffLine.type === '+' || diffLine.type === '-') {
          indexes.push(line)
        }
        line += 1
      }
    }
  }
  return indexes
}