# Bing Wallpaper Data

Bing Wallpaper 收藏系统的数据仓库。

本仓库负责保存 Bing 每日壁纸的结构化数据、预览图、颜色分析数据以及历史搜索索引。

整个项目由三个仓库组成：

- `bing-wallpaper`：前端网站
- `bing-data`：数据与预览资源
- `bing-uhd`：UHD 高清原图

在线网站：

**https://bing.伴随.cn**

数据地址：

**https://bing-data.伴随.cn**

UHD 图片地址：

**https://bing-uhd.伴随.cn**

---

## 仓库职责

本仓库主要保存：

- Bing 每日壁纸元数据
- 月度 JSON
- `data/index.json`
- preview 预览图
- Base64 缩略图
- 主色调
- HSV 颜色直方图
- 壁纸尺寸
- Bing 原始信息

本仓库**不再保存 UHD 高清原图**。

UHD 高清原图统一存放在：

```text
chendada00/bing-uhd
```

---

## 目录结构

```text
bing-data/
│
├── data/
│   ├── index.json
│   └── YYYY/
│       ├── 01.json
│       ├── 02.json
│       └── ...
│
├── preview/
│   └── YYYY/
│       └── MM/
│           └── YYYY-MM-DD.jpg
│
├── scripts/
│   ├── update-bing.js
│   ├── repair-history.js
│   ├── color-histogram.js
│   └── index.js
│
├── .github/
│   └── workflows/
│
└── README.md
```

---

## 月度 JSON

历史壁纸按照月份保存。

例如：

```text
data/2026/09.json
```

每个月包含该月的壁纸记录。

典型记录：

```json
{
  "date": "2026-09-23",
  "title": "Example title",
  "description": "Example description",
  "copyright": "Example copyright",
  "copyrightLink": "https://example.com",
  "image": "https://bing-uhd.伴随.cn/images/2026/09/2026-09-23.jpg",
  "preview": "https://bing-data.伴随.cn/preview/2026/09/2026-09-23.jpg",
  "sourceImage": "https://www.bing.com/..._UHD.jpg",
  "base64": "data:image/jpeg;base64,...",
  "color": {},
  "colorHistogram": {},
  "width": 3840,
  "height": 2160
}
```

---

## 图片地址设计

项目将高清图片和预览图片分开保存。

### `preview`

网站首页和普通浏览使用的预览图：

```text
https://bing-data.伴随.cn/preview/YYYY/MM/YYYY-MM-DD.jpg
```

### `image`

项目自己的 UHD 高清镜像：

```text
https://bing-uhd.伴随.cn/images/YYYY/MM/YYYY-MM-DD.jpg
```

### `sourceImage`

Bing 官方 UHD 原图地址。

例如：

```text
https://www.bing.com/..._UHD.jpg
```

三者职责不同：

```text
preview
    ↓
网页浏览

image
    ↓
稳定的 UHD 镜像

sourceImage
    ↓
Bing 官方原始来源
```

---

## Base64

每张壁纸保存一个小尺寸 Base64 JPEG。

主要用途：

- 快速模糊占位
- 首页背景
- 避免页面初始渲染时等待完整图片

Base64 不是 UHD 图片，也不是下载资源。

---

## 主色调

`color` 保存图片主色调分析结果。

主要用于：

- 页面视觉效果
- 主色调展示
- 颜色搜索
- 颜色复制

---

## Color Histogram

`colorHistogram` 保存图片的 HSV 颜色分布。

当前版本：

```text
Hue        12
Saturation 3
Value      3

12 × 3 × 3
= 108
```

因此每张图片包含：

```text
108 个颜色区域
```

这些数据描述整张图片的颜色组成。

它不是图片的空间坐标。

例如：

```text
bins[0]
```

并不表示：

```text
图片左上角
```

而表示一个特定 HSV 颜色区域。

---

## 历史索引

```text
data/index.json
```

用于全历史搜索。

索引只保存轻量级字段：

```text
日期
标题
描述
```

前端首先搜索：

```text
index.json
```

然后根据命中的日期加载对应月份 JSON。

这样可以避免前端一次加载全部历史数据。

---

## 数据更新

每日壁纸通过 GitHub Actions 自动处理。

基本流程：

```text
Bing
 ↓
获取每日壁纸信息
 ↓
获取 UHD 原图
 ↓
保存 UHD 到 bing-uhd
 ↓
生成 preview
 ↓
生成 Base64
 ↓
生成主色调
 ↓
生成颜色直方图
 ↓
更新月度 JSON
 ↓
更新 index.json
 ↓
提交仓库
```

---

## 历史数据修复

历史数据统一通过：

```text
.github/workflows/migrate-history.yml
```

以及：

```text
scripts/repair-history.js
```

进行检查和修复。

可以检查：

- 缺少数据记录
- 数据字段不完整
- 缺少 UHD
- UHD 图片无效
- preview 缺失
- Base64 缺失
- 主色调缺失
- 颜色直方图缺失
- 图片尺寸错误
- 官方 UHD 地址错误

---

## UHD 高清图片

UHD 图片不再保存于本仓库的 `images/` 目录。

所有 UHD 原图统一存放：

```text
chendada00/bing-uhd
```

目录结构：

```text
images/
└── YYYY/
    └── MM/
        └── YYYY-MM-DD.jpg
```

目标尺寸通常为：

```text
3840 × 2160
```

---

## 数据与前端

前端仓库：

```text
chendada00/bing-wallpaper
```

通过：

```text
https://bing-data.伴随.cn
```

读取本仓库的数据。

在线网站：

```text
https://bing.伴随.cn
```

---

## 三个仓库

### bing-wallpaper

前端网站：

```text
https://bing.伴随.cn
```

负责：

- 页面展示
- 搜索
- 历史浏览
- 高清查看
- 下载
- SEO

### bing-data

本仓库。

负责：

- JSON 数据
- preview
- Base64
- 颜色分析
- 历史索引

### bing-uhd

负责：

- UHD 高清原图

---

## License

MIT
