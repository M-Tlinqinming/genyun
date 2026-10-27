import { expect, test, type Page } from '@playwright/test';

// 用例共用一个演示数据库，按顺序跑：先建「飞宇」，再查看、修改。
// 只登录一次、共用同一个页面：后台每分钟限 10 次登录，整套测试加起来会超过
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('请输入邮箱').fill('admin@demo.genyun.net.cn');
  await page.getByPlaceholder('请输入密码').fill('e2e-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/customer$/);
});

test.afterAll(async () => {
  await page.close();
});

test('还没有企业时，列表提示先建立企业档案', async () => {
  await page.getByRole('menuitem', { name: '企业' }).click();
  await expect(page.getByRole('heading', { name: '企业', exact: true })).toBeVisible();
  await expect(page.getByText('还没有企业')).toBeVisible();
});

test('新建「飞宇」，在列表看到并进入详情', async () => {
  await page.goto('/customer/enterprises');
  await page.getByRole('button', { name: '新建企业' }).first().click();
  await expect(page.getByRole('heading', { name: '建立企业档案' })).toBeVisible();

  // 企业名称必填；信用代码格式不对时不保存
  await page.getByRole('button', { name: '保存企业档案' }).click();
  await expect(page.getByText('请填写企业名称')).toBeVisible();
  await page.getByLabel('企业名称').fill('惠阳飞宇电器有限公司');
  await page.getByLabel('统一社会信用代码').fill('12345');
  await page.getByRole('button', { name: '保存企业档案' }).click();
  await expect(page.getByText('统一社会信用代码应为 18 位数字或字母')).toBeVisible();

  await page.getByLabel('统一社会信用代码').fill('91441300726483224B');
  await page.getByLabel('法定代表人').fill('李文聪');
  await page.getByRole('button', { name: '保存企业档案' }).click();

  await expect(page).toHaveURL(/\/customer\/enterprises\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
  await expect(page.getByText('91441300726483224B')).toBeVisible();
  await expect(page.getByText('李文聪')).toBeVisible();

  await page.getByRole('link', { name: '企业', exact: true }).click();
  await expect(page.getByRole('cell', { name: /惠阳飞宇电器有限公司/ })).toBeVisible();
  await expect(page.getByText('共 1 家企业')).toBeVisible();
  await page.getByRole('link', { name: '查看企业 →' }).click();
  await expect(page.getByRole('heading', { name: '惠阳飞宇电器有限公司' })).toBeVisible();
});

test('同一机构内信用代码重复时提示，不新建', async () => {
  await page.goto('/customer/enterprises/new');
  await page.getByLabel('企业名称').fill('另一家公司');
  await page.getByLabel('统一社会信用代码').fill('91441300726483224B');
  await page.getByRole('button', { name: '保存企业档案' }).click();
  await expect(page.getByText('本组织已有使用该统一社会信用代码的企业')).toBeVisible();
  await expect(page).toHaveURL(/\/new$/);
});

test('在详情页补填注册地址，列表同步显示', async () => {
  await page.goto('/customer/enterprises');
  await page.getByRole('link', { name: '查看企业 →' }).click();
  await page.getByRole('button', { name: '编辑企业信息' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑企业信息' });
  await dialog.getByLabel('注册地址').fill('惠州市仲恺高新区陈江街道正大路 17 号');
  await dialog.getByRole('button', { name: /保\s*存/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('惠州市仲恺高新区陈江街道正大路 17 号').first()).toBeVisible();

  await page.goto('/customer/enterprises');
  await expect(page.getByText('惠州市仲恺高新区陈江街道正大路 17 号')).toBeVisible();
});

test('搜索不到时提示没有符合条件的企业', async () => {
  await page.goto('/customer/enterprises');
  await page.getByPlaceholder('搜索企业名称 / 统一社会信用代码').fill('不存在的公司');
  await expect(page.getByText('没有符合条件的企业')).toBeVisible();
  await page.getByPlaceholder('搜索企业名称 / 统一社会信用代码').fill('9144130072');
  await expect(page.getByRole('cell', { name: /惠阳飞宇电器有限公司/ })).toBeVisible();
});
