import type { EnterpriseInput } from '@genyun/shared';
import { App, Breadcrumb, Button, Form, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateEnterprise } from '../../api/enterprises';
import { useWorkspace } from '../../layouts/workspace';
import { gy } from '../../theme/tokens';
import { EnterpriseFields, enterpriseRequiredMark, showEnterpriseError } from './EnterpriseFields';

// P01 新建企业｜核对并保存。营业执照上传与识别在「企业资料」做好后接入（第 10 项）
export function EnterpriseCreatePage() {
  const { orgId } = useWorkspace();
  const create = useCreateEnterprise(orgId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm<EnterpriseInput>();
  const [dirty, setDirty] = useState(false);

  const onFinish = (values: EnterpriseInput) => {
    create.mutate(values, {
      onSuccess: (created) => {
        message.success('企业档案已保存');
        navigate(`/customer/enterprises/${created.id}`, { replace: true });
      },
      onError: (err) => {
        const text = showEnterpriseError(form, err);
        if (text) message.error(text);
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Breadcrumb items={[{ title: <Link to="/customer/enterprises">企业</Link> }, { title: '新建企业' }]} />
      <div>
        <Typography.Title level={1} style={{ fontSize: 28, lineHeight: '40px', fontWeight: 500, margin: 0 }}>
          建立企业档案
        </Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          核对企业身份信息后保存；生产情况与编制资料可以稍后补充。
        </Typography.Text>
      </div>

      <Form
        form={form}
        layout="vertical"
        requiredMark={enterpriseRequiredMark}
        onFinish={onFinish}
        onValuesChange={() => setDirty(true)}
        style={{
          width: 920,
          background: gy.surface,
          border: `1px solid ${gy.split}`,
          borderRadius: 8,
          padding: 24,
        }}
      >
        <Typography.Title level={2} style={{ fontSize: 20, lineHeight: '28px', fontWeight: 500, margin: '0 0 24px' }}>
          核对企业信息
        </Typography.Title>
        <EnterpriseFields />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid ${gy.split}`,
            paddingTop: 8,
          }}
        >
          <Typography.Text type="secondary">{dirty ? '信息尚未保存' : ''}</Typography.Text>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button size="large" onClick={() => navigate('/customer/enterprises')}>
              取消
            </Button>
            <Button size="large" type="primary" htmlType="submit" loading={create.isPending}>
              保存企业档案
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}
