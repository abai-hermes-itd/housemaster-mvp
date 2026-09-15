/**
 * Unique id generator shared by the test suites, so every test can use
 * fresh ids and never depends on the shared fake-indexeddb store being
 * empty or on any other test's data.
 */
let counter = 0;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
