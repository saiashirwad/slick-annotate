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

