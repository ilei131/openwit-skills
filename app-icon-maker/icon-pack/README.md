# Demo — App 图标资源包

由 **app-icon-maker** 生成 · 2026-11-05 · 主色背景 `#442687`

## 目录结构

```
demo-icon-pack/
├── ios/
│   ├── AppIcon.appiconset/          # 传统全尺寸（iPhone + iPad + 1024），Xcode 全版本可用
│   └── AppIcon-Universal.appiconset/# Xcode 14+ 单尺寸 1024，含 dark / tinted 外观
├── android/
│   ├── app/src/main/res/
│   │   ├── drawable/                # ic_launcher_background / _foreground / _monochrome（自适应图标三层）
│   │   ├── mipmap-mdpi … xxxhdpi/   # 仅 ic_launcher.png + ic_launcher_round.png（API < 26 传统图标）
│   │   └── mipmap-anydpi-v26/       # ic_launcher.xml / ic_launcher_round.xml，引用 @drawable/*
│   └── play-store-icon-512.png      # Google Play 商店图标
├── web/                             # favicon.ico / apple-touch-icon / manifest
├── source/                          # 1024 母版 + 设计源文件 + icon-spec.json
├── preview.png / preview.html       # 效果预览
└── README.md
```

## iOS 接入

**方式 A（推荐，Xcode 14+ / iOS 26 兼容）**

1. 打开 `Assets.xcassets` → 选中 `AppIcon`
2. 右侧属性检查器把 **Single Size** 勾上
3. 把 `ios/AppIcon-Universal.appiconset/` 里的 `icon-1024.png`、`icon-1024-dark.png`、`icon-1024-tinted.png` 拖入对应槽位（或直接整包替换 `AppIcon.appiconset`）

**方式 B（兼容老版本 Xcode）**

删除工程内 `AppIcon.appiconset`，把本包的 `ios/AppIcon.appiconset` 整个拖进 `Assets.xcassets`。

> 图标已去除 alpha 通道、未预烘焙圆角 —— iOS 自动裁切 squircle，不要自己加圆角。
> iOS 26 Liquid Glass 若要分层光影，用 Xcode 26 的 Icon Composer 打开 `source/` 里的分层素材导出 `.icon`；不导出也能正常上架（系统按传统图标渲染）。

## Android 接入

把 `android/app/src/main/res/` 下的目录整体合并进工程同名目录（Flutter / RN / Capacitor 都是 `android/app/src/main/res/`）。

`AndroidManifest.xml` 无需改动，只要 `android:icon="@mipmap/ic_launcher"` 与 `android:roundIcon="@mipmap/ic_launcher_round"`。

- **自适应图标（API 26+）**：`mipmap-anydpi-v26/ic_launcher.xml` 只负责组合，三层素材都在 `res/drawable/`：
  - `ic_launcher_background.xml` — 纯色 `<shape>` 或渐变 `<vector>`（角度精确，不做 45° 量化）
  - `ic_launcher_foreground.xml` — 108dp 矢量前景，内容位于中央 72dp 安全区（本包按 50% 摆放）
  - `ic_launcher_monochrome.xml` — Android 13+ 主题图标轮廓，系统自动上色
- **传统图标（API < 26）**：`mipmap-mdpi … xxxhdpi` 里只有 `ic_launcher.png` 与 `ic_launcher_round.png`，不再有分块的前景/背景位图
- **Play 商店**：`play-store-icon-512.png`（512×512，32-bit PNG，< 1MB）

改配色直接编辑 `drawable/ic_launcher_background.xml` 即可，不需要重新导出位图。

## Web / PWA

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<link rel="manifest" href="/manifest.webmanifest">
```

## 校验

```bash
node <skill>/scripts/verify.mjs /Users/apple/Documents/GitHub/app-icon-maker/icon-pack
```

## 备注

- 所有位图均由 1024 母版以 Lanczos3 重采样，不是放大糊图。
- `source/icon-spec.json` 记录每个文件的尺寸与用途，可用于 CI 断言。
- 若需改配色/符号，修改 `source/` 里的源文件后用同一命令重新生成即可。
