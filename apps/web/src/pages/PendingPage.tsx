import { Empty } from 'antd';
import { PageHeader } from '../components/PageHeader';

// 框架阶段的占位页：菜单可点，内容在后续里程碑开发
export function PendingPage({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Empty description="这一页正在建设中" style={{ padding: '96px 0' }} />
    </>
  );
}
