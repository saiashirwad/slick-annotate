// Globals the webview has at runtime: VS Code's API, and mermaid once its script loads.
declare function acquireVsCodeApi(): { postMessage(message: import('../src/walk-messages.ts').FromPage): void }

declare const mermaid: {
  initialize(config: { startOnLoad: boolean; securityLevel: 'strict'; theme: 'neutral' | 'dark' }): void
  run(): Promise<void>
}
