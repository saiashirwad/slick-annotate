import * as vscode from 'vscode'
import { activateAnnotations } from './annotations.ts'
import { activateTour } from './tour.ts'

// Two features that share only the workspace's `.slick/` folder: annotations you write, and tours an agent writes.
export function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (!folder) return
  activateAnnotations(context, folder)
  activateTour(context, folder)
}
