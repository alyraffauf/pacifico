export async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(
      body.error_description ||
        body.error ||
        `Request failed with ${response.status}`,
    );
  }
  return body;
}

export function requestParameter(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}
