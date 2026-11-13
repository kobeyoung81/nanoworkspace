import { downloadFile } from '../api'

// downloadToDisk saves a file from an agent workspace through the browser's
// download flow. The object URL is revoked as soon as the click has been
// dispatched; leaving it alive leaks one blob per download.
export async function downloadToDisk(agentId: string, path: string, name: string): Promise<void> {
  const blob = await downloadFile(agentId, path)
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
