import type { IntakeFileView } from '@genyun/shared';
import { App, Drawer } from 'antd';
import { useState } from 'react';
import { downloadFile, useIntake, viewFile } from '../../../../api/intake';
import type { Workup } from '../../../../api/workup';
import { gy, type } from '../../../../theme/tokens';
import { caption, Chip, dayOf, link14, LockNote, SideCard, softLine } from './parts';

// 右栏「客户原表」（第 1、2 步）：只在新流程任务显示，数据来自准备资料接口（GET /api/tasks/:taskId/intake）。
// 资料表格的文件名、上传时间、共几张表和「下载 Excel」；这一步对应的工作表；图纸与照片列在抽屉里逐份查看
export function OriginalSheetCard({ taskId, workup, sheets }: { taskId: string; workup: Workup; sheets: string[] }) {
  const isIntake = workup.flow === 'intake';
  const intake = useIntake(taskId, isIntake);
  const { message } = App.useApp();
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!isIntake || !intake.data) return null;

  const sheet = intake.data.dataSheet;
  const pictures = [...(intake.data.sitePlan ? [intake.data.sitePlan] : []), ...intake.data.evacuationMaps, ...intake.data.others];
  const run = (job: Promise<void>) => job.catch((err) => message.error(err instanceof Error ? err.message : '打不开这份文件，请稍后再试'));
  const tableCount = sheet?.status === 'read' ? sheet.sheets.length : 0;

  return (
    <SideCard
      title="客户原表"
      extra={
        sheet && (
          <button type="button" style={link14} onClick={() => void run(downloadFile(sheet.file.fileId))}>
            下载 Excel
          </button>
        )
      }
    >
      {sheet ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{sheet.file.originalName}</span>
          <span style={caption}>
            {dayOf(sheet.file.uploadedAt, true)} 上传{tableCount ? ` · 共 ${tableCount} 张表` : ''}
          </span>
        </div>
      ) : (
        <span style={{ ...type.body, color: gy.secondary }}>客户还没有上传资料表格。</span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...type.caption, color: gy.secondary }}>这一步对应的工作表</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sheets.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </span>
      </div>
      <span aria-hidden style={{ height: 1, background: softLine }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, ...type.body, color: gy.text }}>图纸与照片 {pictures.length} 份</span>
        {pictures.length > 0 && (
          <button type="button" style={link14} onClick={() => setDrawerOpen(true)}>
            查看
          </button>
        )}
      </div>
      <LockNote />
      <Drawer title={`图纸与照片 ${pictures.length} 份`} open={drawerOpen} onClose={() => setDrawerOpen(false)} size={420} zIndex={1100}>
        <ul aria-label="图纸与照片" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {pictures.map((f, i) => (
            <PictureRow key={f.id} file={f} first={i === 0} onView={() => void run(viewFile(f.fileId))} />
          ))}
        </ul>
      </Drawer>
    </SideCard>
  );
}

function PictureRow({ file, first, onView }: { file: IntakeFileView; first: boolean; onView: () => void }) {
  return (
    <li
      aria-label={file.originalName}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: first ? undefined : `1px solid ${softLine}` }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{file.originalName}</span>
        <span style={caption}>{dayOf(file.uploadedAt, true)} 上传</span>
      </div>
      <button type="button" style={link14} onClick={onView}>
        查看
      </button>
    </li>
  );
}

// 旧流程第 2 步：客户上传的是花名册（不是逐项填写）时，右栏放花名册的「查看」
export function RosterCard({ workup, roster, fileIds: ids }: { workup: Workup; roster: boolean; fileIds: string[] }) {
  const { message } = App.useApp();
  if (workup.flow === 'intake' || !roster || ids.length === 0) return null;
  const run = (fileId: string) => viewFile(fileId).catch((err) => message.error(err instanceof Error ? err.message : '打不开这份文件，请稍后再试'));
  return (
    <SideCard title="客户上传的花名册">
      <span style={{ ...type.body, color: gy.secondary }}>客户没有逐项填写，上传了花名册。表格里空着的由您对照花名册补上。</span>
      {ids.map((id, i) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, ...type.body, color: gy.text }}>花名册{ids.length > 1 ? ` ${i + 1}` : ''}</span>
          <button type="button" style={link14} onClick={() => void run(id)}>
            查看
          </button>
        </div>
      ))}
    </SideCard>
  );
}
