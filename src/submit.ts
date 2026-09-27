import * as vscode from 'vscode'
import { formatSession } from './copy.ts'
import { errorMessage } from './errors.ts'
import { load } from './session.ts'

// Hands over the walk's review and the session's annotations in one paste. It reads the session from disk, so
// neither feature needs to know about the other.
export async function submitReview(root: string, review: () => string | undefined) {
  const text = review()

  if (text === undefined) return
  let annotations = ''

  try {
    annotations = formatSession(load(root))
  } catch (error) {
    void vscode.window.showWarningMessage(`Copied the review without your annotations: ${errorMessage(error)}`)
  }

  try {
    await vscode.env.clipboard.writeText(annotations ? `${text}\n\n# Annotations\n\n${annotations}` : text)
    vscode.window.setStatusBarMessage('Review submitted and copied', 2000)
  } catch (error) {
    void vscode.window.showWarningMessage(`Could not copy the review: ${errorMessage(error)}`)
  }
}
