# 客户字段反向追溯（design/uxd-v2，2026-11-04）

这份表从交付稿生成和导出的代码往回查，看客户填写或上传的每个字段有没有被用到。只读调研，没有改代码。

**结论怎么定**
- **必需**：交付稿直接用到；缺了会出现「（待补充）」或内容出错。如果缺了只显示「—」或「/」，会单独注明（这类字段影响不大，可以考虑删减）。
- **必需（间接）**：不直接出现在正文里，但会影响适用范围的判断、危险源建议或占位符的选择。
- **有用**：生成不用，但专家事实面板、原件面板、运营或校验会读。
- **没人用**：存了，但除了客户自己的页面，没有地方读。

**数据怎么流动**
1. 客户填的 `enterprises.profile`（jsonb）加上企业身份列，复制成 WorkupSnapshot。
2. 专家的改动存在 `WorkupData.overrides`。
3. `planInputOf`（packages/shared/src/workup-plan.ts:227）把两者合成 PlanInput。
4. `planContext`（apps/api/src/generation/plan/context.ts）准备各章共用的数据。
5. 由 assemble.ts、comprehensive.ts、attachments.ts 和 reports/risk.ts、resource.ts、common.ts 生成文档。

**常用缩写**
- 下文路径前缀 `gen/` = apps/api/src/generation/，`shared/` = packages/shared/src/，`web/` = apps/web/src/。
- 附件1 = 预案附件 1「生产经营单位概况」（gen/plan/attachments.ts:47-140）。
- 报告概况 = 风险评估报告和应急资源调查报告共用的企业概况段落和基本情况表（gen/reports/common.ts:15、22）。

---

## 1. 新建企业 / 企业身份（新建页 EnterpriseFields + 自填第 1 步顶部，同一列）

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 企业名称 | `name` | enterprises.name | 全文的企业名（context.ts:220 companyName），封面、正文、各附件 | 专家必需事实，列表页 | 必需 | gen/plan/context.ts:220；shared/workup.ts workupFacts |
| 统一社会信用代码 | `socialCreditCode` | enterprises 列 | 附件1 概况段落；报告概况 | 专家必需事实 | 必需 | gen/plan/attachments.ts:84；gen/reports/common.ts:15 |
| 法定代表人 | `legalRepresentative` | enterprises 列 | 附件1 概况段落；批准发布令的签发人（assemble.ts:385）；培训计划负责人缺省时用它（attachments.ts:523） | 专家必需事实；送 AI 前的姓名脱敏（editing.service.ts:398） | 必需 | gen/plan/assemble.ts:385；attachments.ts:84、523 |
| 注册地址 | `registeredAddress` | enterprises 列 | 综合预案 1.1 适用范围（comprehensive.ts:59）；附件1、报告概况的地址 | 专家必需事实；未填生产地址时用它代替 | 必需 | gen/plan/comprehensive.ts:59 |

## 2. 新建任务

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 任务名称 | `name` | tasks.name | 未用（文档标题用企业名） | 客户、专家、运营的任务列表 | 有用 | tasks.service.ts 创建；各列表页 |
| 业务类型 | `businessType` | tasks | 决定生成哪套文档（只读，客户不能选） | — | 不是客户输入 | — |

## 3. 自填第 1 步：基本信息

### 3.1 基本信息卡（开始填写必填：联系人、联系电话、从业人数、主要产品）

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 联系人 | `contactPerson` | profile.basicStep | 附件1 表 1-1；报告基本情况表 | 专家必需事实；专家联系对话框；上门服务默认联系人（tasks.service.ts:386）；脱敏 | 必需 | attachments.ts:89-109；common.ts:22；shared/profile/basic-step.ts BASIC_INFO_START_FIELDS |
| 联系电话 | `contactPhone` | profile.basicStep | 附件1 表 1-1；报告基本情况表 | 同上 | 必需 | 同上 |
| 从业人数 | `employeeCount` | profile.basicStep | 附件1 概况段落；附件8、9 培训和演练人数（attachments.ts:437、537） | 专家必需事实 | 必需 | attachments.ts:84、437、537 |
| 主要产品 | `mainProducts` | profile.basicStep | 附件1 概况段落；危险信号识别（signals.ts:175） | 专家必需事实 | 必需 | attachments.ts:84；gen/plan/signals.ts:175 |
| 技术管理人数 | `technicalManagementCount` | profile.basicStep | 附件1 概况段落；风险报告「管理现状」（risk.ts:146-160） | 专家必需事实 | 必需 | gen/reports/risk.ts:146-160 |
| 安全管理人数 | `safetyManagementCount` | profile.basicStep | 同上 | 专家事实面板 | 必需 | 同上 |
| 主要负责人 | `responsiblePerson` | profile.basicStep | 表 1-1（缺了显示「—」）；附件9 培训负责人（缺了用法定代表人） | 专家事实面板；脱敏 | 必需（缺了只显示「—」） | attachments.ts:89-109、523 |
| 企业类型 | `companyType` | profile.basicStep | 表 1-1（缺了显示「—」） | 专家事实面板（workup.ts basicEntries） | 必需（缺了只显示「—」） | attachments.ts:89-109；shared/workup.ts:196-223 |
| 注册资本 | `registeredCapital` | profile.basicStep | 附件1 概况段落；报告概况 | 专家事实面板不显示 | 必需（缺了这句话会不完整） | attachments.ts:84；common.ts:15 |
| 经营范围 | `businessScope` | profile.basicStep | 综合预案 1.1（comprehensive.ts:59）；附件1 概况段落；工艺模板推荐 | 专家事实面板不显示 | 必需 | comprehensive.ts:59；attachments.ts:84 |
| 所属行业 | `industry` | profile.basicStep（basicOf 不传给生成） | 未用 | 专家事实面板（workup.ts:192）；第 5 步汇总行（review-step.ts:85）；企业详情页（EnterpriseDetailPage.tsx:67） | 有用 | shared/workup-plan.ts:54 basicOf 解构时去掉 |
| 占地面积 | `landAreaM2` | profile.basicStep | 未用（workup-plan.ts:70 传给了生成，但没有代码读） | 专家事实面板（workup.ts:222）；第 5 步「稍后补」标签（review-step.ts:39） | 有用（生成没用到） | shared/workup-plan.ts:70；gen/ 下没有读取 |

### 3.2 「其他工商与经营信息」卡

这一组只出现在表 1-1 和报告基本情况表的格子里。缺了用 `dash()` 显示「—」，正文不受影响。专家事实面板也不显示这几个字段（workup.ts:196-223）。

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 登记机关 | `registrationAuthority` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | attachments.ts:89-109；common.ts:22 |
| 邮政编码 | `postalCode` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |
| 传真 | `fax` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |
| 网址 | `website` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |
| 电子邮箱 | `email` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |
| 经济性质 | `economicNature` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |
| 固定资产 | `fixedAssets` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |
| 上年销售收入 | `lastYearRevenue` | profile.basicStep | 表 1-1 格子 | 无 | 必需（缺了只显示「—」） | 同上 |

### 3.3 地址与园区

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 生产经营地址 | `siteAddress` | profile.basicStep | 正文的地址；未填时用注册地址 | 专家事实面板 | 必需 | gen/plan/context.ts:204-247；workup.ts basicEntries |
| 其他厂区地址 | `otherAddresses[]` | profile.basicStep | 设备、物资、物料、救援小组的 `addressId` 关联到这里；正文的多厂区说明 | 专家事实面板 | 有用（待确认：多厂区正文是否完整输出各地址，只看到 context 里汇总） | context.ts:204-247 |
| 是否在园区 | `inPark` | profile.basicStep | 决定附件8、外部联络表是否列出园区 | 专家事实面板（agencyEntries） | 必需（间接） | attachments.ts:282；resource.ts:99、118 |
| 园区管委会名称 | `parkManager` | profile.basicStep | 外部联络表（attachments.ts:282，resource.ts:99、118）；附件8 | 专家事实面板 | 必需 | 同上 |
| 园区值班电话 | `parkDutyPhone` | profile.basicStep | 同上 | 专家事实面板 | 必需 | 同上 |
| 营业执照 | `licenseFileId` | profile.basicStep + 资料清单 | 未用 | 专家原件面板；用于识别后自动填身份字段 | 有用 | workup.service.ts profilePhotos 附近 |
| 稍后补 / 来源标记 | `later[]`、`sources{}` | profile.basicStep | 未用 | 第 5 步汇总；专家事实面板的来源标记 | 有用 | review-step.ts:39 |

## 4. 自填第 2 步：应急组织

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 填写方式（表单/名单） | `mode` | profile.organizationStep | 未用 | 只有客户页面读 | 没人用（只用于切换界面） | web/…/OrganizationStepPage |
| 总指挥姓名、职务、电话 | `commander.{name,position,phone}` | profile.organizationStep | 组织机构图；综合预案职责（comprehensive.ts:85 用职务）；附件5 通讯录 | 专家必需事实 | 必需 | gen/plan/comprehensive.ts:85；attachments.ts 附件5 |
| 副总指挥 | `deputies[]` | profile.organizationStep | 同上；缺了显示「（待补充）」 | 专家事实面板 | 必需 | comprehensive.ts:85 附近 |
| 救援小组（类型、名称、组长、成员、地址） | `groups[].{kind,name,leader,members,addressId}` | profile.organizationStep | 组织机构图；附件5；资源报告成员表（缺电话显示「（待补充）」）；后勤组长电话（comprehensive.ts:362）；通讯组长电话（resource.ts:94） | 专家事实面板 | 必需 | comprehensive.ts:362；gen/reports/resource.ts:94 |
| 24 小时值班电话 | `dutyPhone` | profile.organizationStep | 正文报警电话；附件5 | 专家必需事实 | 必需 | 同上 |
| 厂内广播 | `paSystem` | profile.organizationStep | 通讯手段描述（planFacts） | 专家事实面板 | 必需（间接） | context.ts planFacts |
| 应急工作群 | `imGroup` | profile.organizationStep | 同上 | 专家事实面板 | 必需（间接） | 同上 |
| 编制组补充成员姓名、职责 | `compilationExtras[].{name,duty}` | profile.organizationStep | 编制组成员表（assemble.ts:168） | 专家只读 | 必需 | gen/plan/assemble.ts:168 |
| 编制组补充成员职务 | `compilationExtras[].title` | profile.organizationStep | 表格有职务列，但页面上没有这个输入框 | — | 没人用（这一项客户填不了；待确认是否应该补输入框） | OrganizationStepPage 只有姓名和职责两个输入框 |
| 名单文件 | `rosterFileIds` | profile.organizationStep | 未用 | 专家原件面板 | 有用 | workup.service.ts:63-73 |
| 是否有应急办公室 | （客户没有这个字段） | — | `organizationFrom` 写死为 false，只能由专家改 | — | 见第 12 节 | shared/workup-plan.ts organizationFrom |

## 5. 自填第 3 步第 1 页：生产场所、特种设备、设备、物料、业务问题

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 场所勾选（空压机房、锅炉房、有限空间、喷涂等） | `sites[]` | profile.productionStep | 判断适用范围：空压机房和锅炉房对应压力容器预案，有限空间和喷涂对应有限空间预案；危险源建议和场所选项（workup-risk.ts:208、253、300） | 第 4 步按场所预选物资和建筑 | 必需（间接） | gen/plan/scope.ts；shared/workup-risk.ts:208、253、300 |
| 自定义场所 | `customSites[]` | profile.productionStep | 未用 | 只有客户页面和第 5 步的数量统计 | 没人用 | gen/ 和 workup 下没有读取 |
| 特种设备有/无（压力容器、锅炉、压力管道、储罐） | `specialEquipment.*.answer` | profile.productionStep | 危险信号和适用范围判断 | 专家事实面板 | 必需（间接） | shared/workup-production.ts:404-466；scope.ts |
| 压力容器介质、最高工作压力、容积 | `pressure_vessel.items[].{medium,maxWorkingPressureMPa,volumeM3}` | profile.productionStep | 未用（planProductionOf 传了，但生成没读） | 专家事实面板 | 有用（生成没用到） | workup-production.ts:404-466 |
| 锅炉类型 | `boiler.items[].type` | profile.productionStep | 蒸汽或热水锅炉对应压力管道适用范围（scope.ts:113）；导热油锅炉在传递时被丢掉 | 专家事实面板 | 必需（间接） | gen/plan/scope.ts:113；workup-production.ts |
| 锅炉额定参数 | `boiler.items[].ratedParams` | profile.productionStep | 未用（传递时被丢掉） | 专家事实面板 | 有用 | workup-production.ts:404-466 |
| 压力管道介质 | `pipeline.items[].medium` | profile.productionStep | 未用（传递时被丢掉） | 专家事实面板 | 有用 | 同上 |
| 压力管道公称直径 | `pipeline.items[].nominalDiameter` | profile.productionStep | 未用（传了但没读） | 专家事实面板 | 有用 | 同上 |
| 储罐储存物质 | `tank.items[].substance` | profile.productionStep | 燃气储罐的危险信号（signals.ts:182） | 专家事实面板 | 必需（间接） | gen/plan/signals.ts:182 |
| 储罐容量 | `tank.items[].capacity` | profile.productionStep | 未用 | 专家事实面板 | 有用 | workup-production.ts |
| 特种设备铭牌照片 | `specialEquipment.*.photoFileIds` | profile.productionStep | 未用 | 专家原件面板 | 有用 | workup.service.ts:63-73 |
| 设备名称、规格、数量 | `equipment[].{name,spec,quantity}` | profile.productionStep | 表 1-2（attachments.ts:118，risk.ts:314）；电梯和锅炉占位符；数量用 leadingInt 取开头的数字 | 专家事实面板 | 必需 | attachments.ts:118；gen/reports/risk.ts:314 |
| 使用部门 / 地点 | `equipment[].location` | profile.productionStep | 一个输入同时填进 `department` 和 `location` 两列 | 专家事实面板 | 必需（一个值占两列，见第 11 节） | workup-production.ts:404-466 |
| 设备状况 | `equipment[].condition` | profile.productionStep | 待确认（表 1-2 是否有「状况」列没逐列核对） | 专家事实面板 | 待确认 | — |
| 设备所在厂区 | `equipment[].addressId` | profile.productionStep | 多厂区归属 | 专家 | 有用 | — |
| 物料类别 | `materials[].kind` | profile.productionStep | 适用范围（危化品超过 1 吨、易燃液体） | 专家 | 必需（间接） | scope.ts |
| 物料名称 | `materials[].name` | profile.productionStep | 表 1-3（attachments.ts:128，risk.ts:324）；对应 MSDS | 专家 | 必需 | attachments.ts:128；risk.ts:324 |
| CAS 号 | `materials[].casNumber` | profile.productionStep | 表 1-3 | 专家 | 必需 | 同上 |
| 气瓶规格 | `materials[].cylinderSpec` | profile.productionStep | 压力容器适用范围；表 1-3 | 专家 | 必需（间接） | scope.ts |
| 年用量、最大储存量 | `materials[].{annualUsage,maxStorage}` | profile.productionStep | 表 1-3；用 parseTons 换算成吨后判断是否超过 1 吨 | 专家 | 必需 | workup-production.ts parseTons |
| 储存地点 | `materials[].storageLocation` | profile.productionStep | 表 1-3 | 专家 | 必需 | attachments.ts:128 |
| 标签照片 | `materials[].labelPhotoFileIds` | profile.productionStep | 未用 | 专家原件面板 | 有用 | workup.service.ts:63-73 |
| 台账文件 | `ledgers` | profile.productionStep + 资料清单 | 未用 | 专家原件面板，挂在资料清单项上 | 有用 | — |
| 是否租用厂房 | `leasesPremises` | profile.productionStep | 出租方适用范围规则 | 提交时的回答（submission.service.ts:177） | 必需（间接） | scope.ts；submission.service.ts:177 |
| 是否有自有车辆 | `ownVehicles` | profile.productionStep | hasVehicle，对应道路运输适用范围 | 专家 | 必需（间接） | scope.ts |

## 6. 自填第 3 步第 2 页：工艺流程

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 工艺来源、模板 ID、模板名 | `process.{source,templateId,templateLabel}` | profile.productionStep | 未用 | 专家图表显示「来自 X 模板」（workup-figures.ts:189） | 有用 | shared/workup-figures.ts:189 |
| 工艺描述 | `process.description` | profile.productionStep | 附件1 工艺说明（attachments.ts:110）；风险报告（risk.ts:306） | 专家 | 必需 | attachments.ts:110；risk.ts:306 |
| 工艺步骤名称 | `process.steps[].name` | profile.productionStep | 工艺流程图 | 专家 | 必需 | workup-production.ts:404-466 |
| 每步用到的设备 | `process.steps[].equipment` | profile.productionStep | 未用（传递时变成 `[]`） | 只有客户端的 `checkProcessEquipment` 校验会读（ProcessStepPage.tsx:408） | 没人用（后面没有地方读） | workup-production.ts；web/…/ProcessStepPage.tsx:408 |
| 工艺流程草图 | `process.sketchFileIds` | profile.productionStep | 未用 | 专家原件面板 | 有用 | — |

## 7. 自填第 4 步：应急资源

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 物资名称、单位 | `supplies[].{catalogKey,name,unit}` | profile.resourcesStep | 附件4（attachments.ts:223-262）；资源报告表 1.4-2；名称还决定广播、对讲机等通讯手段的描述 | 专家 | 必需 | attachments.ts:223-262 |
| 物资数量、存放位置 | `supplies[].{quantity,location}` | profile.resourcesStep | 同上，缺了显示「（待补充）」 | 专家 | 必需 | 同上 |
| 物资所在厂区 | `supplies[].addressId` | profile.resourcesStep | 多厂区归属 | 专家 | 有用 | — |
| 物资保管人 | `custodianId` | profile.resourcesStep | 附件4 和资源报告里的保管人姓名、电话（从组织成员里取） | 专家 | 必需 | attachments.ts:223-262 |
| 物资台账 | `supplyLedgerFileIds` | profile.resourcesStep | 未用 | 专家原件面板 | 有用 | — |
| 急救箱有/无、物品清单 | `firstAidKit.{answer,items[]}` | profile.resourcesStep | 附件4；资源报告 | 专家 | 必需 | attachments.ts:223-262 |
| 急救箱填写方式 | `firstAidKit.mode` | profile.resourcesStep | 未用 | 只有客户页面读 | 没人用 | — |
| 急救箱照片 | `firstAidKit.photoFileIds` | profile.resourcesStep | 未用 | 专家原件面板 | 有用 | workup.service.ts:63-73 |
| 消防水池有/无、容积 | `firePool.{answer,volumeM3}` | profile.resourcesStep | 附件1（attachments.ts:65）；附件8（attachments.ts:442） | 专家 | 必需 | attachments.ts:65、442 |
| 消防水池数量 | `firePool.count` | profile.resourcesStep | 未用 | 专家生产面板（ProductionPanel.tsx:951） | 有用 | web/…/ProductionPanel.tsx:951 |
| 容积稍后补 | `firePool.volumeLater` | profile.resourcesStep | 未用 | 只有客户页面读 | 没人用 | — |
| 建筑名称、面积 | `buildings[].{name,areaM2}` | profile.resourcesStep | 表 1-4；风险报告（risk.ts:333）；总建筑面积由这些算出 | 专家 | 必需 | risk.ts:333 |
| 耐火等级 | `buildings[].fireRating` | profile.resourcesStep | 表 1-4 的「耐火等级」列 | 专家事实面板 | 必需 | — |
| 层数 | `buildings[].floors` | profile.resourcesStep | 表 1-4；判断高层建筑适用范围 | 专家 | 必需 | scope.ts |
| 消防验收文件 | `fireAcceptanceFileIds` | profile.resourcesStep | 未用 | 专家原件面板 | 有用 | workup.service.ts:63-73 |
| MSDS（按物料） | `msds[material].{fileIds,later}` | profile.resourcesStep + 资料清单 | 未用（正文没有引用 MSDS 的内容） | 专家原件面板；资料清单的状态 | 有用（待确认：专家是否拿它填理化性质，交付稿里只引用物料名） | — |
| 总平面布置图、疏散路线图、消防设施布置图 | `drawings.{site_plan,evacuation_plan,fire_facility_plan}` | profile.resourcesStep + 资料清单 | 附件7 关键图纸（attachments.ts:366-398），缺了显示「（待补充）：由企业提供后纳入正式文本」 | 专家 | 必需 | attachments.ts:375、395 |
| 周边企业有/无、名称 | `neighbors.{answer,items[].name}` | profile.resourcesStep | 附件1 周边说明；附件8 | 专家事实面板 | 必需 | attachments.ts 附件1 和附件8 |
| 周边企业联系方式 | `neighbors.items[].contact` | profile.resourcesStep | 附件8 表格 | 专家 | 必需 | 同上 |
| 救援协议 | `rescueAgreement` | profile.resourcesStep | planFacts；附件8；资源报告 | 专家事实面板（agencyEntries） | 必需 | context.ts:204-247 |
| 互助协议 | `mutualAid` | profile.resourcesStep | 同上 | 同上 | 必需 | 同上 |
| 紧急集合点 | `assemblyPoint` | profile.resourcesStep | 集合点占位符；附件8 | 专家事实面板 | 必需 | 同上 |

## 8. 自填第 5 步：核对与确认

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 确认无误勾选 | 确认复选框 | 只控制前端提交按钮 | 未用 | — | 只是交互，不算字段 | ReviewStepPage |

## 9. 资料核对页（资料清单 19 项）和抽屉

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 资料状态（已传、没有、稍后补等） | `status` | checklist_items | 间接：保存企业资料时同步状态（profile.controller.ts write/syncItem） | 专家任务（expert-tasks.service.ts 读 status）；运营进度 | 有用 | profile.controller.ts；expert-tasks.service.ts |
| 上传的文件 | `fileIds` | checklist_items | 图纸进入附件7；其他文件不进正文 | 专家原件面板 | 有用（图纸属于必需） | — |
| 请专家打电话 | `callRequested` | checklist_items | 未用 | 专家任务列表 | 有用 | expert-tasks.service.ts |
| 「没有文件？直接告诉我们」的说明 | `note` | checklist_items.note | 未用 | 只写进提交时的回答（submission.service.ts:168）和客户自己的提交后页面（SubmittedView）。expert-tasks.service.ts 不查 note，专家和运营页面也都不读 `answers` | 没人用（专家看不到；待确认是否有别的导出路径，代码里没找到） | web/…/CheckDrawer.tsx:319-338；submission.service.ts:168 |
| 特殊卡片：周边企业、MSDS、业务问题 | NeighborsCard、MsdsCard、BusinessQuestions | 和第 3、4 步写到同一批 profile 字段 | 同第 5、7 节 | 同第 5、7 节 | 和第 3、4 步重复 | web/…/SpecialCards |

## 10. 其他客户输入

| 字段中文名 | 代码字段名 | 存储位置 | 生成里被谁用 | 其他读取方 | 结论 | 依据 |
|---|---|---|---|---|---|---|
| 补充资料回复（文件、说明） | `fileIds`、`note` | 补充资料请求表 | 未用 | 专家 SupplementView | 有用 | — |
| 回答专家提问（文字、文件） | `text`、`fileIds` | 联系记录 | 未用 | 专家 | 有用 | — |
| 上门服务：联系人、电话、方便的时间、需要帮忙的事项、备注 | `contactName`、`contactPhone`、`callTime`、`helpItems`、`note` | 上门服务单 | 未用 | 运营 OnSiteOrders.tsx:139-140；默认值取自基本信息（tasks.service.ts:386） | 有用 | web/…/OnSiteOrders.tsx:139-140 |
| 机构联系人、电话、邮箱 | `orgProfile.{contactName,contactPhone,contactEmail}` | organizations | 未用 | 运营的机构页面 | 有用 | — |
| 邀请成员（姓名、邮箱、角色、负责的企业） | invites | 成员表 | 未用 | 权限 | 有用（属于账号功能） | — |
| 意见反馈 | feedback | feedback 表 | 未用 | 运营 | 有用 | — |
| 企业资料库 | 企业文档 | documents 表 | 未用 | 客户自己查看和下载 | 有用（属于存档） | — |

---

## 11. 重复与可合并

1. **注册地址和生产经营地址**（第 1 步）：生产地址没填时直接用注册地址。改成一个地址框，加一个「生产地址不同」的勾选，就不用填两遍。
2. **联系人和电话出现了四处**：基本信息的 `contactPerson`/`contactPhone`、机构资料的 `orgProfile.contactName`/`contactPhone`、上门服务单里的联系人（本来就从基本信息带出）、总指挥电话和 24 小时值班电话。小企业的这几个人通常是同一个人。可以只保留基本信息联系人和值班电话，其他地方默认带出，需要时再改。
3. **主要负责人、法定代表人、总指挥**：生成时负责人缺了用法定代表人，总指挥多半也是这个人。可以在第 2 步填总指挥时默认选「同主要负责人」，或者把主要负责人收进身份区，默认等于法定代表人。
4. **救援协议、互助协议、周边企业被问了两遍**：第 4 步问一次，资料核对页的 NeighborsCard 和 BusinessQuestions 又问一次（写的是同一批字段）。园区信息也和第 1 步分开放。建议只在一处问，另一处只显示状态。
5. **资料核对页的「直接告诉我们」说明和自填路径**：同一项资料，客户可以在核对页写一段说明，也可以去自填步骤填结构化内容。说明写进 `checklist_items.note` 以后专家看不到。要么把说明显示到专家原件面板或任务里，要么去掉这个框，引导客户去对应的自填步骤。
6. **「使用部门 / 地点」一个输入占两列**：表 1-2 里的部门和地点两列内容总是一样。要么把列合并，要么拆成两个输入。
7. **总建筑面积和单栋面积**：总面积由各栋相加，不要再单独让客户填（目前 `landAreaM2` 是占地面积，概念不同，但生成也没用到，见第 3.1 节）。
8. **安全管理人数和成员职务**：成员职务里带「安全」的人数可以推算出安全管理人数，可以考虑自动预填。
9. **企业名称在新建页和第 1 步各出现一次**：存的是同一列，第 1 步只需要显示，不用再让客户填。
10. **特种设备参数和铭牌照片**：参数生成几乎不用（见第 5 节），专家看照片就能读到。可以只留「有/无」加照片。

## 12. 交付稿需要但客户界面没有入口的字段

| 交付稿位置 | 需要的内容 | 现在的情况 | 依据 |
|---|---|---|---|
| 综合预案「应急保障」；附件8、9 | 培训和演练经费 `facts.training.budget` | factsOf 只设置了 department，客户和专家都没有输入框，所以一直显示「（待补充）」 | shared/workup-plan.ts:191；comprehensive.ts:364；attachments.ts:453、526 |
| 附件1；报告位置描述 | 周边环境 `surroundings` | 只有专家能填；没填就是「（待补充）」 | 专家事实面板 |
| 组织机构 | 是否设应急办公室 `hasEmergencyOffice` | `organizationFrom` 写死为 false，只能由专家改 | shared/workup-plan.ts organizationFrom |
| 附件8 外部联络 | 周边企业电话 | 客户只有一个笼统的「联系方式」，没有单独的电话 | resourcesStep neighbors |
| 外部联络 | 就近医院、医院距离 `hospital.distanceKm` | 医院只能由专家填；距离没有任何输入，一直显示「/」 | — |
| 表 1-4 | 建筑结构、备注 | 没有输入框，一直显示「—」 | risk.ts:333 附近 |
| 附件4 | 物资型号 `supply.model` | 没有输入框，一直显示「/」 | attachments.ts:223-262 |
| 工艺流程图 | 每步的输入和下一步 `inputs`、`next` | 一直为空 | workup-production.ts |
| 响应分级 | `responseGrading` | 一直用通用表述 | — |
| 附件1 | 成立日期、上级单位、企业简称、培训部门 | 只有专家能填 | workup.ts judgementEntries |
| 外部联络 | 应急、消防、医疗等机构电话 | 来自知识库，不需要客户提供 | — |

## 13. 和业主 17 类资料清单对照

营业执照、MSDS、三张图纸、特种设备参数、工艺流程、设备清单、原辅材料（CAS 号、气瓶规格、储存地点）、建筑（耐火等级、层数、面积）、企业基本信息、应急组织、小组成员、24 小时值班电话、物资和保管人电话、外部队伍和周边企业、急救箱、消防水池容积、编制组，这些在界面上都有入口（资料清单 19 项）。

- **清单要了但生成基本没用的**：特种设备的具体参数（只用「有/无」和锅炉类型）；MSDS（只在原件面板供专家查看）；营业执照（只用于识别后自动填身份字段）。
- **清单没要但交付稿需要的**：见第 12 节，尤其是培训经费、周边环境、医院距离、周边企业电话。

## 14. 数量统计（按行计）

- 必需：49 项。其中 8 项缺了只显示「—」（第 3.2 节的 8 项；主要负责人、企业类型另计在内是 10 项）。另有 10 项是间接影响适用范围或危险信号。
- 有用：31 项。
- 没人用：7 项。它们是自定义场所、编制组成员职务、每步设备、急救箱填写方式、容积稍后补、组织填写方式，以及专家看不到的资料清单说明（标为待确认）。
- 待确认：4 项。它们是多厂区地址的正文输出、设备状况列、MSDS 用途，以及资料清单说明是否另有读取方。
