import type { ProductionStep, ResourcesStep } from '@genyun/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isStale,
  productionStepKey,
  resourcesStepKey,
  saveProductionStep,
  saveResourcesStep,
  type ProductionStepView,
  type ResourcesStepView,
} from '../../../api/profile';
import { request } from '../../../api/request';
import { taskCheckKey, type Task } from '../../../api/tasks';

const productionKey = (enterpriseId: string) => [...productionStepKey(enterpriseId), 'check'] as const;
const resourcesKey = (enterpriseId: string) => [...resourcesStepKey(enterpriseId), 'check'] as const;

// 检查页专用抽屉读企业资料（与自填同一份数据）；每次打开重新读
export function useCheckProfile(task: Task) {
  const production = useQuery({
    queryKey: productionKey(task.enterpriseId),
    queryFn: () => request<ProductionStepView>(`/enterprises/${task.enterpriseId}/production-step`),
    gcTime: 0,
  });
  const resources = useQuery({
    queryKey: resourcesKey(task.enterpriseId),
    queryFn: () => request<ResourcesStepView>(`/enterprises/${task.enterpriseId}/resources-step`),
    gcTime: 0,
  });
  return { production: production.data, resources: resources.data };
}

// 检查页里的回答写进企业资料（与自填第 3、4 步同一份），资料项状态由后台同步。
// 每次先读最新版本再改；刚好别人保存过就重读再试一次
export function useProfileWriter(task: Task) {
  const client = useQueryClient();
  const id = task.enterpriseId;

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: taskCheckKey(task.id) }),
      client.invalidateQueries({ queryKey: productionKey(id) }),
      client.invalidateQueries({ queryKey: resourcesKey(id) }),
    ]);

  const retry = async (once: () => Promise<unknown>) => {
    try {
      await once();
    } catch (err) {
      if (!isStale(err)) throw err;
      await once();
    }
    await refresh();
  };

  const production = (change: (step: ProductionStep) => ProductionStep) =>
    retry(async () => {
      const view = await request<ProductionStepView>(`/enterprises/${id}/production-step`);
      // 还没填过第 3 步时，页面预选的场所不是客户说的，不跟着保存
      const step = view.saved ? view.step : { ...view.step, sites: [], customSites: [] };
      await saveProductionStep(id, { version: view.version, step: change(step) });
    });

  const resources = (change: (step: ResourcesStep) => ResourcesStep) =>
    retry(async () => {
      const view = await request<ResourcesStepView>(`/enterprises/${id}/resources-step`);
      await saveResourcesStep(id, { version: view.version, step: change(view.step) });
    });

  return { production, resources };
}
