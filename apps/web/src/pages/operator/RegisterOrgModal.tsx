import { checkRegionParts, orgRegisterSchema, type OrgRegisterInput, type RegionParts } from '@genyun/shared';
import { App, Form, Input, Modal } from 'antd';
import { useEffect } from 'react';
import { useOperatorOrg, useSaveOrg } from '../../api/operator';
import { RegionSelect, useAreaList } from '../../components/RegionSelect';
import { Loading, requiredAfter } from '../../components/ui';
import { gy } from '../../theme/tokens';

// 出错时错误提示占掉下边距，这里固定留 20px，字段之间不会挤在一起
const item = { marginBottom: 20 } as const;
const half = { ...item, flex: 1, minWidth: 0 } as const;

// 登记客户组织 / 修改资料（16 页「登记客户组织」弹窗）。所在地区按省、市、区县三级选
export function RegisterOrgModal({ orgId, open, onClose }: { orgId: string | null; open: boolean; onClose: () => void }) {
  const editing = orgId !== null;
  const detail = useOperatorOrg(orgId);
  const save = useSaveOrg(orgId);
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<OrgRegisterInput>();
  const area = useAreaList();
  // 老数据只有地区文字：三个框空着，提示原来填的文字
  const legacyRegion = editing && detail.data && !detail.data.regionParts ? detail.data.region : null;

  useEffect(() => {
    if (!open) return;
    if (editing && detail.data) {
      const d = detail.data;
      form.setFieldsValue({
        name: d.name,
        region: (d.regionParts ?? undefined) as RegionParts | undefined,
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
      const r = orgRegisterSchema.shape[key].safeParse(value ?? (key === 'region' ? undefined : ''));
      if (!r.success) return Promise.reject(new Error(r.error.issues[0]?.message));
      // 地区再按全国区划核对：这个市下面有区县却没选时请选到区县
      if (key === 'region' && area) {
        const problem = checkRegionParts(r.data as RegionParts, area);
        if (problem) return Promise.reject(new Error(problem));
      }
      return Promise.resolve();
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
              : '合作已确认就可以先登记，列表里显示为「待开通」；签好合同、款到账后再开通。邮箱默认作为首位管理员的邮箱，邀请发到这里。'}
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
            <Form.Item
              name="region"
              label="所在地区"
              required
              rules={[fieldRule('region')]}
              style={half}
              extra="按省、市、区县依次选。开通时会按这里检查知识库有没有对应的属地机构。"
            >
              <RegionSelect legacyText={legacyRegion} />
            </Form.Item>
            <Form.Item
              name="socialCreditCode"
              label="统一社会信用代码"
              required
              rules={[fieldRule('socialCreditCode')]}
              style={half}
              extra="18 位，与营业执照一致。"
            >
              <Input maxLength={18} />
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
          <Form.Item name="contactEmail" label="邮箱" required rules={[fieldRule('contactEmail')]} style={item}>
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
