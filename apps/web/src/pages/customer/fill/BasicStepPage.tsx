import { DownOutlined, LoadingOutlined, RightOutlined } from '@ant-design/icons';
import {
  basicStepSchema,
  ECONOMIC_NATURES,
  enterpriseInputSchema,
  FIELD_SOURCES,
  INDUSTRY_SECTIONS,
  type BasicStep,
  type BasicStepField,
  type BasicStepSave,
  type FieldSource,
} from '@genyun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, InputNumber, Select, Spin, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  attachLicense,
  basicStepKey,
  isStale,
  saveBasicStep,
  uploadFile,
  useBasicStep,
  type BasicStepView,
  type RecognitionStatus,
} from '../../../api/profile';
import { ApiError } from '../../../api/request';
import type { Task } from '../../../api/tasks';
import { useSession } from '../../../auth/session';
import { gy } from '../../../theme/tokens';
import { AFTER_FILLING, FillCard, FillFrame, SidePanel, StepTitle } from './FillFrame';
import { useAutosave } from './useAutosave';

const IDENTITY = ['name', 'socialCreditCode', 'legalRepresentative', 'registeredAddress'] as const;
type IdentityField = (typeof IDENTITY)[number];
type Field = IdentityField | BasicStepField;
type Values = Partial<Record<Field, string | number | null>>;
type Sources = Partial<Record<string, FieldSource>>;

const BASIC_FIELDS = Object.keys(basicStepSchema.shape) as BasicStepField[];
const ALL_FIELDS: Field[] = [...IDENTITY, ...BASIC_FIELDS];
// 执照上的其他信息（默认收起显示，点「修改」再编辑）
const LICENSE_EXTRA: Field[] = ['companyType', 'registeredCapital', 'registrationAuthority', 'registeredAddress'];
// 其他工商与经营信息（折叠卡片）
const OTHER_INFO: { name: BasicStepField; label: string }[] = [
  { name: 'postalCode', label: '邮政编码' },
  { name: 'economicNature', label: '经济性质' },
  { name: 'fax', label: '传真' },
  { name: 'website', label: '网址' },
  { name: 'email', label: '电子邮箱' },
  { name: 'fixedAssets', label: '固定资产' },
  { name: 'lastYearRevenue', label: '上年销售额' },
];

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function toValues(view: BasicStepView): Values {
  const values: Values = {};
  for (const f of IDENTITY) values[f] = view.identity[f] ?? undefined;
  for (const f of BASIC_FIELDS) values[f] = (view.basic[f] as string | number | undefined) ?? undefined;
  return values;
}

// 表单内容 → 保存的内容。格式不对的字段沿用上次保存的值（字段下方已提示），不影响其他字段保存
function toPayload(
  values: Values,
  later: BasicStepField[],
  sources: Sources,
  saved: BasicStepView,
  rejectedCodes: Set<string>,
): Omit<BasicStepSave, 'version'> {
  const identity = { ...saved.identity };
  for (const f of IDENTITY) {
    const v = values[f];
    const check = enterpriseInputSchema.shape[f].safeParse(isEmpty(v) ? null : v);
    if (!check.success) continue;
    if (f === 'socialCreditCode' && check.data && rejectedCodes.has(check.data as string)) continue;
    (identity as Record<string, unknown>)[f] = check.data;
  }
  const basic: Record<string, unknown> = {};
  for (const f of BASIC_FIELDS) {
    if (later.includes(f)) continue;
    const v = values[f];
    if (isEmpty(v)) continue;
    const check = basicStepSchema.shape[f].safeParse(v);
    basic[f] = check.success ? check.data : saved.basic[f];
  }
  return { identity, basic: basic as BasicStep, later, sources: sources as BasicStepSave['sources'] };
}

function fieldRule(f: Field) {
  return {
    validator: (_: unknown, v: unknown) => {
      if (isEmpty(v)) {
        return f === 'name' ? Promise.reject(new Error('请填写企业名称')) : Promise.resolve();
      }
      const schema = (IDENTITY as readonly string[]).includes(f)
        ? enterpriseInputSchema.shape[f as IdentityField]
        : basicStepSchema.shape[f as BasicStepField];
      const r = schema.safeParse(v);
      return r.success ? Promise.resolve() : Promise.reject(new Error(r.error.issues[0]?.message));
    },
  };
}

// S01 企业自填第 1 步「企业基本信息」：边填边自动保存，可以分次填写
export function BasicStepPage({ task }: { task: Task }) {
  const step = useBasicStep(task.enterpriseId);
  const session = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  // preserve：折叠起来的字段也算在内
  const values = (Form.useWatch((v) => v, { form, preserve: true }) ?? {}) as Values;

  const [later, setLater] = useState<BasicStepField[]>([]);
  const [sources, setSources] = useState<Sources>({});
  const [license, setLicense] = useState<BasicStepView['license']>(null);
  const [recognition, setRecognition] = useState<{ status: RecognitionStatus; count: number }>();
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [editingLicenseInfo, setEditingLicenseInfo] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const saved = useRef<BasicStepView | null>(null);
  const rejectedCodes = useRef(new Set<string>());
  const loaded = useRef(false);

  const userName = session.data?.name;

  // 把后台返回的内容放进表单（首次打开、执照识别后、别人改过后）。
  // 联系人空着时默认当前账号；主管负责人空着或还跟着法定代表人时，取法定代表人
  const apply = useCallback(
    (view: BasicStepView): Sources => {
      saved.current = view;
      client.setQueryData(basicStepKey(view.enterpriseId), view);
      setLater(view.later);
      setLicense(view.license);
      const v = toValues(view);
      const tags: Sources = { ...view.sources };
      if (isEmpty(v.contactPerson) && userName) {
        v.contactPerson = userName;
        tags.contactPerson = 'account';
      }
      if (!isEmpty(v.legalRepresentative) && (isEmpty(v.responsiblePerson) || tags.responsiblePerson === 'legal_rep')) {
        v.responsiblePerson = v.legalRepresentative;
        tags.responsiblePerson = 'legal_rep';
      }
      form.setFieldsValue(Object.fromEntries(ALL_FIELDS.map((f) => [f, v[f]])));
      setSources(tags);
      return tags;
    },
    [client, form, userName],
  );

  const autosave = useAutosave<Omit<BasicStepSave, 'version'>>(
    async (payload) => {
      const view = await saveBasicStep(task.enterpriseId, { ...payload, version: saved.current!.version });
      saved.current = view;
      client.setQueryData(basicStepKey(view.enterpriseId), view);
    },
    (err) => {
      if (isStale(err)) {
        message.warning(err.message);
        void step.refetch().then((r) => r.data && apply(r.data));
        return true;
      }
      if (err instanceof ApiError && err.status === 409 && err.body?.field === 'socialCreditCode') {
        const code = form.getFieldValue('socialCreditCode') as string;
        rejectedCodes.current.add(code.trim().toUpperCase());
        form.setFields([{ name: 'socialCreditCode', errors: [err.message] }]);
        queueSave();
        return true;
      }
      return false;
    },
  );

  const queueSave = (nextLater = later, nextSources = sources) => {
    if (!saved.current) return;
    autosave.schedule(
      toPayload(form.getFieldsValue(true), nextLater, nextSources, saved.current, rejectedCodes.current),
    );
  };

  // 首次打开：放入已保存的内容
  useEffect(() => {
    if (!step.data || !userName || loaded.current) return;
    loaded.current = true;
    apply(step.data);
    const v = toValues(step.data);
    setEditingLicenseInfo(LICENSE_EXTRA.every((f) => isEmpty(v[f])));
  }, [step.data, userName, apply]);

  const onValuesChange = (changed: Values) => {
    const next = { ...sources };
    for (const f of Object.keys(changed)) delete next[f];
    // 主管负责人还跟着法定代表人时，一起改
    if ('legalRepresentative' in changed && sources.responsiblePerson === 'legal_rep') {
      form.setFieldValue('responsiblePerson', changed.legalRepresentative);
      next.responsiblePerson = 'legal_rep';
    }
    if ('socialCreditCode' in changed) rejectedCodes.current.clear();
    setSources(next);
    queueSave(later, next);
  };

  const toggleLater = (f: BasicStepField) => {
    const next = later.includes(f) ? later.filter((x) => x !== f) : [...later, f];
    if (!later.includes(f)) form.setFieldValue(f, undefined);
    setLater(next);
    queueSave(next);
  };

  const onLicense = async (file: File) => {
    setLicenseBusy(true);
    setRecognition(undefined);
    try {
      await autosave.flush();
      const fileId = await uploadFile(task.orgId, file, 'image_or_pdf');
      const result = await attachLicense(task.id, task.enterpriseId, fileId);
      autosave.discard();
      const tags = apply(result);
      // 识别后带出的默认值（如主管负责人同法定代表人）一并保存
      queueSave(result.later, tags);
      setRecognition(result.recognition);
      setEditingLicenseInfo(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '上传失败，请稍后重试');
    } finally {
      setLicenseBusy(false);
    }
  };

  const leave = async (to: string) => {
    setLeaving(true);
    try {
      await autosave.flush();
      navigate(to);
    } catch {
      message.error('还有内容没保存成功，请稍后再试');
    } finally {
      setLeaving(false);
    }
  };

  const filled = ALL_FIELDS.filter((f) => !isEmpty(values[f])).length;
  const footer = (
    <>
      <span style={{ fontSize: 14, lineHeight: '22px', color: gy.tertiary }}>
        第 1 步，共 5 步 · 已填 {filled} 项{later.length > 0 ? `，${later.length} 项稍后补` : ''}
      </span>
      <div style={{ display: 'flex', gap: 12 }}>
        <Button size="large" disabled>
          上一步
        </Button>
        <Button
          size="large"
          type="primary"
          loading={leaving}
          onClick={() => void leave(`/customer/tasks/${task.id}/fill/2`)}
        >
          下一步：人员与应急组织
        </Button>
      </div>
    </>
  );

  const tag = (f: Field) => sources[f];

  return (
    <FillFrame
      step={1}
      enterpriseName={values.name ? String(values.name) : task.enterpriseName}
      saveState={autosave.state}
      savedAt={autosave.savedAt}
      onExit={() => void leave(`/customer/enterprises/${task.enterpriseId}`)}
      exiting={leaving}
      footer={footer}
    >
      <div style={{ width: 760, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <StepTitle
          title="先告诉我们，您是一家什么样的企业"
          description="只填您知道的。拍一张营业执照，大部分内容会自动填好；暂时查不到的点「稍后补」，专业判断交给注册安全工程师。"
        />

        {step.isPending ? (
          <Spin style={{ padding: '96px 0' }} />
        ) : (
          <Form<Values>
            form={form}
            layout="vertical"
            requiredMark={false}
            onValuesChange={onValuesChange}
            component={false}
          >
            <LicenseCard
              license={license}
              recognition={recognition}
              recognizerAvailable={step.data?.recognizerAvailable ?? false}
              busy={licenseBusy}
              onFile={onLicense}
            />

            <FillCard title="企业身份" gap={20}>
              <Row>
                <TextField name="name" label="企业名称" source={tag('name')} maxLength={100} />
                <TextField
                  name="socialCreditCode"
                  label="统一社会信用代码"
                  source={tag('socialCreditCode')}
                  maxLength={18}
                />
              </Row>
              <Row>
                <TextField
                  name="legalRepresentative"
                  label="法定代表人"
                  source={tag('legalRepresentative')}
                  maxLength={50}
                />
                <Item name="industry" label={<Label text="所属行业" />}>
                  <Select
                    showSearch
                    allowClear
                    placeholder="请选择"
                    optionFilterProp="label"
                    options={INDUSTRY_SECTIONS.map((s) => ({
                      label: s.section,
                      title: s.section,
                      options: s.items.map(([code, name]) => ({ value: code, label: name })),
                    }))}
                  />
                </Item>
              </Row>
              <Item name="businessScope" label={<Label text="经营范围" source={tag('businessScope')} />}>
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={500} />
              </Item>
              <LicenseInfo
                values={values}
                sources={sources}
                editing={editingLicenseInfo}
                onEdit={() => setEditingLicenseInfo(true)}
              />
            </FillCard>

            <FillCard title="生产地址与规模" gap={20}>
              <Item
                name="siteAddress"
                label={<Label text="实际生产地址" />}
                extra="如与营业执照注册地址不同，请填工厂实际所在地。"
              >
                <Input
                  maxLength={200}
                  placeholder={values.registeredAddress ? String(values.registeredAddress) : undefined}
                />
              </Item>
              <Row>
                <NumberField name="employeeCount" label="员工人数" unit="人" />
                <Item
                  name="safetyManagementCount"
                  label={<Label text="专职或兼职安全管理人员" />}
                  aside={
                    <LaterToggle
                      on={later.includes('safetyManagementCount')}
                      onClick={() => toggleLater('safetyManagementCount')}
                    />
                  }
                >
                  <InputNumber
                    min={0}
                    precision={0}
                    suffix="人"
                    placeholder="人数"
                    disabled={later.includes('safetyManagementCount')}
                    style={{ width: '100%' }}
                  />
                </Item>
              </Row>
              <Row>
                <NumberField name="technicalManagementCount" label="技术管理人员" unit="人" />
                <Item name="mainProducts" label={<Label text="主要产品" />}>
                  <Input maxLength={500} placeholder="如：电热水壶、电饭煲" />
                </Item>
              </Row>
              <Row>
                <NumberField
                  name="landAreaM2"
                  label="厂区占地面积"
                  unit="m²"
                  hint="可稍后补"
                  placeholder="如 13942"
                  decimals
                />
                <Item label={<Label text="总建筑面积" hint="第 4 步填写建筑后自动合计" />}>
                  <InputNumber disabled placeholder="自动合计" suffix="m²" style={{ width: '100%' }} />
                </Item>
              </Row>
            </FillCard>

            <FillCard title="联系人与负责人">
              <p style={{ margin: '-8px 0 0', fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>
                写进预案「企业基本情况」；审核中需要补充时，负责专家会打这个电话。
              </p>
              <Row>
                <TextField name="contactPerson" label="联系人" source={tag('contactPerson')} maxLength={50} />
                <TextField name="contactPhone" label="联系电话" maxLength={30} />
              </Row>
              <Row>
                <TextField
                  name="responsiblePerson"
                  label="主管负责人"
                  source={tag('responsiblePerson')}
                  maxLength={50}
                />
                <span style={{ flex: 1 }} />
              </Row>
            </FillCard>

            <OtherInfoCard values={values} open={otherOpen} onToggle={() => setOtherOpen((o) => !o)} />
          </Form>
        )}
      </div>

      <SidePanel
        why={[
          '预案封面、适用范围和报告对象都要写明企业身份；属地应急管理局由地址决定。',
          '员工人数决定应急小组的建议数量；联系电话只用于审核中需要补充时，负责专家联系您。',
        ]}
        after={AFTER_FILLING}
      />
    </FillFrame>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 16 }}>{children}</div>;
}

function Label({ text, source, hint }: { text: string; source?: FieldSource; hint?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {text}
      {source && (
        <span
          style={{
            padding: '0 6px',
            borderRadius: 4,
            background: '#EEF3FD',
            color: gy.primary,
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          {FIELD_SOURCES[source]}
        </span>
      )}
      {hint && <span style={{ fontSize: 12, lineHeight: '18px', color: gy.tertiary }}>{hint}</span>}
    </span>
  );
}

// 一个表单项：标签在上，8px 间距；aside 放在输入框右侧（如「稍后补」）
function Item({
  name,
  label,
  extra,
  aside,
  children,
}: {
  name?: Field;
  label: ReactNode;
  extra?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const input = (
    <Form.Item
      name={name}
      noStyle={Boolean(aside)}
      rules={name ? [fieldRule(name)] : undefined}
      validateTrigger={['onChange', 'onBlur']}
      label={aside ? undefined : label}
      extra={extra && <span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>{extra}</span>}
      style={{ flex: 1, marginBottom: 0 }}
    >
      {children}
    </Form.Item>
  );
  if (!aside) return input;
  return (
    <Form.Item label={label} style={{ flex: 1, marginBottom: 0 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>{input}</div>
        {aside}
      </div>
    </Form.Item>
  );
}

function TextField({
  name,
  label,
  source,
  maxLength,
}: {
  name: Field;
  label: string;
  source?: FieldSource;
  maxLength: number;
}) {
  return (
    <Item name={name} label={<Label text={label} source={source} />}>
      <Input maxLength={maxLength} />
    </Item>
  );
}

function NumberField({
  name,
  label,
  unit,
  hint,
  placeholder,
  decimals,
}: {
  name: BasicStepField;
  label: string;
  unit: string;
  hint?: string;
  placeholder?: string;
  decimals?: boolean;
}) {
  return (
    <Item name={name} label={<Label text={label} hint={hint} />}>
      <InputNumber
        min={0}
        precision={decimals ? undefined : 0}
        suffix={unit}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
    </Item>
  );
}

function LaterToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <Button
      aria-pressed={on}
      onClick={onClick}
      style={on ? { background: '#EEF3FD', borderColor: gy.primary, color: gy.primary } : undefined}
    >
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          boxSizing: 'border-box',
          border: on ? `4px solid ${gy.primary}` : '1px solid #C4C9D2',
          background: '#FFFFFF',
        }}
      />
      稍后补
    </Button>
  );
}

const STATUS_TEXT: Record<RecognitionStatus, (count: number) => { text: string; ok: boolean }> = {
  recognized: (n) => ({ text: `已识别 ${n} 项，已填入下方，请核对`, ok: true }),
  unrecognized: () => ({ text: '没有认出执照上的内容，请确认照片清晰，或直接手动填写', ok: false }),
  unavailable: () => ({ text: '暂时无法自动识别，请手动填写下方内容', ok: false }),
  failed: () => ({ text: '识别没有成功，请手动填写，或稍后重新上传', ok: false }),
};

function LicenseCard({
  license,
  recognition,
  recognizerAvailable,
  busy,
  onFile,
}: {
  license: BasicStepView['license'];
  recognition?: { status: RecognitionStatus; count: number };
  recognizerAvailable: boolean;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const picker = (children: ReactNode) => (
    <Upload
      accept=".jpg,.jpeg,.png,.pdf"
      showUploadList={false}
      disabled={busy}
      beforeUpload={(file) => {
        onFile(file);
        return false;
      }}
    >
      {children}
    </Upload>
  );
  const status = recognition && STATUS_TEXT[recognition.status](recognition.count);

  return (
    <FillCard
      title="营业执照"
      extra={<span style={{ fontSize: 12, lineHeight: '20px', color: gy.tertiary }}>支持 JPG / PNG / PDF</span>}
    >
      {license || busy ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: 12,
            borderRadius: 8,
            background: '#F3F7FF',
            border: '1px solid #CFDDFB',
          }}
        >
          <LicenseThumb />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, lineHeight: '22px', fontWeight: 500, color: gy.text }}>
              {busy ? '正在上传并识别…' : license?.originalName}
            </span>
            <span
              style={{
                fontSize: 13,
                lineHeight: '20px',
                color: busy ? gy.tertiary : status ? (status.ok ? gy.success : gy.warning) : gy.tertiary,
              }}
            >
              {busy ? <LoadingOutlined /> : status ? status.text : '已上传'}
            </span>
          </div>
          {!busy && picker(<Button type="link">重新上传</Button>)}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '16px 20px',
            borderRadius: 8,
            border: '1px dashed #C9CED6',
          }}
        >
          <span style={{ flex: 1, fontSize: 14, lineHeight: '22px', color: gy.secondary }}>
            {recognizerAvailable
              ? '拍一张营业执照或上传 PDF，企业名称、信用代码等会自动识别并填好。'
              : '上传营业执照照片或 PDF，作为资料留存；下方内容请手动填写。'}
          </span>
          {picker(<Button type="primary">上传营业执照</Button>)}
        </div>
      )}
    </FillCard>
  );
}

function LicenseThumb() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 96,
        height: 68,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        boxSizing: 'border-box',
        borderRadius: 4,
        background: '#FFFFFF',
        border: '1px solid #D9DDE3',
      }}
    >
      <span style={{ width: 40, height: 5, borderRadius: 2, background: '#C9A24A' }} />
      {[70, 60, 66].map((w) => (
        <span key={w} style={{ width: w, height: 4, borderRadius: 2, background: '#D9DDE3' }} />
      ))}
    </div>
  );
}

const LICENSE_EXTRA_LABELS: Record<string, string> = {
  companyType: '公司类型',
  registeredCapital: '注册资本',
  registrationAuthority: '登记机关',
  registeredAddress: '注册地址',
};

// 执照上的其他信息：识别后收起显示，点「修改」展开编辑
function LicenseInfo({
  values,
  sources,
  editing,
  onEdit,
}: {
  values: Values;
  sources: Sources;
  editing: boolean;
  onEdit: () => void;
}) {
  const fromLicense = LICENSE_EXTRA.some((f) => sources[f] === 'license');
  const small = { fontSize: 12, lineHeight: '18px', color: gy.tertiary } as const;
  const value = (f: Field) => (isEmpty(values[f]) ? <span style={{ color: gy.tertiary }}>未填写</span> : values[f]);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        borderRadius: 6,
        background: gy.canvas,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, color: '#3F4A5C' }}>执照上的其他信息</span>
        {fromLicense && <Label text="" source="license" />}
        <span style={{ flex: 1 }} />
        {!editing && (
          <Button type="link" size="small" onClick={onEdit} style={{ padding: 0, height: 20, fontSize: 13 }}>
            修改
          </Button>
        )}
      </div>
      {editing ? (
        <>
          <Row>
            <TextField name="companyType" label="公司类型" source={sources.companyType} maxLength={100} />
            <TextField name="registeredCapital" label="注册资本" source={sources.registeredCapital} maxLength={50} />
          </Row>
          <Row>
            <TextField
              name="registrationAuthority"
              label="登记机关"
              source={sources.registrationAuthority}
              maxLength={100}
            />
            <TextField name="registeredAddress" label="注册地址" source={sources.registeredAddress} maxLength={200} />
          </Row>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24 }}>
            {(['companyType', 'registeredCapital', 'registrationAuthority'] as const).map((f) => (
              <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={small}>{LICENSE_EXTRA_LABELS[f]}</span>
                <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{value(f)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={small}>{LICENSE_EXTRA_LABELS.registeredAddress}</span>
            <span style={{ fontSize: 14, lineHeight: '22px', color: gy.text }}>{value('registeredAddress')}</span>
          </div>
        </>
      )}
    </div>
  );
}

// 其他工商与经营信息：默认折叠，一行概括已填 / 未填
function OtherInfoCard({ values, open, onToggle }: { values: Values; open: boolean; onToggle: () => void }) {
  const done = OTHER_INFO.filter((f) => !isEmpty(values[f.name]));
  const missing = OTHER_INFO.filter((f) => isEmpty(values[f.name]));
  const summary = [
    ...done.map((f) => `${f.label} ${f.name === 'economicNature' ? values[f.name] : String(values[f.name])}`),
    missing.length > 0 ? `${missing.map((f) => f.label).join('、')} 未填，没有的填「无」即可` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '20px 24px',
        borderRadius: 8,
        background: gy.surface,
        border: `1px solid ${gy.split}`,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
      >
        {open ? (
          <DownOutlined style={{ fontSize: 12, color: gy.secondary }} />
        ) : (
          <RightOutlined style={{ fontSize: 12, color: gy.secondary }} />
        )}
        <h2 style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, color: gy.text }}>
          其他工商与经营信息
        </h2>
        <span
          style={{
            padding: '0 6px',
            borderRadius: 4,
            background: gy.neutralBg,
            color: gy.secondary,
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          可稍后补
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 14, lineHeight: '22px', color: gy.primary }}>{open ? '收起' : '展开填写'}</span>
      </button>
      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
          <Row>
            <TextField name="postalCode" label="邮政编码" maxLength={6} />
            <Item name="economicNature" label={<Label text="经济性质" />}>
              <Select allowClear placeholder="请选择" options={ECONOMIC_NATURES.map((n) => ({ value: n, label: n }))} />
            </Item>
          </Row>
          <Row>
            <TextField name="fax" label="传真" maxLength={30} />
            <TextField name="website" label="网址" maxLength={100} />
          </Row>
          <Row>
            <TextField name="email" label="电子邮箱" maxLength={100} />
            <TextField name="fixedAssets" label="固定资产" maxLength={50} />
          </Row>
          <Row>
            <TextField name="lastYearRevenue" label="上年销售额" maxLength={50} />
            <span style={{ flex: 1 }} />
          </Row>
        </div>
      ) : (
        <p style={{ margin: 0, paddingLeft: 24, fontSize: 13, lineHeight: '20px', color: gy.tertiary }}>{summary}</p>
      )}
    </section>
  );
}
