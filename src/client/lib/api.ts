// The latest change the server had announced when it answered one of this page's mutations.
let announced = 0;

/** The number of the latest change a mutation's response named, which its notice will carry too. */
export function announcedChange(): number { return announced; }

/** Forgets the numbers a server named, for a connection that may reach a restarted server whose count starts again. */
export function forgetAnnouncedChanges(): void { announced = 0; }

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  announced = Math.max(announced, Number(response.headers.get("X-Blackbox-Change")) || 0);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
