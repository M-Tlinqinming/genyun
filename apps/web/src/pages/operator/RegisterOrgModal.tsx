import { orgRegisterSchema, type OrgRegisterInput } from '@genyun/shared';
import { App, Form, Input, Modal } from 'antd';
import { useEffect, type ReactNode } from 'react';
import { useOperatorOrg, useSaveOrg } from '../../api/operator';
import { Loading } from '../../components/ui';
import { gy } from '../../theme/tokens';

// 出错时错误提示占掉下边距，这里固定留 20px，字段之间不会挤在一起
const item = { marginBottom: 20 } as const;
const half = { ...item, flex: 1, minWidth: 0 } as const;

// 必填星号放在标签后面，与开通弹窗一致
const requiredAfter = (label: ReactNode, { required }: { required: boolean }) => (
  <>
    {label}
    {required && <span style={{ color: gy.error, marginLeft: 4 }}>*</span>}
  </>
);

// 登记客户组织 / 修改资料。Paper 没有这个弹窗的高保真，按设计系统表单做（DESIGN-DIFF「M3 第 1 项」）
export function RegisterOrgModal({ orgId, open, onClose }: { orgId: string | null; open: boolean; onClose: () => void }) {
  const editing = orgId !== null;
  const detail = useOperatorOrg(orgId);
  const save = useSaveOrg(orgId);
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<OrgRegisterInput>();

  useEffect(() => {
    if (!open) return;
    if (editing && detail.data) {
      const d = detail.data;
      form.setFieldsValue({
        name: d.name,
        region: d.region ?? '',
        socialCreditCode: d.socialCreditCode ?? '',
        contactName: d.contactName ?? '',
        contactPhone: d.contactPhone ?? '',
        contactEmail: d.contactEmail ?? '',
        note: d.note ?? '',
      });
    }
  }, [open, editing, detail.data, form]);

  const close = () => {
    if (!form.isFieldsTouched()) return onClose();
    modal.confirm({
      title: '放弃这次填写？',
      content: '关闭后，刚才填写的内容不会保存。',
      okText: '放弃',
      cancelText: '继续填写',
      okButtonProps: { danger: true },
      onOk: onClose,
    });
  };

  const onFinish = (values: OrgRegisterInput) => {
    const parsed = orgRegisterSchema.safeParse(values);
    if (!parsed.success) {
      message.error(parsed.error.issues[0]?.message ?? '请检查填写的内容');
      return;
    }
    save.mutate(values, {
      onSuccess: () => {
        message.success(editing ? '资料已保存' : '已登记。合同签好、款到账后，在列表里点「开通」');
        form.resetFields();
        onClose();
      },
      onError: (err) => message.error(err.message),
    });
  };

  const fieldRule = (key: keyof OrgRegisterInput) => ({
    validator: (_: unknown, value: unknown) => {
      const r = orgRegisterSchema.shape[key].safeParse(value ?? '');
      return r.success ? Promise.resolve() : Promise.reject(new Error(r.error.issues[0]?.message));
    },
  });

  return (
    <Modal
      title={
        <div>
          <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>{editing ? '修改客户组织资料' : '登记客户组织'}</div>
          <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 400, color: gy.secondary, marginTop: 4 }}>
            {editing
              ? '改动会同步到开通信息和组织详情。'
              : '合作已确认就可以先登记，列表里显示为「待开通」；签好合同、款到账后再开通。邮箱默认作为首位管理员的邮箱。'}
          </div>
        </div>
      }
      open={open}
      onCancel={close}
      onOk={() => form.submit()}
      okText={editing ? '保存' : '登记'}
      cancelText="取消"
      confirmLoading={save.isPending}
      width={600}
      destroyOnHidden
      afterClose={() => form.resetFields()}
    >
      {editing && detail.isPending ? (
        <Loading rows={6} card={false} />
      ) : (
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={requiredAfter} className="gy-form-explain-gap" style={{ marginTop: 24 }}>
          <Form.Item name="name" label="组织名称" required rules={[fieldRule('name')]} style={item}>
            <Input placeholder="与营业执照一致，如：华东安评服务有限公司" maxLength={100} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="region" label="所在地区" required rules={[fieldRule('region')]} style={half}>
              <Input placeholder="如：上海市闵行区" maxLength={50} />
            </Form.Item>
            <Form.Item name="socialCreditCode" label="统一社会信用代码" rules={[fieldRule('socialCreditCode')]} style={half}>
              <Input placeholder="18 位，选填" maxLength={18} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="contactName" label="主联系人" required rules={[fieldRule('contactName')]} style={half}>
              <Input maxLength={50} />
            </Form.Item>
            <Form.Item name="contactPhone" label="手机号" required rules={[fieldRule('contactPhone')]} style={half}>
              <Input maxLength={30} />
            </Form.Item>
          </div>
          <Form.Item name="contactEmail" label="邮箱" rules={[fieldRule('contactEmail')]} style={item}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label="备注" rules={[fieldRule('note')]} style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} maxLength={200} placeholder="选填，仅耕云运营可见" />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
