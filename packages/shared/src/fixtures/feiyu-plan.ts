// 飞宇生成应急预案的样例输入：客户资料用 feiyu.ts，专家的判断与补充迁自旧仓库 fixtures/feiyu.ts
// （企业简称、成立日期、隶属关系、周边环境、就近医院、响应分级、培训计划、22 项危险源 LEC 取值）。
// 专家页面（M2 第 4–8 项）做好之前，测试和样例文档都用这一份。
import { localAgenciesOf } from '../plan/agencies.ts';
import type { PlanInput } from '../plan/input.ts';
import { feiyuBasicInfo, feiyuLocation, feiyuOrganization, feiyuProduction } from './feiyu.ts';

const hazard = (workplace: string, factor: string, l: number, e: number, c: number) => ({ workplace, factor, l, e, c });

export const feiyuPlanInput: PlanInput = {
  basic: feiyuBasicInfo,
  location: feiyuLocation,
  organization: { ...feiyuOrganization, dutyPhone: '0752-3324567' },
  production: feiyuProduction,
  business: { sites: ['workshop', 'warehouse', 'power_room', 'compressor_room'], leasesPremises: false, ownVehicles: false },
  agencies: localAgenciesOf(feiyuLocation.siteAddress),
  issuedOn: '2026-04-11',
  expert: {
    hazardousMaterials: ['酒精'],
    // 跌落、淹溺系统不再默认打开（资料里没有楼梯、平台的记载；消防水池多在地下或加盖）；
    // 飞宇专家成稿两份方案都有，按专家确认打开
    scope: { fallRisk: true, waterHazard: true },
    facts: {
      shortName: 'FY',
      establishedDate: '2001-01-03',
      superior: '独立法人，无国内上级集团公司；接受惠州市仲恺高新区应急管理局、陈江街道应急办的属地安全监管。',
      surroundings:
        '厂区位于陈江街道工业园区内，周边 500 米范围内经现场踏勘：东侧为正大路市政道路；南侧为相邻五金加工厂；西侧为村道与农田；北侧为同园区电子组装厂。周边 1 公里范围内无构成《危险化学品重大危险源辨识》（GB 18218-2018）阈值的重大危险源，无加油站，无油库，无危险化学品储存仓库。最近加油站（中石化陈江加油站）距厂区约 1.8 公里，不在事故影响半径内。',
      hospital: {
        name: '惠州市第三人民医院（陈江院区）',
        distanceKm: 3.2,
        route:
          '厂区大门 → 正大路向北 → 陈江大道东行 → 惠风四路 → 惠州市第三人民医院陈江院区急诊入口（预计行车 8 分钟）。备用院区：陈江街道社区卫生服务中心（约 1.2 km，处理轻伤），距厂区大门向西 1.2 km。',
      },
      responseGrading: {
        level1:
          '事故影响波及厂区外、危及周边五金加工厂或电子组装厂等相邻企业及村道居民，或引发跨区域社会影响；或 1 号厂房发生整体性结构破坏 / 大面积坍塌；或大量危险化学品（酒精）泄漏并扩散出厂界；本企业及属地救援力量均无法控制。',
        level2:
          '事故超出本企业全员应急处置能力，需惠州市仲恺高新区组织专业救援力量（消防特勤、危化品处置、医疗急救等）增援方可控制；典型如压铸熔融金属大面积喷溅引发连片火灾、配电室火灾导致全厂停电且自有消防力量无法压制、多人重伤危及厂区相邻建筑。',
        level3:
          '事故无法由单一班组 / 现场处置力量控制，需公司总指挥启动综合应急预案、集结抢险救援 / 综合保障 / 通讯联络等全部应急小组协同处置，但凭企业自身应急资源（消防器材、应急物资、应急队伍）可控制；典型如单一车间火灾、压铸机液态金属泄漏伴人员受伤、烘干工序粉尘异常需全厂停产排查。',
        level4:
          '事故局限于单一工位、单台设备或单一作业点，事发岗位与班组依据对应现场处置方案先期处置、配合就近应急小组即可在数分钟内控制，无需启动全公司响应；典型如初期火情（1-2 具灭火器可灭）、轻微机械夹伤、小范围酒精泼洒、单台设备触电跳闸。',
      },
      training: {
        budget: '3.5 万元（列入公司年度安全生产专项费用预算）',
        department: '安全管理部（王秀英 安全总监总抓，日常由专职安全员组织实施；人力资源部配合负责签到、考核记录、档案归档）',
      },
    },
    hazards: [
      hazard('厂房一', '火灾', 1, 6, 7),
      hazard('厂房一', '触电', 1, 6, 7),
      hazard('厂房一', '物体打击', 1, 3, 7),
      hazard('厂房一', '机械致害', 1, 3, 7),
      hazard('厂房一', '灼烫', 1, 6, 3),
      hazard('空压机房', '容器爆炸', 0.5, 3, 7),
      hazard('厂房一', '高处坠落', 0.5, 3, 7),
      hazard('厂房一', '起重致害', 0.5, 3, 7),
      hazard('消防水池', '淹溺', 0.5, 3, 7),
      hazard('停车场/厂道', '厂（场）内车辆致害', 0.5, 6, 7),
      hazard('厂房一', '可燃液体蒸气爆炸', 0.5, 3, 7),
      hazard('厂房一', '跌落', 0.5, 3, 7),
      hazard('厂房一', '中毒', 0.5, 3, 7),
      hazard('厂房一', '坍塌', 0.5, 3, 7),
      hazard('厂房一', '粉尘爆炸', 0.5, 3, 7),
      hazard('厂房一', '高温熔融物爆炸', 0.5, 3, 7),
      hazard('厂房一', '泄漏', 1, 3, 7),
      hazard('厂房一', '窒息', 0.5, 3, 7),
      hazard('厂房一', '可燃气体爆炸', 0.5, 3, 7),
      hazard('消防水池', '淹溺（二）', 1, 3, 3),
      hazard('停车场/厂道', '道路（轨道）车辆致害', 0.5, 6, 7),
      hazard('厂房一', '其他伤害', 1, 6, 3),
    ],
  },
};
