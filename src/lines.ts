import * as vscode from 'vscode'

// The whole lines `range` covers. A range ending at column 0 of a later line doesn't include that line.
export function wholeLines(document: vscode.TextDocument, { start, end }: vscode.Range) {
  const last = end.character === 0 && end.line > start.line ? end.line - 1 : end.line

  return new vscode.Range(start.line, 0, last, document.lineAt(last).range.end.character)
}
