import { LICENSE_FIELDS, type EnterpriseInput } from '@genyun/shared';
import { App, Breadcrumb, Button, Form, Typography, Upload } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateEnterprise } from '../../api/enterprises';
import { attachEnterpriseLicense, recognizeLicense, uploadFile } from '../../api/profile';
import { useWorkspace } from '../../layouts/workspace';
import { gy } from '../../theme/tokens';
import { EnterpriseFields, enterpriseRequiredMark, showEnterpriseError } from './EnterpriseFields';

const IDENTITY = ['name', 'socialCreditCode', 'legalRepresentative', 'registeredAddress'] as const;

// P01 新建企业｜核对并保存。可先上传营业执照，识别出的身份信息填进表单由客户核对；
// 保存后执照挂到企业上，自填第 1 步不用再传
export function EnterpriseCreatePage() {
  const { orgId } = useWorkspace();
  const create = useCreateEnterprise(orgId);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm<EnterpriseInput>();
  const [dirty, setDirty] = useState(false);
  const [license, setLicense] = useState<{ fileId: string; name: string; note: string } | null>(null);
  const [reading, setReading] = useState(false);

  const readLicense = async (file: File) => {
    setReading(true);
    try {
      const fileId = await uploadFile(orgId, file, 'image_or_pdf');
      const { status, recognized } = await recognizeLicense(orgId, fileId);
      const found = IDENTITY.filter((k) => recognized[k]?.trim());
      form.setFieldsValue(Object.fromEntries(found.map((k) => [k, recognized[k]!.trim()])));
      const count = LICENSE_FIELDS.filter((k) => recognized[k]?.trim()).length;
      setLicense({
        fileId,
        name: file.name,
        note:
          status === 'recognized' && count > 0
            ? `已识别 ${count} 项，已填入下方，请核对`
            : status === 'unavailable' || status === 'failed'
              ? '暂时无法自动识别，请手动填写；执照会随档案保存'
              : '没认出执照上的文字，请手动填写；执照会随档案保存',
      });
      if (found.length > 0) setDirty(true);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败，请稍后重试');
    } finally {
      setReading(false);
    }
  };

  const onFinish = (values: EnterpriseInput) => {
    create.mutate(values, {
      onSuccess: async (created) => {
        if (license) {
          try {
            await attachEnterpriseLicense(created.id, license.fileId);
          } catch {
            message.warning('企业档案已保存，营业执照没挂上，可在企业自填第 1 步重新上传');
          }
        }
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            padding: 16,
            marginBottom: 24,
            borderRadius: 6,
            background: gy.selected,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: '22px' }}>
            <span style={{ fontWeight: 500, color: gy.text }}>
              {license ? license.name : '上传营业执照，可帮助填写下方信息'}
            </span>
            {license ? (
              <span style={{ color: gy.success }}>{license.note}</span>
            ) : (
              <>
                <span style={{ color: gy.secondary }}>PDF、JPG、PNG · 单个文件不超过 10 MB</span>
                <span style={{ color: gy.secondary }}>也可以先手动建档，稍后补传。</span>
              </>
            )}
          </div>
          <Upload
            accept=".pdf,.jpg,.jpeg,.png"
            showUploadList={false}
            disabled={reading}
            beforeUpload={(file) => {
              void readLicense(file);
              return false;
            }}
          >
            <Button loading={reading}>{license ? '重新上传' : '选择营业执照'}</Button>
          </Upload>
        </div>
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
