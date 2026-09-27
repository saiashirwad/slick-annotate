import * as vscode from 'vscode'
import { activateAnnotations } from './annotations.ts'
import { activateTour } from './tour.ts'

export function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (!folder) return
  activateAnnotations(context, folder)
  activateTour(context, folder)
}
