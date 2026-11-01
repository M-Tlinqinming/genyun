import { Button, Empty } from 'antd';
import { Link } from 'react-router';
import { useTaskDeliveries } from '../../../api/deliveries';
import { Loading, Notice } from '../../../components/ui';
import { gy } from '../../../theme/tokens';
import { card, stampFull, text14, textLink, versionText } from './shared';

// 任务详情「成果版本」标签：列出这项任务的交付版本，点进成果文档查看与下载
export function TaskVersions({ taskId }: { taskId: string }) {
  const query = useTaskDeliveries(taskId);
  if (query.isPending) return <Loading rows={2} />;
  if (query.isError)
    return (
      <Notice
        tone="warning"
        title="成果版本暂时没有加载出来"
        text="可能是网络不稳定，请稍后重试。"
        action={
          <Button onClick={() => void query.refetch()} loading={query.isFetching}>
            重试
          </Button>
        }
      />
    );
  const versions = query.data?.versions ?? [];
  if (versions.length === 0) return <Empty description="审核完成后，成果文档会显示在这里" />;
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
      {versions.map((v, i) => (
        <div
          key={v.version}
          style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px', borderBottom: i < versions.length - 1 ? `1px solid ${gy.split}` : undefined, ...text14 }}
        >
          <span style={{ width: 96, fontWeight: 500, color: gy.text }}>交付 {versionText(v.version)}</span>
          <span style={{ flex: 1, color: gy.secondary }}>
            {stampFull(v.publishedAt)} 发布 · 三份 Word{i === 0 ? ' · 最新' : ''}
          </span>
          <Link to={`/customer/documents/${taskId}${i === 0 ? '' : `?v=${v.version}`}`} style={textLink}>
            查看和下载
          </Link>
        </div>
      ))}
    </div>
  );
}
