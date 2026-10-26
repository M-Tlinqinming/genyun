import type { ThemeConfig } from 'antd';
import { fontFamily, gy } from './tokens';

// Ant Design 6 默认算法为底座，下列数值按设计系统 v1.1 显式覆盖；未列出的派生值继承组件库。
export const theme: ThemeConfig = {
  token: {
    colorPrimary: gy.primary,
    colorInfo: gy.primary,
    colorSuccess: gy.success,
    colorWarning: gy.warning,
    colorError: gy.error,
    colorSuccessBg: gy.successBg,
    colorWarningBg: gy.warningBg,
    colorErrorBg: gy.errorBg,
    colorInfoBg: gy.selected,

    colorText: gy.text,
    colorTextHeading: gy.text,
    colorTextSecondary: gy.secondary,
    colorTextTertiary: gy.tertiary,
    colorTextDescription: gy.secondary,

    colorBgLayout: gy.canvas,
    colorBgContainer: gy.surface,
    colorBgMask: gy.mask,
    colorSplit: gy.split,
    colorBorder: gy.border,
    colorBorderSecondary: gy.split,

    fontFamily,
    fontSize: 14,
    lineHeight: 22 / 14,
    fontWeightStrong: 500,

    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    motionDurationFast: '0.1s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.3s',
  },
  components: {
    Layout: {
      headerHeight: 64,
      headerBg: gy.surface,
      headerPadding: '0 32px',
      siderBg: gy.surface,
      bodyBg: gy.canvas,
    },
    Menu: {
      itemSelectedBg: gy.selected,
      itemSelectedColor: gy.primary,
      itemColor: gy.text,
      itemHeight: 40,
      itemBorderRadius: 8,
      itemMarginInline: 4,
      iconSize: 14,
      groupTitleColor: gy.tertiary,
      groupTitleFontSize: 12,
      activeBarBorderWidth: 0,
    },
    Typography: {
      titleMarginBottom: 0,
      titleMarginTop: 0,
    },
  },
};
