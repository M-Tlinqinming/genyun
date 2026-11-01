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

// 服务出错、连不上时给用户的话（不显示 500、Internal Server Error 之类的技术说法）
export const SERVER_TROUBLE = '耕云服务暂时出了问题，请稍后再试。着急的话请致电耕云 0752-5200831';
export const NETWORK_TROUBLE = '网络连不上耕云，请检查网络后再试。一直不行请致电耕云 0752-5200831';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    // 断网、DNS 失败等：fetch 直接抛错，没有状态码，记为 0
    throw new ApiError(0, NETWORK_TROUBLE);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // 5xx（含网关返回的 502/504）一律用业务话术；4xx 用后台写好的说明
    const message =
      res.status >= 500 ? SERVER_TROUBLE : typeof body?.message === 'string' ? body.message : SERVER_TROUBLE;
    throw new ApiError(res.status, message, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
