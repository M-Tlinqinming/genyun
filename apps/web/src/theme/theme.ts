import type { ThemeConfig } from 'antd';
import { fontFamily, gy } from './tokens';

// Ant Design 6 默认算法为底座，下列数值按设计系统 v1.1 显式覆盖；未列出的派生值继承组件库。
export const theme: ThemeConfig = {
  token: {
    colorPrimary: gy.primary,
    colorPrimaryHover: gy.hover,
    colorPrimaryActive: gy.active,
    colorInfo: gy.primary,
    colorLink: gy.primary,
    colorLinkHover: gy.hover,
    colorLinkActive: gy.active,
    colorSuccess: gy.success,
    colorWarning: gy.warning,
    colorError: gy.error,
    colorSuccessBg: gy.successBg,
    colorWarningBg: gy.warningBg,
    colorErrorBg: gy.errorBg,
    colorInfoBg: gy.selected,
    colorPrimaryBg: gy.selected,
    colorFillTertiary: gy.neutralBg,

    colorText: gy.text,
    colorTextHeading: gy.text,
    colorTextSecondary: gy.secondary,
    colorTextTertiary: gy.tertiary,
    colorTextDescription: gy.secondary,
    // 输入框提示文字：组件库默认太浅，看不清（设计差异清单 10-28 定为改代码）
    colorTextPlaceholder: gy.tertiary,

    colorBgLayout: gy.canvas,
    colorBgContainer: gy.surface,
    colorBgMask: gy.mask,
    colorSplit: gy.split,
    colorBorder: gy.border,
    colorBorderSecondary: gy.split,

    fontFamily,
    fontSize: 14,
    lineHeight: 22 / 14,
    fontWeightStrong: 600,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontSizeXL: 20,
    fontSizeHeading1: 24,
    fontSizeHeading2: 20,
    fontSizeHeading3: 16,
    lineHeightHeading1: 32 / 24,
    lineHeightHeading2: 28 / 20,
    lineHeightHeading3: 24 / 16,

    controlHeight: 32,
    controlHeightLG: 40,
    controlHeightSM: 24,
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    // 动效时长（Martin 10-28 选定，与 theme/motion.tsx 一致）：弹窗进出 150ms，抽屉滑入 200ms
    motionDurationFast: '0.1s',
    motionDurationMid: '0.15s',
    motionDurationSlow: '0.2s',
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
    // 40 高的输入框与按钮仍用 14 号字（设计稿 P01）
    Input: { inputFontSizeLG: 14 },
    Button: { contentFontSizeLG: 14 },
    // 表头：画布底色、正文色加粗
    // 表格（统计格与表格规范）：表头画布底色、次要色加粗，表头上下 12、行上下 14、左右 24，行间分隔线
    Table: {
      headerBg: gy.canvas,
      headerColor: gy.secondary,
      headerSplitColor: 'transparent',
      cellPaddingBlock: 14,
      cellPaddingInline: 24,
      headerBorderRadius: 0,
      borderColor: gy.split,
      rowHoverBg: gy.canvas,
      footerBg: gy.surface,
      footerColor: gy.tertiary,
    },
    // 页签：标签间距 32，选中加粗主色
    Tabs: {
      horizontalItemGutter: 32,
      horizontalItemPadding: '14px 0 12px',
      titleFontSize: 14,
      itemColor: gy.secondary,
      itemSelectedColor: gy.primary,
      itemHoverColor: gy.hover,
      inkBarColor: gy.primary,
    },
    // 标签：12 号字、高 22
    Tag: { defaultBg: gy.neutralBg, defaultColor: gy.secondary, fontSizeSM: 12, lineHeightSM: 20 / 12 },
    // 提示条：无边框、圆角 8、上下 12 左右 16
    Alert: {
      withDescriptionPadding: '12px 16px',
      defaultPadding: '12px 16px',
      colorInfoBorder: 'transparent',
      colorSuccessBorder: 'transparent',
      colorWarningBorder: 'transparent',
      colorErrorBorder: 'transparent',
    },
    // 白底卡片：内边距 24
    Card: { bodyPadding: 24, headerFontSize: 16 },
    // 弹窗宽度另由页面设 520 / 800
    Modal: { titleFontSize: 16 },
  },
};
