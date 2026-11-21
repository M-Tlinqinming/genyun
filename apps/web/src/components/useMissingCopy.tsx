import { missingListText, type MissingTextInput } from '@genyun/shared';
import { App, Button, Input, Modal } from 'antd';
import { useRef, useState } from 'react';
import { useSession } from '../auth/session';

// 复制缺项清单（专家第 5 步、专家的查看缺项、运营任务中心抽屉共用）：
// 文字由共享包 missingListText 拼好写进剪贴板，提示 3 秒；剪贴板写不进去时弹出全文，可以全选后自己复制。

/** 复制缺项清单：写剪贴板、出提示；写不进去时弹出全文。node 放进页面里 */
export function useMissingCopy() {
  const { message } = App.useApp();
  const session = useSession();
  const [fallback, setFallback] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);

  // successText：复制成功的提示，不传用默认的「粘贴发给客服」；
  // expertName：落款的专家，不传用当前登录的人（运营复制时传列出清单的专家）
  const copy = async (
    input: Omit<MissingTextInput, 'expertName' | 'at'> & { at?: string; expertName?: string },
    successText?: string,
  ): Promise<boolean> => {
    const text = missingListText({
      ...input,
      at: input.at ?? new Date().toISOString(),
      expertName: input.expertName ?? session.data?.name ?? '',
    });
    try {
      await navigator.clipboard.writeText(text);
      message.success({ content: successText ?? `已复制 ${input.items.length} 项缺项，粘贴发给客服就行`, duration: 3 });
      return true;
    } catch {
      setFallback(text);
      return false;
    }
  };

  const selectAll = () => {
    area.current?.focus();
    area.current?.select();
  };

  const node = (
    <Modal
      open={fallback !== null}
      title="没能自动复制，请手动复制下面的清单"
      onCancel={() => setFallback(null)}
      footer={
        <>
          <Button onClick={selectAll}>全选</Button>
          <Button type="primary" onClick={() => setFallback(null)}>
            复制好了
          </Button>
        </>
      }
    >
      <Input.TextArea
        aria-label="缺项清单全文"
        ref={(el) => {
          area.current = el?.resizableTextArea?.textArea ?? null;
        }}
        value={fallback ?? ''}
        readOnly
        autoSize={{ minRows: 8, maxRows: 18 }}
      />
    </Modal>
  );
  return { copy, node };
}
