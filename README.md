# Bing Wallpaper Data

Bing 每日壁纸数据与图片归档仓库。

本项目负责从 Bing 获取每日壁纸，保存 UHD 原图，同时生成适合网页展示的 Preview、小尺寸 Base64 占位图以及图片主色调，并通过 GitHub Actions 自动维护历史数据。

本仓库与前端项目 [bing-wallpaper](https://github.com/chendada00/bing-wallpaper) 配套使用。

---

## 项目简介

`bing-data` 是整个 Bing 壁纸项目的数据层。

主要负责：

- 获取 Bing 每日壁纸
- 保存 3840 × 2160 UHD 原图
- 生成 1600 × 900 Preview 图片
- 生成 16 × 9 极小 Base64 图片，用于前端模糊占位
- 提取图片主色调
- 保存 Bing 壁纸标题、描述、版权信息等元数据
- 按年月组织历史数据
- 通过 GitHub Actions 自动更新
- 支持自定义图片资源域名
- 支持批量迁移历史 JSON 中的图片 URL

项目不依赖数据库，所有数据和图片均直接存储在 Git 仓库中。

---

## 项目结构

```text
bing-data/
├── .env
│
├── data/
│   └── 2026/
│       └── 09.json
│
├── images/
│   └── 2026/
│       └── 09/
│           └── 2026-09-16.jpg
│
├── preview/
│   └── 2026/
│       └── 09/
│           └── 2026-09-16.jpg
│
└── .github/
    └── workflows/
        ├── update-bing.yml
        └── migrate-history.yml
```

### data

保存按月份组织的 JSON 数据。

格式：

```text
data/YYYY/MM.json
```

例如：

```text
data/2026/09.json
```

### images

保存 Bing UHD 原图。

格式：

```text
images/YYYY/MM/YYYY-MM-DD.jpg
```

例如：

```text
images/2026/09/2026-09-16.jpg
```

原图通常为：

```text
3840 × 2160
```

### preview

保存用于网页列表展示的压缩图片。

默认优先生成：

```text
1600 × 900
```

如果图片仍然较大，会降低 JPEG 质量；必要时进一步使用：

```text
1280 × 720
```

Preview 主要用于网页列表，可以明显减少首页加载流量。

---

## JSON 数据格式

每个月对应一个 JSON 文件。

示例：

```json
{
  "version": 1,
  "year": 2026,
  "month": 9,
  "updatedAt": "2026-09-16T08:02:25.509Z",
  "items": [
    {
      "date": "2026-09-16",
      "title": "北极的新晋探索者",
      "description": "斯瓦尔巴群岛玩耍的北极熊幼崽，挪威",
      "copyright": "斯瓦尔巴群岛玩耍的北极熊幼崽，挪威",
      "copyrightLink": "https://www.bing.com/search?q=...",
      "image": "https://bing-data.伴随.cn/images/2026/09/2026-09-16.jpg",
      "preview": "https://bing-data.伴随.cn/preview/2026/09/2026-09-16.jpg",
      "sourceImage": "https://cn.bing.com/th?id=...",
      "base64": "data:image/jpeg;base64,...",
      "color": {
        "Vibrant": "#8cbbcc",
        "DarkVibrant": "#294e5c",
        "LightVibrant": "#e3f4fb",
        "Muted": "#7c9c9f",
        "DarkMuted": "#4e5445",
        "LightMuted": "#afc8d1"
      },
      "width": 3840,
      "height": 2160,
      "id": "3464e2609dc4cc5a425308f4e13b7ea0",
      "startDate": "20260915",
      "fullStartDate": "202609151600",
      "endDate": "20260916"
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
| --- | --- |
| `date` | 壁纸日期 |
| `title` | Bing 壁纸标题 |
| `description` | Bing 壁纸描述 |
| `copyright` | 图片版权信息 |
| `copyrightLink` | Bing 相关链接 |
| `image` | UHD 原图地址 |
| `preview` | Preview 图片地址 |
| `sourceImage` | Bing 原始图片地址 |
| `base64` | 极小 Base64 占位图 |
| `color` | 图片主色调 |
| `width` | 原图宽度 |
| `height` | 原图高度 |
| `id` | Bing 图片 ID |
| `startDate` | Bing 起始日期 |
| `fullStartDate` | Bing 完整起始时间 |
| `endDate` | Bing 结束日期 |

---

## 图片处理流程

每次 GitHub Actions 执行时，大致按照以下流程工作：

```text
Bing
 │
 ▼
获取壁纸元数据
 │
 ▼
下载 UHD 原图
 │
 ├── 保存 images/YYYY/MM/YYYY-MM-DD.jpg
 │
 ├── 生成 Preview
 │      │
 │      └── 保存 preview/YYYY/MM/YYYY-MM-DD.jpg
 │
 ├── 生成 Base64 占位图
 │
 └── 提取主色调
         │
         ▼
      生成 JSON
```

### 原图

原图只在仓库中不存在时下载。

这样可以避免重复下载和覆盖历史原图。

### Preview

Preview 用于网页列表展示。

处理策略：

```text
1600 × 900
    ↓
JPEG Quality 82
    ↓
78
    ↓
75
    ↓
72
    ↓
70
    ↓
如果仍然较大
    ↓
1280 × 720
```

目标是尽量将 Preview 控制在约 800 KB 以下。

### Base64

Base64 只用于极小尺寸的模糊占位：

```text
16 × 9
```

它不是原图，也不是 Preview。

前端会先显示 Base64，然后在后台加载高清图。

---

## 图片主色调

使用 `node-vibrant` 提取图片颜色。

生成：

```json
{
  "Vibrant": "#8cbbcc",
  "DarkVibrant": "#294e5c",
  "LightVibrant": "#e3f4fb",
  "Muted": "#7c9c9f",
  "DarkMuted": "#4e5445",
  "LightMuted": "#afc8d1"
}
```

前端可以利用这些颜色制作图片查看器背景氛围。

---

# GitHub Actions

项目目前包含两个 Workflow。

## 1. Update Bing Wallpaper

文件：

```text
.github/workflows/update-bing.yml
```

作用：

- 自动获取 Bing 壁纸
- 下载原图
- 生成 Preview
- 生成 Base64
- 提取颜色
- 更新 JSON
- 自动提交到 GitHub

执行时间：

```text
UTC 00:00 → 北京时间 08:00
UTC 08:00 → 北京时间 16:00
UTC 15:00 → 北京时间 23:00
```

同时支持：

```text
Actions → Update Bing Wallpaper → Run workflow
```

手动执行。

---

## 2. Migrate History Asset URLs

文件：

```text
.github/workflows/migrate-history.yml
```

这个 Workflow 专门用于迁移历史数据中的图片 URL。

触发方式：

```text
workflow_dispatch
```

也就是只允许手动执行。

例如原来的 URL：

```text
https://raw.githubusercontent.com/chendada00/bing-data/main/images/2026/09/2026-09-16.jpg
```

迁移后：

```text
https://bing-data.伴随.cn/images/2026/09/2026-09-16.jpg
```

它只修改：

```text
data/**/*.json
```

不会重新下载图片，也不会修改：

```text
images/
preview/
```

同时不会修改：

```text
sourceImage
```

---

# 自定义资源域名

项目通过 `.env` 解耦图片资源地址。

根目录：

```text
.env
```

内容：

```env
ASSET_BASE_URL=https://bing-data.伴随.cn
```

这个变量用于生成：

```text
image
preview
```

例如：

```text
ASSET_BASE_URL=https://example.com
```

最终：

```text
https://example.com/images/2026/09/2026-09-16.jpg
```

以及：

```text
https://example.com/preview/2026/09/2026-09-16.jpg
```

---

# 更换图片域名

如果以后将图片迁移到 CDN 或其他服务器：

### 1. 修改 `.env`

```env
ASSET_BASE_URL=https://new-cdn.example.com
```

### 2. 执行历史迁移

进入：

```text
GitHub
→ Actions
→ Migrate History Asset URLs
→ Run workflow
```

### 3. 修改前端仓库

修改：

```text
bing-wallpaper/.env
```

将：

```env
VITE_DATA_BASE_URL=https://bing-data.伴随.cn
```

修改为新的数据域名。

### 4. 重新部署前端

即可完成整个资源地址迁移。

---

# 数据部署

这个仓库本身不要求部署到服务器。

只要图片文件和 JSON 保存在 GitHub，就可以通过：

```text
GitHub Raw
```

或者通过：

```text
CDN / EdgeOne / Cloudflare / Vercel / Nginx
```

等方式提供访问。

推荐将：

```text
data/
images/
preview/
```

作为静态资源发布。

---

# 与前端项目的关系

对应前端：

**bing-wallpaper**

```text
https://github.com/chendada00/bing-wallpaper
```

数据仓库：

**bing-data**

```text
https://github.com/chendada00/bing-data
```

前端不会参与数据生成。

两者关系：

```text
              bing-data
                  │
        ┌─────────┴─────────┐
        │                   │
      JSON               图片资源
        │                   │
        └─────────┬─────────┘
                  │
                  ▼
            bing-wallpaper
                  │
                  ▼
               用户浏览
```

---

# 技术栈

- GitHub Actions
- Node.js 22
- Jimp
- node-vibrant
- Bing Wallpaper API / 页面数据
- JSON
- JPEG

---

# 设计目标

这个仓库主要追求：

- 数据长期保存
- 原图永久归档
- 前端快速加载
- 图片资源与前端解耦
- 不依赖数据库
- 不依赖服务器运行环境
- 自动化更新
- 历史数据可迁移
- 资源地址可以随时切换

---

# 相关项目

- 前端项目：`chendada00/bing-wallpaper`
- 数据项目：`chendada00/bing-data`

---

## License

本项目代码部分采用 MIT License。

Bing 壁纸图片的版权归原作者及相关版权方所有。本项目主要用于个人学习、展示和壁纸归档。

使用图片时请遵守相关版权和使用规定。