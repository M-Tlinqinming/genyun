import type { Role } from '@genyun/shared';
import { useOutletContext } from 'react-router';

// 框架传给页面的当前机构（侧栏选择框里选中的那个）
export interface WorkspaceContext {
  orgId: string;
  role: Role;
}

export function useWorkspace(): WorkspaceContext {
  return useOutletContext<WorkspaceContext>();
}
