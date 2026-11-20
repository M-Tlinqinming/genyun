import { SearchOutlined } from '@ant-design/icons';
import { Button, Card, Input, Switch, Table, Tabs } from 'antd';
import { useState, type ReactNode } from 'react';
import { ActionBar } from '../../components/ActionBar';
import { BackLink } from '../../components/BackLink';
import { EmptyState } from '../../components/EmptyState';
import { NoticeBar } from '../../components/NoticeBar';
import { PageHeader } from '../../components/PageHeader';
import { SourceTag } from '../../components/SourceTag';
import { StageBar } from '../../components/StageBar';
import { StatCells, type StatItem } from '../../components/StatCells';
import { StatusTag } from '../../components/StatusTag';
import { TaskStageTag } from '../../components/TaskStageTag';
import { Notice } from '../../components/ui';
import { WizardHeader } from '../../components/WizardHeader';
import { CUSTOMER_STAGES, EXPERT_STAGES, WizardLayout } from '../../layouts/WizardLayout';
import { gy, layout, type, weight } from '../../theme/tokens';

// 只在本机开发时打开的组件展示页（/dev/ui），正式构建里没有这个页面
const STATS: StatItem[] = [
  { key: 'check', label: '待核对资料', value: 3, note: '最早一件已等 2 天', tone: 'action' },
  { key: 'draft', label: '生成初稿中', value: 1, note: '约 10 分钟后可看', tone: 'progress' },
  { key: 'final', label: '待核对定稿', value: 2, note: '今天新到 1 件', tone: 'action' },
  { key: 'done', label: '已交付', value: 12, note: '本月 4 件', tone: 'done' },
];

const ROWS = [
  { key: '1', name: '示例化工有限公司', code: '编号 2026-0012', stage: 'action' as const, stageText: '待核对资料', stageNote: '客户 11-18 提交', time: '今天 16:00 前', mine: true },
  { key: '2', name: '示例电子科技有限公司', code: '编号 2026-0011', stage: 'progress' as const, stageText: '生成初稿中', stageNote: '已用 6 分钟', time: '11-19 10:24', mine: false },
  { key: '3', name: '示例物流有限公司', code: '编号 2026-0009', stage: 'done' as const, stageText: '已交付', stageNote: '11-15 交付', time: '11-15 17:02', mine: false },
  { key: '4', name: '示例食品有限公司', code: '编号 2026-0008', stage: 'error' as const, stageText: '生成没成功', stageNote: '可以重新生成', time: '11-14 09:10', mine: true },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>{title}</h2>
      {children}
    </section>
  );
}

function Frame({ label, height, children }: { label: string; height?: number; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ ...type.caption, color: gy.tertiary }}>{label}</span>
      <div style={{ border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden', height, background: gy.canvas }}>{children}</div>
    </div>
  );
}

function SaveAndBack({ back }: { back: string }) {
  return (
    <>
      <span style={{ ...type.caption, color: gy.tertiary }}>已自动保存 16:20</span>
      <Button>{back}</Button>
    </>
  );
}

export function UiShowcasePage() {
  const [selected, setSelected] = useState<string | undefined>('check');
  const [tab, setTab] = useState('mine');
  const [accepting, setAccepting] = useState(true);
  const rows = selected ? ROWS.filter((r) => STATS.find((s) => s.key === selected)?.tone === r.stage) : ROWS;

  return (
    <div style={{ minHeight: '100vh', background: gy.canvas }}>
      <div style={{ maxWidth: layout.content, margin: '0 auto', padding: '32px 32px 64px', display: 'flex', flexDirection: 'column', gap: 40 }}>
        <PageHeader
          title="界面组件一览"
          description="本机开发时查看各通用组件和三种页面框架的样子，正式环境没有这个页面。"
          actions={
            <>
              <span style={{ ...type.body, color: gy.secondary }}>接单中</span>
              <Switch checked={accepting} onChange={setAccepting} aria-label="接单中" />
            </>
          }
        />

        <Section title="页面标题与返回链接">
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <PageHeader
                back={{ to: '/dev/ui', label: '返回专家' }}
                title="王工"
                tag={<StatusTag tone="done">已上架</StatusTag>}
                description="注册于 11-12 · 广东惠州"
                actions={<Button>下架</Button>}
              />
              <BackLink to="/dev/ui" label="返回任务中心" />
            </div>
          </Card>
        </Section>

        <Section title="统计格（点一格筛选，再点取消）">
          <StatCells items={STATS} selected={selected} onSelect={setSelected} />
          <StatCells items={STATS.slice(0, 3)} />
        </Section>

        <Section title="表格">
          <div style={{ background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 24, borderBottom: `1px solid ${gy.split}` }}>
              <Tabs
                activeKey={tab}
                onChange={setTab}
                tabBarStyle={{ margin: 0, borderBottom: 'none' }}
                items={[
                  { key: 'mine', label: '我负责的 4' },
                  { key: 'all', label: '全部 18' },
                ]}
              />
              <Input prefix={<SearchOutlined style={{ color: gy.tertiary }} />} placeholder="搜索企业名称" style={{ width: 280 }} allowClear />
            </div>
            <Table
              dataSource={rows}
              pagination={false}
              locale={{ emptyText: <EmptyState action={<Button type="link" onClick={() => setSelected(undefined)}>清除筛选</Button>}>没有符合当前条件的任务。</EmptyState> }}
              columns={[
                {
                  title: '企业',
                  key: 'name',
                  render: (_, r) => (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text }}>{r.name}</span>
                      <span style={{ ...type.caption, color: gy.tertiary }}>{r.code}</span>
                    </div>
                  ),
                },
                { title: '阶段', key: 'stage', render: (_, r) => <StatusTag tone={r.stage} note={r.stageNote}>{r.stageText}</StatusTag> },
                {
                  title: '时间',
                  key: 'time',
                  render: (_, r) => <span style={{ ...type.body, color: r.mine && r.stage === 'action' ? gy.warning : gy.secondary }}>{r.time}</span>,
                },
                { title: '操作', key: 'op', width: 136, render: () => <Button style={{ width: 88 }}>打开</Button> },
              ]}
              footer={() => `共 ${rows.length} 件`}
            />
          </div>
        </Section>

        <Section title="状态标签与来源标签">
          <Card>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
              <StatusTag tone="action">待您处理</StatusTag>
              <StatusTag tone="progress">进行中</StatusTag>
              <StatusTag tone="done">已完成</StatusTag>
              <StatusTag tone="error">没成功</StatusTag>
              <StatusTag tone="action" note="今天 16:00 前">待核对资料</StatusTag>
              <TaskStageTag status="preparing" />
              <TaskStageTag status="submitted" />
              <SourceTag kind="customer" />
              <SourceTag kind="expert" />
              <SourceTag kind="system" />
              <SourceTag kind="customer">营业执照.pdf</SourceTag>
            </div>
          </Card>
        </Section>

        <Section title="提示条">
          <NoticeBar tone="info">资料交上去后，专家一般在两个工作日内开始编制。</NoticeBar>
          <NoticeBar tone="success">资料已提交，专家开始编制后会通知您。</NoticeBar>
          <NoticeBar tone="warning" action={<Button type="link" size="small">去补齐</Button>}>
            还差 3 项必填资料，补齐后才能提交。
          </NoticeBar>
          <NoticeBar tone="error" action={<Button type="link" size="small">重新生成</Button>}>
            初稿没有生成成功，请重新生成；一直不行请联系耕云。
          </NoticeBar>
          <Notice tone="warning" title="两行写法（已有页面在用）" text="第一行加粗写发生了什么，第二行写下一步。" />
        </Section>

        <Section title="空状态">
          <Card styles={{ body: { padding: 0 } }}>
            <EmptyState action={<Button type="primary">新建任务</Button>}>还没有任务。新建一个，开始准备资料。</EmptyState>
          </Card>
          <Card styles={{ body: { padding: 0 } }}>
            <EmptyState action={<Button>重新加载</Button>}>没有读出来，请重新加载。</EmptyState>
          </Card>
        </Section>

        <Section title="底部操作栏">
          <Frame label="客户准备资料">
            <ActionBar sticky={false} danger={<Button type="link" danger style={{ padding: 0 }}>删除任务</Button>} note="还差 3 项必填资料">
              <Button type="primary" disabled>提交给专家</Button>
            </ActionBar>
          </Frame>
          <Frame label="专家核对">
            <ActionBar sticky={false} note="第 1 步，共 5 步">
              <Button>上一步</Button>
              <Button type="primary">下一步：核对人员</Button>
            </ActionBar>
          </Frame>
        </Section>

        <Section title="阶段条">
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
              <StageBar stages={CUSTOMER_STAGES} current={0} />
              <StageBar stages={CUSTOMER_STAGES} current={1} />
              <StageBar stages={CUSTOMER_STAGES} current={3} />
              <StageBar stages={EXPERT_STAGES} current={2} />
            </div>
          </Card>
        </Section>

        <Section title="向导框架">
          <Frame label="客户：准备资料" height={420}>
            <div style={{ height: '100%', overflow: 'auto' }}>
              <WizardLayout
                title="编制应急预案"
                enterpriseName="示例化工有限公司"
                stages={CUSTOMER_STAGES}
                current={0}
                headerExtra={<SaveAndBack back="返回工作台" />}
                footer={
                  <ActionBar danger={<Button type="link" danger style={{ padding: 0 }}>删除任务</Button>} note="还差 3 项必填资料">
                    <Button type="primary" disabled>提交给专家</Button>
                  </ActionBar>
                }
              >
                <Card title="下载模板，填好后上传">按模板填好企业基本情况、人员和物资，上传后系统会自动检查必填项。</Card>
              </WizardLayout>
            </div>
          </Frame>
          <Frame label="专家：资料核对（顶栏单独看）">
            <WizardHeader title="资料核对" enterpriseName="示例化工有限公司" stages={EXPERT_STAGES} current={0} extra={<SaveAndBack back="返回任务中心" />} />
          </Frame>
        </Section>

        <Section title="工作台框架">
          <span style={{ ...type.body, color: gy.secondary }}>
            客户工作台和内部工作台需要登录后才能看，下面直接嵌入真实页面（没登录会显示登录页）。
          </span>
          <Frame label="客户工作台" height={560}>
            <iframe title="客户工作台" src="/customer" style={{ width: '100%', height: '100%', border: 0 }} />
          </Frame>
          <Frame label="内部工作台（运营）" height={560}>
            <iframe title="内部工作台" src="/operator" style={{ width: '100%', height: '100%', border: 0 }} />
          </Frame>
        </Section>
      </div>
    </div>
  );
}
