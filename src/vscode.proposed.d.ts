// Proposed API `commentReveal`, enabled through package.json#enabledApiProposals.
// https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.commentReveal.d.ts
declare module 'vscode' {
  export enum CommentThreadFocus {
    Reply = 1,
    Comment = 2,
  }

  export interface CommentThread {
    reveal(comment?: Comment, options?: { focus?: CommentThreadFocus }): Thenable<void>
  }
}

// Proposed API `editorInsets`, enabled through package.json#enabledApiProposals.
// https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.editorInsets.d.ts
declare module 'vscode' {
  export interface WebviewEditorInset {
    readonly editor: TextEditor
    readonly line: number
    readonly height: number
    readonly webview: Webview
    readonly onDidDispose: Event<void>
    dispose(): void
  }

  export namespace window {
    export function createWebviewTextEditorInset(
      editor: TextEditor,
      line: number,
      height: number,
      options?: WebviewOptions,
    ): WebviewEditorInset
  }
}
