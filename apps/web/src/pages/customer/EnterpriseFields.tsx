import { enterpriseInputSchema, type EnterpriseInput } from '@genyun/shared';
import { Form, Input, type FormInstance } from 'antd';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/request';
import { gy } from '../../theme/tokens';

type Field = keyof EnterpriseInput;

// 用共用规则逐项校验，前后端提示一致
function fieldError(field: Field, value: unknown) {
  const result = enterpriseInputSchema.shape[field].safeParse(value ?? '');
  return result.success ? Promise.resolve() : Promise.reject(new Error(result.error.issues[0]?.message));
}

const FIELDS: { name: Field; label: string; help: string; maxLength: number }[] = [
  { name: 'name', label: '企业名称', help: '请填写与营业执照一致的企业全称。', maxLength: 100 },
  {
    name: 'socialCreditCode',
    label: '统一社会信用代码',
    help: '暂时跳过后，可在资料检查阶段补充或由耕云核实。',
    maxLength: 18,
  },
  { name: 'registeredAddress', label: '注册地址', help: '注册地址与实际生产地址分别保存。', maxLength: 200 },
  { name: 'legalRepresentative', label: '法定代表人', help: '仅填写已核实的信息。', maxLength: 50 },
];

// P01 的四个字段：只有企业名称必填，其余标「选填」
export function EnterpriseFields() {
  return (
    <>
      {FIELDS.map((f) => (
        <Form.Item
          key={f.name}
          name={f.name}
          label={f.label}
          required={f.name === 'name'}
          rules={[{ validator: (_, v) => fieldError(f.name, v) }]}
          extra={<span style={{ fontSize: 12, lineHeight: '20px', color: gy.secondary }}>{f.help}</span>}
          style={{ maxWidth: 720 }}
        >
          <Input size="large" placeholder={f.name === 'name' ? '例如：飞宇制造有限公司' : '暂未填写'} maxLength={f.maxLength} />
        </Form.Item>
      ))}
    </>
  );
}

export function enterpriseRequiredMark(label: ReactNode, { required }: { required: boolean }) {
  return (
    <>
      {label}
      {required ? ' *' : '（选填）'}
    </>
  );
}

// 信用代码重复时把提示放到字段下方；其他错误返回给调用方弹出
export function showEnterpriseError(form: FormInstance, err: unknown): string | null {
  if (err instanceof ApiError && err.status === 409) {
    form.setFields([{ name: 'socialCreditCode', errors: [err.message] }]);
    return null;
  }
  return err instanceof Error ? err.message : '保存失败，请稍后重试';
}
