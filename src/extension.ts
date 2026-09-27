import { errorMessage } from './errors.ts'
import * as vscode from 'vscode'
import { activateAnnotations } from './annotations.ts'
import { excludeFromGit } from './git.ts'
import { activateTour } from './tour.ts'

export function activate(context: vscode.ExtensionContext) {
  const folder = vscode.workspace.workspaceFolders?.[0]

  if (!folder) return

  try {
    excludeFromGit(folder.uri.fsPath)
  } catch (error) {
    void vscode.window.showWarningMessage(`Could not exclude .tandem/ from Git: ${errorMessage(error)}`)
  }

  activateAnnotations(context, folder)
  activateTour(context, folder)
}
