/** Browser-side JSON calls to our own API. `base` is the Next basePath handed down by the server page. */
export type ApiReply<T = Record<string, unknown>> = { status: number; body: T & { error?: string } };

export async function apiSend<T = Record<string, unknown>>(
  base: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiReply<T>> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let json = {} as T & { error?: string };
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json };
}
