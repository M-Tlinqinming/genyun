export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // 后台随错误一起返回的其他字段（如重复创建时的已有任务）
    public body: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const message = typeof body?.message === 'string' ? body.message : '请求失败，请稍后重试';
    throw new ApiError(res.status, message, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
