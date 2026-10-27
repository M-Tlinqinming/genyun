// 违反唯一约束（PostgreSQL 错误码 23505）。Drizzle 把数据库错误包在 cause 里。
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } } | null)?.cause;
  return cause?.code === '23505' && cause.constraint === constraint;
}
