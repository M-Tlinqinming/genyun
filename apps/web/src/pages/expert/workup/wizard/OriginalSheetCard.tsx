import { App } from 'antd';
import type { Workup, WorkupIntakeFile } from '../../../../api/workup';
import { inlineUrl } from '../../../../api/workup';
import { request } from '../../../../api/request';
import { gy, type } from '../../../../theme/tokens';
import { caption, Chip, dayOf, link14, LockNote, SideCard, softLine } from './parts';

// 右栏「客户原表」：客户上传的资料表格、这一步对应的工作表、图纸与照片；老流程（客户在线逐项填写）没有表格
export function OriginalSheetCard({ workup, sheets, extra }: { workup: Workup; sheets: string[]; extra?: { label: string; files: WorkupIntakeFile[] } }) {
  const { message } = App.useApp();
  const open = async (fileId: string, inline: boolean) => {
    try {
      const { url } = inline ? await inlineUrl(fileId) : await request<{ url: string }>(`/files/${fileId}/download-url`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '打不开这份文件，请稍后再试');
    }
  };

  if (workup.flow !== 'intake') {
    return (
      <SideCard title="客户填写的资料">
        <span style={{ ...type.body, color: gy.secondary }}>客户在线逐项填写，没有上传资料表格。</span>
        <LockNote text="客户填写的内容不会被改动，您的修改单独记录。" />
      </SideCard>
    );
  }

  const sheet = workup.intakeFiles.find((f) => f.slot === 'data_sheet');
  const pictures = workup.intakeFiles.filter((f) => f.slot === 'site_plan' || f.slot === 'evacuation_map' || f.slot === 'other');
  return (
    <SideCard
      title="客户原表"
      extra={
        sheet && (
          <button type="button" style={link14} onClick={() => void open(sheet.fileId, false)}>
            下载 Excel
          </button>
        )
      }
    >
      {sheet ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ ...type.body, color: gy.text, overflowWrap: 'anywhere' }}>{sheet.name}</span>
          <span style={caption}>{dayOf(sheet.uploadedAt, true)} 上传</span>
        </div>
      ) : (
        <span style={{ ...type.body, color: gy.secondary }}>还没有读到客户的资料表格。</span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...type.caption, color: gy.secondary }}>这一步对应的工作表</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {sheets.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </span>
      </div>
      {(extra?.files.length || pictures.length > 0) && <span aria-hidden style={{ height: 1, background: softLine }} />}
      {extra && extra.files.length > 0 && (
        <FileLine label={`${extra.label} ${extra.files.length} 份`} onOpen={() => void open(extra.files[0]!.fileId, true)} />
      )}
      {pictures.length > 0 && <FileLine label={`图纸与照片 ${pictures.length} 份`} onOpen={() => void open(pictures[0]!.fileId, true)} />}
      <LockNote />
    </SideCard>
  );
}

function FileLine({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, ...type.body, color: gy.text }}>{label}</span>
      <button type="button" style={link14} onClick={onOpen}>
        查看
      </button>
    </div>
  );
}
