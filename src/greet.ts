export type Greeting = { text: string; at: string }

export function greet(name: string): Greeting {
  return { text: `hello from ${name}`, at: new Date().toISOString() }
}
