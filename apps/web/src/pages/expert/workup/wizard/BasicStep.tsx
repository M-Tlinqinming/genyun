import { DownOutlined, FileImageOutlined, RightOutlined } from '@ant-design/icons';
import {
  basicStepView,
  ECONOMIC_NATURES,
  INDUSTRY_SECTIONS,
  SOCIAL_CREDIT_CODE,
  wizardStepOfKey,
  workupFacts,
  type BasicStep as BasicStepData,
  type WorkupSnapshot,
} from '@genyun/shared';
import { App, Button, Checkbox, Image, Input, Modal, Select } from 'antd';
import { useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../../api/request';
import { inlineUrl, useSaveBasicStep, useSaveFact } from '../../../../api/workup';
import { SourceTag } from '../../../../components/SourceTag';
import { gy, type, weight } from '../../../../theme/tokens';
import { OriginalSheetCard } from './OriginalSheetCard';
import {
  caption,
  Card,
  dayOf,
  Field,
  FieldTag,
  InfoBox,
  InfoItem,
  inputLine,
  link14,
  Row,
  StepTitle,
  UseCard,
  type FieldSource,
} from './parts';
import type { StepProps } from './types';

type Identity = WorkupSnapshot['identity'];

const filled = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '');
const same = (a: unknown, b: unknown) => (filled(a) ? String(a).trim() : '') === (filled(b) ? String(b).trim() : '');

// 选填的工商与经营信息（默认收起）
const OTHER_FIELDS = [
  ['postalCode', '邮政编码'],
  ['economicNature', '经济性质'],
  ['fax', '传真'],
  ['website', '网址'],
  ['email', '电子邮箱'],
  ['fixedAssets', '固定资产'],
  ['lastYearRevenue', '上年销售额'],
] as const;

// 「先留空」用事实键，和老整理页、生成前检查一致
const BLANK_KEY: Partial<Record<keyof BasicStepData | keyof Identity, string>> = {
  name: 'companyName',
  landAreaM2: 'landArea',
};
const blankKeyOf = (field: string) => BLANK_KEY[field as keyof typeof BLANK_KEY] ?? field;

const COUNT_LABELS = { employeeCount: '员工人数', technicalManagementCount: '技术管理人员', safetyManagementCount: '专职或兼职安全管理人员' };

// 读屏用的字段名
const LABELS: Partial<Record<string, string>> = {
  name: '企业名称',
  socialCreditCode: '统一社会信用代码',
  legalRepresentative: '法定代表人',
  registeredAddress: '注册地址',
  companyType: '公司类型',
  registeredCapital: '注册资本',
  registrationAuthority: '登记机关',
  siteAddress: '实际生产地址',
  mainProducts: '主要产品',
  contactPerson: '联系人',
  contactPhone: '联系电话',
  responsiblePerson: '安全生产主管负责人',
  ...Object.fromEntries(OTHER_FIELDS),
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 底栏「客户已填 X 项，Y 项未填」按这几项数：上面几张卡片里客户该填的字段；
// 收起的选填工商信息、系统带出的属地部门、第 4 步自动合计的建筑面积不算
const IDENTITY_COUNTED = ['name', 'socialCreditCode', 'legalRepresentative', 'registeredAddress'] as const;
const BASIC_COUNTED = [
  'industry',
  'businessScope',
  'companyType',
  'registeredCapital',
  'registrationAuthority',
  'siteAddress',
  'employeeCount',
  'safetyManagementCount',
  'technicalManagementCount',
  'mainProducts',
  'landAreaM2',
  'contactPerson',
  'contactPhone',
  'responsiblePerson',
] as const;

// 页面上只拦会让保存失败的格式（企业名称、邮编、邮箱）；有错的那几项先不存，其余照常自动保存
function errorsOf(identity: Identity, basic: BasicStepData): Record<string, string> {
  const e: Record<string, string> = {};
  if (!identity.name.trim()) e.name = '请填写企业名称';
  if (identity.socialCreditCode && !SOCIAL_CREDIT_CODE.test(identity.socialCreditCode.trim().toUpperCase()))
    e.socialCreditCode = '统一社会信用代码应为 18 位数字或字母，请对照执照';
  if (basic.postalCode && !/^\d{6}$/.test(basic.postalCode)) e.postalCode = '邮政编码应为 6 位数字';
  if (basic.email && !EMAIL.test(basic.email)) e.email = '邮箱格式不对';
  return e;
}

// 去掉空值；有错的项用上次存上的值
function payloadOf(identity: Identity, basic: BasicStepData, errors: Record<string, string>, saved: { identity: Identity; basic: BasicStepData }) {
  const b: Record<string, unknown> = { ...basic };
  for (const k of ['postalCode', 'email'] as const) if (errors[k]) b[k] = saved.basic[k];
  for (const [k, v] of Object.entries(b)) if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) delete b[k];
  const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    identity: {
      name: errors.name ? saved.identity.name : identity.name.trim(),
      socialCreditCode: text(identity.socialCreditCode),
      legalRepresentative: text(identity.legalRepresentative),
      registeredAddress: text(identity.registeredAddress),
    },
    basic: b as BasicStepData,
  };
}

// 资料核对第 1 步「核对企业基本信息」（13 页 E2-1）：按客户表格预填，专家逐项核对；改动整步存进专家那份
export function BasicStep({ taskId, workup, autosave, customerText, frame, onGo, latestVersion }: StepProps) {
  const { message } = App.useApp();
  const save = useSaveBasicStep(taskId);
  // 只在进这一步时读一次（之后以页面上的为准；别人改过时外壳会重置这一步）
  const [initial] = useState(() => basicStepView(workup.snapshot, workup.data));
  const [identity, setIdentity] = useState<Identity>(initial.identity);
  // 经济性质：客户没选时按公司类型预选（存的时候一起存上）
  const [basic, setBasic] = useState<BasicStepData>(() => {
    const preset = initial.basic.economicNature ? undefined : economicNatureOf(initial.basic.companyType);
    return preset ? { ...initial.basic, economicNature: preset } : initial.basic;
  });
  const [blank, setBlank] = useState<string[]>(() => (workup.data.blank ?? []).filter((k) => wizardStepOfKey(k) === 'basic'));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [licenseEditing, setLicenseEditing] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const saved = useRef({ identity: initial.identity, basic: initial.basic });
  const refs = useRef(new Map<string, HTMLElement>());

  // 客户原表里的值（来源标签按它比）
  const customer = workup.snapshot;
  const customerBasic = customer.profile.basicStep?.basic ?? {};
  const errors = errorsOf(identity, basic);
  const customerValues = [
    ...IDENTITY_COUNTED.map((k) => customer.identity[k]),
    ...BASIC_COUNTED.map((k) => (customerBasic as Record<string, unknown>)[k]),
  ];
  const customerCounted = customerValues.length;
  const customerFilled = customerValues.filter(filled).length;

  const facts = useMemo(() => workupFacts(workup.snapshot, workup.data, workup.agencyDistricts), [workup]);
  const fact = (key: string) => facts.find((f) => f.key === key);
  // 成立日期、上级主管单位：只有专家补，存在单项修改里（写进预案「企业概况」）
  const saveFactMutation = useSaveFact(taskId);
  const saveExpertFact = (key: string, value: string | null) =>
    autosave.flush(async () => {
      await saveFactMutation.mutateAsync({ version: latestVersion(), key, value, source: 'expert' });
    });

  const send = (next: { identity: Identity; basic: BasicStepData; blank: string[] }, stepsDone?: number) => {
    const payload = payloadOf(next.identity, next.basic, errorsOf(next.identity, next.basic), saved.current);
    return async () => {
      await save.mutateAsync({ version: latestVersion(), ...payload, blank: next.blank, stepsDone });
      saved.current = payload;
    };
  };

  const change = (patch: { identity?: Partial<Identity>; basic?: Partial<BasicStepData>; blank?: string[] }) => {
    const next = {
      identity: { ...identity, ...patch.identity },
      basic: { ...basic, ...patch.basic },
      blank: patch.blank ?? blank,
    };
    // 填了值就不再是留空
    next.blank = next.blank.filter((k) => {
      const field = Object.entries(BLANK_KEY).find(([, v]) => v === k)?.[0] ?? k;
      const v = (next.basic as Record<string, unknown>)[field] ?? (next.identity as Record<string, unknown>)[field];
      return !filled(v);
    });
    setIdentity(next.identity);
    setBasic(next.basic);
    setBlank(next.blank);
    autosave.schedule(send(next));
  };
  const setId = (k: keyof Identity) => (v: string) => change({ identity: { [k]: v } });
  const setB = <K extends keyof BasicStepData>(k: K) => (v: BasicStepData[K]) => change({ basic: { [k]: v } as Partial<BasicStepData> });
  const touch = (k: string) => () => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
  const errorOf = (k: string) => (touched.has(k) ? errors[k] : undefined);

  const src = (value: unknown, customerValue: unknown, blankKey?: string): FieldSource => {
    if (!filled(value)) return blankKey && blank.includes(blankKey) ? null : filled(customerValue) ? 'expert' : 'missing';
    return same(value, customerValue) ? 'customer' : 'expert';
  };
  const optionalSrc = (value: unknown, customerValue: unknown): FieldSource =>
    !filled(value) ? (filled(customerValue) ? 'expert' : null) : same(value, customerValue) ? 'customer' : 'expert';
  const tag = (s: FieldSource) => <FieldTag source={s} customerText={customerText} />;

  const text = (k: keyof Identity | keyof BasicStepData, value: string | undefined | null, onChange: (v: string) => void, opts: { placeholder?: string; maxLength?: number } = {}) => (
    <Input
      ref={(el) => {
        const node = el?.input;
        if (node) refs.current.set(k, node);
      }}
      aria-label={LABELS[k]}
      value={value ?? ''}
      status={errorOf(k) ? 'error' : undefined}
      placeholder={opts.placeholder}
      maxLength={opts.maxLength ?? 200}
      onChange={(e) => onChange(e.target.value)}
      onBlur={touch(k)}
      style={{ height: 36 }}
    />
  );
  const count = (k: 'employeeCount' | 'technicalManagementCount' | 'safetyManagementCount', placeholder?: string) => (
    <Input
      aria-label={COUNT_LABELS[k]}
      inputMode="numeric"
      value={basic[k] === undefined ? '' : String(basic[k])}
      placeholder={placeholder}
      suffix={<span style={caption}>人</span>}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 7);
        setB(k)(digits === '' ? undefined : Number(digits));
      }}
      style={{ height: 36 }}
    />
  );
  const blankBox = (field: string, value: unknown) =>
    !filled(value) && (
      <Checkbox
        checked={blank.includes(blankKeyOf(field))}
        onChange={(e) => {
          const key = blankKeyOf(field);
          change({ blank: e.target.checked ? [...blank, key] : blank.filter((k) => k !== key) });
        }}
      >
        <span style={{ ...type.body, color: gy.text, whiteSpace: 'nowrap' }}>先留空，文稿标「待补充」</span>
      </Checkbox>
    );

  // 还要专家补的：必需的没填、也没勾先留空
  const required: [string, unknown][] = [
    ['name', identity.name],
    ['socialCreditCode', identity.socialCreditCode],
    ['legalRepresentative', identity.legalRepresentative],
    ['registeredAddress', identity.registeredAddress],
    ['mainProducts', basic.mainProducts],
    ['employeeCount', basic.employeeCount],
    ['technicalManagementCount', basic.technicalManagementCount],
    ['contactPerson', basic.contactPerson],
    ['contactPhone', basic.contactPhone],
  ];
  const todo = required.filter(([k, v]) => !filled(v) && !blank.includes(blankKeyOf(k)));
  const errorKeys = Object.keys(errors).filter((k) => k !== 'socialCreditCode');

  const next = async () => {
    if (errorKeys.length) {
      setTouched(new Set([...touched, ...errorKeys]));
      refs.current.get(errorKeys[0]!)?.focus();
      return;
    }
    const ok = await autosave.flush(send({ identity, basic, blank }, Math.max(workup.data.stepsDone ?? 0, 1)));
    if (ok) onGo(2);
  };

  // ── 营业执照：新流程按文件名找客户这次上传的；老流程用第 1 步记下的那份 ──
  const license =
    workup.flow === 'intake'
      ? workup.intakeFiles.find((f) => /执照/.test(f.name))
      : (() => {
          const id = customer.profile.basicStep?.licenseFileId;
          const o = workup.originals.find((x) => x.fileId === id) ?? workup.originals.find((x) => x.itemKeys.includes('business_license'));
          return o && { fileId: o.fileId, name: o.name, uploadedAt: o.uploadedAt };
        })();
  const [preview, setPreview] = useState<string | null>(null);
  const openLicense = async () => {
    if (!license) return;
    const isPdf = /\.pdf$/i.test(license.name);
    // PDF 开新标签；先同步开窗，免得被浏览器拦
    const win = isPdf ? window.open('', '_blank') : null;
    try {
      const { url } = await inlineUrl(license.fileId);
      if (win) win.location.href = url;
      else setPreview(url);
    } catch (err) {
      win?.close();
      message.error(err instanceof ApiError ? err.message : '打不开原图，请稍后再试');
    }
  };

  const [agencyOpen, setAgencyOpen] = useState(false);
  const floor = fact('totalFloorArea');
  const otherSummary = (() => {
    const done = OTHER_FIELDS.filter(([k]) => filled(basic[k]));
    const empty = OTHER_FIELDS.filter(([k]) => !filled(basic[k]));
    return [
      ...done.map(([k, l]) => `${l} ${basic[k]}`),
      ...(empty.length ? [`${empty.map(([, l]) => l).join('、')} ${customerText === '客户表格' ? '客户未填' : '客户没填'}，可留空`] : []),
    ].join(' · ');
  })();

  const main = (
    <>
      <StepTitle
        title="核对企业基本信息"
        customerText={customerText}
        sub={`已按${customerText}预填，请逐项核对。您的改动会单独标记，客户原表不变；客户没填的选填项，由您补充或留空。`}
      />

      <Card
        title="营业执照"
        gap={16}
        extra={license && <span style={caption}>客户上传 · {dayOf(license.uploadedAt)}</span>}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 12, background: gy.canvas, border: `1px solid ${gy.split}`, borderRadius: 8 }}>
          <span
            aria-hidden
            style={{ width: 96, height: 68, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: gy.surface, border: `1px solid ${gy.split}`, color: gy.tertiary, fontSize: 24 }}
          >
            <FileImageOutlined />
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ ...type.body, fontWeight: weight.strong, color: gy.text, overflowWrap: 'anywhere' }}>{license ? license.name : '客户没有单独上传营业执照'}</span>
            <span style={caption}>{license ? `客户选传，供您核对时参考；下面各项以${customerText}为准` : `下面各项以${customerText}为准`}</span>
          </div>
          {license && (
            <button type="button" style={link14} onClick={() => void openLicense()}>
              查看原图
            </button>
          )}
          {preview && (
            <Image
              src={preview}
              alt="营业执照原图"
              style={{ display: 'none' }}
              preview={{ open: true, src: preview, onOpenChange: (v) => !v && setPreview(null) }}
            />
          )}
        </div>
      </Card>

      <Card title="企业身份">
        <Row>
          <Field label="企业名称" tag={tag(src(identity.name, customer.identity.name))} error={errorOf('name')}>
            {text('name', identity.name, setId('name'), { maxLength: 100 })}
          </Field>
          <Field label="统一社会信用代码" tag={tag(src(identity.socialCreditCode, customer.identity.socialCreditCode))} error={errorOf('socialCreditCode')}>
            {text('socialCreditCode', identity.socialCreditCode, setId('socialCreditCode'), { maxLength: 30 })}
          </Field>
        </Row>
        <Row>
          <Field label="法定代表人" tag={tag(src(identity.legalRepresentative, customer.identity.legalRepresentative))}>
            {text('legalRepresentative', identity.legalRepresentative, setId('legalRepresentative'), { maxLength: 50 })}
          </Field>
          <Field label="所属行业" tag={tag(optionalSrc(basic.industry, customerBasic.industry))}>
            <Select
              aria-label="所属行业"
              showSearch
              allowClear
              placeholder="请选择"
              optionFilterProp="label"
              value={basic.industry}
              onChange={(v) => setB('industry')(v ?? undefined)}
              options={INDUSTRY_SECTIONS.map((s) => ({ label: s.section, title: s.section, options: s.items.map(([code, name]) => ({ value: code, label: name })) }))}
              style={{ height: 36 }}
            />
          </Field>
        </Row>
        <Field label="经营范围" tag={tag(optionalSrc(basic.businessScope, customerBasic.businessScope))}>
          <Input.TextArea
            aria-label="经营范围"
            value={basic.businessScope ?? ''}
            autoSize={{ minRows: 2, maxRows: 5 }}
            maxLength={500}
            onChange={(e) => setB('businessScope')(e.target.value)}
          />
        </Field>
        <InfoBox
          title="执照上的其他信息"
          tag={<SourceTag kind="customer" text={customerText} />}
          extra={
            <button type="button" style={link14} aria-expanded={licenseEditing} onClick={() => setLicenseEditing(!licenseEditing)}>
              {licenseEditing ? '收起' : '修改'}
            </button>
          }
        >
          {licenseEditing ? (
            <>
              <Row gap={16}>
                <Field label="公司类型" tag={tag(optionalSrc(basic.companyType, customerBasic.companyType))}>
                  {text('companyType', basic.companyType, setB('companyType'), { maxLength: 50 })}
                </Field>
                <Field label="注册资本" tag={tag(optionalSrc(basic.registeredCapital, customerBasic.registeredCapital))}>
                  {text('registeredCapital', basic.registeredCapital, setB('registeredCapital'), { maxLength: 50 })}
                </Field>
                <Field label="登记机关" tag={tag(optionalSrc(basic.registrationAuthority, customerBasic.registrationAuthority))}>
                  {text('registrationAuthority', basic.registrationAuthority, setB('registrationAuthority'), { maxLength: 100 })}
                </Field>
              </Row>
              <Field label="注册地址" tag={tag(src(identity.registeredAddress, customer.identity.registeredAddress))}>
                {text('registeredAddress', identity.registeredAddress, setId('registeredAddress'))}
              </Field>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 24 }}>
                <InfoItem label="公司类型" value={basic.companyType} />
                <InfoItem label="注册资本" value={basic.registeredCapital} />
                <InfoItem label="登记机关" value={basic.registrationAuthority} />
              </div>
              <InfoItem label="注册地址" value={identity.registeredAddress} />
            </>
          )}
        </InfoBox>
      </Card>

      <Card title="生产地址与规模">
        <Field
          label="实际生产地址"
          tag={tag(optionalSrc(basic.siteAddress, customerBasic.siteAddress))}
          hint={`${customerText}填的地址。与营业执照上的注册地址不同时，以实际生产地址为准。`}
        >
          {text('siteAddress', basic.siteAddress, setB('siteAddress'))}
        </Field>
        <InfoBox
          title="已按地址匹配属地部门 · 系统带出"
          background="#F6F8FA"
          radius={8}
          extra={
            <button type="button" style={link14} onClick={() => setAgencyOpen(true)}>
              修改
            </button>
          }
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
            {(
              [
                ['agency.emergencyBureau', '应急管理'],
                ['agency.fireDept', '消防救援'],
                ['agency.streetOffice', '所在街道'],
                ['agency.park', '园区管理方'],
              ] as const
            ).map(([key, label]) => {
              const f = fact(key);
              const empty = key === 'agency.park' ? (basic.inPark === 'no' ? '不在园区' : '未填') : (f?.hint ?? '未匹配到');
              return <InfoItem key={key} label={label} value={f?.value ? String(f.value) : <span style={{ color: gy.tertiary }}>{empty}</span>} />;
            })}
          </div>
        </InfoBox>
        <Row>
          <Field label="员工人数" tag={tag(src(basic.employeeCount, customerBasic.employeeCount, 'employeeCount'))} aside={blankBox('employeeCount', basic.employeeCount)}>
            {count('employeeCount')}
          </Field>
          <Field
            label="专职或兼职安全管理人员"
            tag={tag(src(basic.safetyManagementCount, customerBasic.safetyManagementCount, 'safetyManagementCount'))}
            aside={blankBox('safetyManagementCount', basic.safetyManagementCount)}
          >
            {count('safetyManagementCount', '待您补充')}
          </Field>
        </Row>
        <Row>
          <Field
            label="技术管理人员"
            tag={tag(src(basic.technicalManagementCount, customerBasic.technicalManagementCount, 'technicalManagementCount'))}
            aside={blankBox('technicalManagementCount', basic.technicalManagementCount)}
          >
            {count('technicalManagementCount')}
          </Field>
          <Field label="主要产品" tag={tag(src(basic.mainProducts, customerBasic.mainProducts, 'mainProducts'))} aside={blankBox('mainProducts', basic.mainProducts)}>
            {text('mainProducts', basic.mainProducts, setB('mainProducts'), { maxLength: 500 })}
          </Field>
        </Row>
        <Row>
          <Field
            label={
              <>
                厂区占地面积 <span style={caption}>（选填）</span>
              </>
            }
            tag={tag(optionalSrc(basic.landAreaM2, customerBasic.landAreaM2))}
          >
            <Input
              aria-label="厂区占地面积"
              inputMode="decimal"
              value={basic.landAreaM2 === undefined ? '' : String(basic.landAreaM2)}
              placeholder="如 13942"
              suffix={<span style={caption}>m²</span>}
              onChange={(e) => {
                const v = e.target.value.replace(/[^\d.]/g, '');
                const n = Number.parseFloat(v);
                setB('landAreaM2')(v === '' || !Number.isFinite(n) ? undefined : n);
              }}
              style={{ height: 36 }}
            />
          </Field>
          <Field label="总建筑面积" hint="第 4 步填写建筑后自动合计">
            <Input aria-label="总建筑面积" disabled value={floor?.value ? String(floor.value) : ''} placeholder="自动合计" suffix={<span style={caption}>m²</span>} style={{ height: 36 }} />
          </Field>
        </Row>
      </Card>

      <Card title="联系人与负责人" hint="写进预案「企业基本情况」。需要向客户核实时，请客服用这个电话或企业微信联系。">
        <Row>
          <Field label="联系人" tag={tag(src(basic.contactPerson, customerBasic.contactPerson, 'contactPerson'))} aside={blankBox('contactPerson', basic.contactPerson)}>
            {text('contactPerson', basic.contactPerson, setB('contactPerson'), { maxLength: 50 })}
          </Field>
          <Field label="联系电话" tag={tag(src(basic.contactPhone, customerBasic.contactPhone, 'contactPhone'))} aside={blankBox('contactPhone', basic.contactPhone)}>
            {text('contactPhone', basic.contactPhone, setB('contactPhone'), { maxLength: 30 })}
          </Field>
        </Row>
        <Row>
          <Field label="安全生产主管负责人" tag={tag(optionalSrc(basic.responsiblePerson, customerBasic.responsiblePerson))}>
            {text('responsiblePerson', basic.responsiblePerson, setB('responsiblePerson'), { maxLength: 50 })}
          </Field>
          <span style={{ flex: 1 }} />
        </Row>
      </Card>

      <section
        aria-label="其他工商与经营信息"
        style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '20px 24px', background: gy.surface, border: `1px solid ${gy.split}`, borderRadius: 8 }}
      >
        <button
          type="button"
          aria-expanded={othersOpen}
          onClick={() => setOthersOpen(!othersOpen)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
        >
          <span aria-hidden style={{ width: 16, color: gy.tertiary, fontSize: 12 }}>
            {othersOpen ? <DownOutlined /> : <RightOutlined />}
          </span>
          <span style={{ ...type.subtitle, fontWeight: weight.strong, color: gy.text }}>其他工商与经营信息</span>
          <span style={{ padding: '0 6px', borderRadius: 4, ...type.caption, background: gy.neutralBg, color: gy.secondary }}>选填</span>
          <span style={{ flex: 1 }} />
          <span style={{ ...type.body, color: gy.primary }}>{othersOpen ? '收起' : '展开核对'}</span>
        </button>
        {!othersOpen && <span style={{ ...caption, paddingLeft: 24 }}>{otherSummary}</span>}
        {othersOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 8 }}>
            <Row>
              <Field label="邮政编码" tag={tag(optionalSrc(basic.postalCode, customerBasic.postalCode))} error={errorOf('postalCode')}>
                {text('postalCode', basic.postalCode, setB('postalCode'), { maxLength: 6 })}
              </Field>
              <Field
                label="经济性质"
                tag={tag(
                  !customerBasic.economicNature && basic.economicNature && basic.economicNature === economicNatureOf(basic.companyType)
                    ? 'system'
                    : optionalSrc(basic.economicNature, customerBasic.economicNature),
                )}
              >
                <Select
                  aria-label="经济性质"
                  allowClear
                  placeholder="请选择"
                  value={basic.economicNature}
                  onChange={(v) => setB('economicNature')(v ?? undefined)}
                  options={ECONOMIC_NATURES.map((n) => ({ value: n, label: n }))}
                  style={{ height: 36 }}
                />
              </Field>
            </Row>
            <Row>
              <Field label="传真" tag={tag(optionalSrc(basic.fax, customerBasic.fax))}>
                {text('fax', basic.fax, setB('fax'), { maxLength: 30 })}
              </Field>
              <Field label="网址" tag={tag(optionalSrc(basic.website, customerBasic.website))}>
                {text('website', basic.website, setB('website'), { maxLength: 100 })}
              </Field>
            </Row>
            <Row>
              <Field label="电子邮箱" tag={tag(optionalSrc(basic.email, customerBasic.email))} error={errorOf('email')}>
                {text('email', basic.email, setB('email'), { maxLength: 100 })}
              </Field>
              <Field label="固定资产" tag={tag(optionalSrc(basic.fixedAssets, customerBasic.fixedAssets))}>
                {text('fixedAssets', basic.fixedAssets, setB('fixedAssets'), { maxLength: 50 })}
              </Field>
            </Row>
            <Row>
              <Field label="上年销售额" tag={tag(optionalSrc(basic.lastYearRevenue, customerBasic.lastYearRevenue))}>
                {text('lastYearRevenue', basic.lastYearRevenue, setB('lastYearRevenue'), { maxLength: 50 })}
              </Field>
              <FactField label="成立日期" factKey="establishedDate" placeholder="如 2008 年 5 月" facts={facts} save={saveExpertFact} />
            </Row>
            <Row>
              <FactField label="上级主管单位" factKey="superior" placeholder="没有可不填" facts={facts} save={saveExpertFact} />
              <span style={{ flex: 1 }} />
            </Row>
          </div>
        )}
      </section>

      <AgencyModal open={agencyOpen} onClose={() => setAgencyOpen(false)} taskId={taskId} autosaveFlush={() => autosave.flush()} latestVersion={latestVersion} facts={facts} />
    </>
  );

  const side = (
    <>
      <OriginalSheetCard taskId={taskId} workup={workup} sheets={['企业信息']} />
      <UseCard
        lines={[
          '预案封面、适用范围和报告对象都要写明企业身份；属地应急管理局由地址决定，系统已按地址匹配。',
          '员工人数决定设几个应急小组。联系电话会写进预案，请确认是能接通的号码。',
        ]}
      />
    </>
  );

  return frame({
    main,
    side,
    note: `第 1 步，共 5 步 · 客户已填 ${customerFilled} 项，${customerCounted - customerFilled} 项未填${todo.length ? `；还有 ${todo.length} 项待您补充或留空` : ''}`,
    actions: (
      <Button type="primary" onClick={() => void next()}>
        下一步：人员与应急组织
      </Button>
    ),
  });
}

// 公司类型 → 经济性质（只在客户没选时预选；其余不预选）
function economicNatureOf(companyType: string | undefined): BasicStepData['economicNature'] {
  const t = companyType ?? '';
  if (/国有|全民/.test(t)) return '全民所有制';
  if (/集体/.test(t)) return '集体所有制';
  if (/自然人|私营|个人独资|合伙/.test(t)) return '私有制';
  return undefined;
}

// 只有专家补的一项企业事实：离开输入框时保存，清空就删掉
function FactField({
  label,
  factKey,
  placeholder,
  facts,
  save,
}: {
  label: string;
  factKey: string;
  placeholder: string;
  facts: ReturnType<typeof workupFacts>;
  save: (key: string, value: string | null) => Promise<boolean>;
}) {
  const stored = facts.find((f) => f.key === factKey)?.value;
  const initial = stored === undefined ? '' : String(stored);
  const [value, setValue] = useState(initial);
  return (
    <Field label={label} tag={initial ? <SourceTag kind="expert" text="您已填写" /> : null}>
      <Input
        aria-label={label}
        value={value}
        maxLength={100}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const v = value.trim();
          if (v !== initial) void save(factKey, v || null);
        }}
        style={{ height: 36 }}
      />
    </Field>
  );
}

// 属地部门：系统按地址匹配，专家可以改成当地的实际名称；清空就回到系统匹配的
function AgencyModal({
  open,
  onClose,
  taskId,
  autosaveFlush,
  latestVersion,
  facts,
}: {
  open: boolean;
  onClose: () => void;
  taskId: string;
  autosaveFlush: () => Promise<boolean>;
  latestVersion: () => number;
  facts: ReturnType<typeof workupFacts>;
}) {
  const { message } = App.useApp();
  const saveFact = useSaveFact(taskId);
  const keys = [
    ['agency.emergencyBureau', '应急管理'],
    ['agency.fireDept', '消防救援'],
    ['agency.streetOffice', '所在街道'],
    ['agency.park', '园区管理方'],
  ] as const;
  const valueOf = (key: string) => {
    const f = facts.find((x) => x.key === key);
    return f?.override ? String(f.override.value) : '';
  };
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await autosaveFlush();
      let version = latestVersion();
      for (const [key] of keys) {
        const v = (values[key] ?? valueOf(key)).trim();
        if (v === valueOf(key)) continue;
        const saved = await saveFact.mutateAsync({ version, key, value: v || null, source: 'expert' });
        version = saved.version;
      }
      onClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : '保存失败，请检查网络后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="修改属地部门"
      open={open}
      width={480}
      okText="保存"
      cancelText="取消"
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onClose}
      afterOpenChange={(o) => o && setValues({})}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span style={{ ...type.body, color: gy.secondary }}>系统按实际生产地址匹配了属地部门。当地叫法不同时在这里改；清空就回到系统匹配的。</span>
        {keys.map(([key, label]) => {
          const f = facts.find((x) => x.key === key);
          return (
            <Field key={key} label={label}>
              <Input
                aria-label={label}
                value={values[key] ?? valueOf(key)}
                placeholder={f?.override ? undefined : f?.value ? String(f.value) : '未匹配到，请填写'}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                maxLength={100}
                style={{ height: 36, borderColor: inputLine }}
              />
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}
