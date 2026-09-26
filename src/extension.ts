import * as vscode from 'vscode'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { greet, type Greeting } from './greet.ts'

export function activate(context: vscode.ExtensionContext) {
  const g: Greeting = greet('slick-annotate')
  writeFileSync(
    join(context.extensionPath, '.activated.json'),
    JSON.stringify({ ...g, node: process.versions.node, vscode: vscode.version }, null, 2),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('slick.hello', () => vscode.window.showInformationMessage(g.text)),
  )
}

export function deactivate() {}
