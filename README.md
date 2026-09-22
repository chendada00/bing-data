# 🗃️ Bing Wallpaper Data

Bing 壁纸历史数据仓库。

这个项目负责从 Bing 获取每日壁纸相关信息，并对原始图片进行保存、压缩、缩略图生成和颜色分析，最终按照月份整理为结构化 JSON 数据，供 [`bing-wallpaper`](https://github.com/chendada00/bing-wallpaper) 等前端项目使用。

> 🖼️ 这是一个**数据生产仓库**，不是前端展示项目。  
> 📦 图片资源较多，仓库体积会随着历史数据持续增长。

---

# ✨ 项目职责

本仓库主要负责：

- 🌐 获取 Bing 每日壁纸信息
- 🖼️ 下载高清原始壁纸
- 🔗 保存 Bing 图片元数据
- 📐 保存图片尺寸
- 🪄 生成 Preview 图片
- 🧩 生成 Base64 小缩略图
- 🎨 提取图片主色
- 🗂️ 按年月组织历史数据
- 🔄 更新当前 Bing 壁纸
- 🛠️ 回填历史数据
- ♻️ 修复和迁移历史数据
- 🚀 通过 GitHub Actions 自动执行任务

---

# 🏗️ 数据处理架构

整体数据流：

```text
                         Bing
                          │
                          ▼
                 ┌─────────────────┐
                 │ 获取每日壁纸信息 │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ 下载 UHD / 原图 │
                 └────────┬────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
              ▼           ▼           ▼
          原始图片      Preview      Base64
              │           │           │
              │           │           │
              └───────────┼───────────┘
                          │
                          ▼
                    🎨 主色提取
                          │
                          ▼
                    🗂️ 月度 JSON
                          │
                          ▼
                  Git Commit / Push
```

---

# 📁 目录结构

核心结构：

```text
bing-data/
├── .github/
│   └── workflows/
│       ├── update-bing.yml
│       ├── backfill-history.yml
│       └── migrate-history.yml
│
├── data/
│   └── YYYY/
│       └── MM.json
│
├── images/
│   └── YYYY/
│       └── MM/
│           └── YYYY-MM-DD.jpg
│
├── preview/
│   └── YYYY/
│       └── MM/
│           └── YYYY-MM-DD.jpg
│
├── scripts/
│   └── backfill-history.js
│
├── .env
├── _headers
└── README.md
```

---

# 🗂️ 数据组织方式

数据按照：

```text
年 / 月
```

进行拆分。

例如：

```text
data/
└── 2026/
    ├── 01.json
    ├── 02.json
    ├── 03.json
    ├── ...
    └── 09.json
```

对应图片：

```text
images/
└── 2026/
    └── 09/
        ├── 2026-09-01.jpg
        ├── 2026-09-02.jpg
        └── ...
```

Preview：

```text
preview/
└── 2026/
    └── 09/
        ├── 2026-09-01.jpg
        ├── 2026-09-02.jpg
        └── ...
```

这种结构可以避免所有历史数据集中到一个超大的 JSON 文件中，同时方便前端按照月份进行懒加载。

---

# 📄 JSON 数据格式

每个月对应一个 JSON 文件：

```json
{
  "version": 1,
  "year": 2026,
  "month": 9,
  "updatedAt": "2026-09-21T19:51:02.041Z",
  "items": [
    {
      "date": "2026-09-01",
      "title": "Wallpaper title",
      "description": "Wallpaper description",
      "copyright": "Copyright information",
      "copyrightLink": "https://...",
      "image": "https://...",
      "preview": "https://...",
      "sourceImage": "https://...",
      "base64": "data:image/jpeg;base64,...",
      "color": {
        "Vibrant": "#123456",
        "DarkVibrant": "#123456",
        "LightVibrant": "#123456",
        "Muted": "#123456",
        "DarkMuted": "#123456",
        "LightMuted": "#123456"
      },
      "width": 1920,
      "height": 1080,
      "id": "xxxxxx",
      "startDate": "...",
      "fullStartDate": "...",
      "endDate": "..."
    }
  ]
}
```

---

# 🧱 字段说明

| 字段 | 说明 |
|---|---|
| `date` | 壁纸对应日期 |
| `title` | Bing 壁纸标题 |
| `description` | 壁纸描述 |
| `copyright` | 版权信息 |
| `copyrightLink` | 版权相关链接 |
| `image` | 项目保存的原始高清图片地址 |
| `preview` | Preview 图片地址 |
| `sourceImage` | 原始来源图片地址 |
| `base64` | 极小尺寸 Base64 缩略图 |
| `color` | 图片主色调 |
| `width` | 原图宽度 |
| `height` | 原图高度 |
| `id` | 项目生成的数据 ID |
| `startDate` | Bing 数据中的开始日期 |
| `fullStartDate` | Bing 数据中的完整开始时间 |
| `endDate` | Bing 数据中的结束日期 |

---

# 🖼️ 图片处理

每日图片会产生多个层级：

```text
                         原始图片
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
           Original       Preview       Base64
          高清原图        JPEG 预览       极小缩略图
              │             │             │
              │             │             │
              ▼             ▼             ▼
           查看/下载       列表展示       快速占位
```

---

# 🖼️ Original

原始图片用于：

- 高清查看
- 下载
- 图片详情展示

默认会优先尝试 Bing UHD 图片。

如果 UHD 下载失败，则回退到 Bing 提供的普通图片地址。

---

# 🖼️ Preview

Preview 用于前端列表展示。

当前处理逻辑优先尝试：

```text
1600 × 900
```

并通过调整 JPEG quality 控制文件大小。

目标是尽量将 Preview 控制在：

```text
≈ 800 KB
```

以内。

---

# 🧩 Base64 Thumbnail

每条数据都会保存一个非常小的 Base64 JPEG。

当前生成逻辑会将图片缩放到：

```text
16 × 9
```

这个 Base64 图片主要用于：

- 页面快速占位
- 高清图片加载前的视觉过渡
- 减少首屏等待感

它不是用于高清展示的。

---

# 🎨 颜色提取

项目使用：

```text
node-vibrant
```

分析图片颜色。

生成的调色板包括：

```text
Vibrant
LightVibrant
DarkVibrant

Muted
LightMuted
DarkMuted
```

最终保存为：

```json
{
  "color": {
    "Vibrant": "#...",
    "DarkVibrant": "#...",
    "LightVibrant": "#...",
    "Muted": "#...",
    "DarkMuted": "#...",
    "LightMuted": "#..."
  }
}
```

这些颜色会被前端用于：

- 🎨 颜色搜索
- 🖼️ 图片查看器背景
- 🌈 图片视觉效果

---

# ⚙️ 自动更新

每日更新由：

```text
.github/workflows/update-bing.yml
```

负责。

Workflow 支持：

- 🖱️ 手动执行
- ⏰ 定时执行
- 🔄 自动提交更新
- 🚀 自动推送到 GitHub

当前定时任务每天执行多次，以尽可能及时获取 Bing 的最新壁纸。

Workflow 使用：

```text
Node.js 22
```

并使用：

```text
Jimp
node-vibrant
```

进行图片处理。

---

# 🔁 更新流程

一次正常更新大致经过：

```text
GitHub Actions
      │
      ▼
获取 Bing 数据
      │
      ▼
解析图片 URL
      │
      ▼
尝试下载 UHD
      │
      ├── 成功 ──► 使用 UHD
      │
      └── 失败 ──► 回退普通图片
      │
      ▼
检查历史文件是否存在
      │
      ▼
生成 Preview
      │
      ▼
生成 Base64
      │
      ▼
提取颜色
      │
      ▼
更新 YYYY/MM.json
      │
      ▼
git add
      │
      ▼
git commit
      │
      ▼
git push
```

---

# ♻️ 已有数据复用

为了避免重复处理，更新流程会尽量复用已经存在的资源。

例如：

- 原始图片已经存在 → 不重复下载
- Base64 已存在 → 尽量复用
- 颜色已经存在 → 尽量复用
- Preview 已存在 → 尽量复用

这样可以减少 GitHub Actions 的运行时间和网络请求。

---

# 🛠️ 历史数据

仓库不仅用于每日更新，也提供历史数据处理能力。

相关脚本：

```text
scripts/backfill-history.js
```

主要用于历史数据的：

- 📚 回填
- 🖼️ 图片补全
- 🧩 Preview 生成
- 🎨 颜色生成
- 📦 Base64 生成
- 🔧 数据修复
- 🔄 数据合并

---

# 🔄 GitHub Actions

项目目前包含多个 Workflow：

```text
.github/workflows/
├── update-bing.yml
├── backfill-history.yml
└── migrate-history.yml
```

分别用于不同的数据生命周期任务。

### `update-bing.yml`

负责日常 Bing 壁纸更新。

### `backfill-history.yml`

用于历史数据回填。

### `migrate-history.yml`

用于历史数据迁移、修复等操作。

---

# 🌐 数据访问

生成后的 JSON 可以按照：

```text
data/YYYY/MM.json
```

进行访问。

图片则按照：

```text
images/YYYY/MM/YYYY-MM-DD.jpg
```

Preview：

```text
preview/YYYY/MM/YYYY-MM-DD.jpg
```

具体访问域名由当前部署配置决定。

---

# 🔗 与 bing-wallpaper 的关系

本仓库与：

[`bing-wallpaper`](https://github.com/chendada00/bing-wallpaper)

属于：

```text
数据仓库
   │
   │ JSON
   ▼
前端仓库
```

即：

### `bing-data`

负责：

> **生产数据**

### `bing-wallpaper`

负责：

> **消费数据 + UI 展示**

前端无需自己：

- 请求 Bing
- 下载图片
- 压缩图片
- 提取颜色
- 生成缩略图

---

# 🚀 本地运行

如果需要手动执行数据处理脚本：

```bash
npm install
```

根据具体脚本配置准备环境变量。

部分处理任务会依赖：

```text
Node.js
Jimp
node-vibrant
```

---

# ⚠️ 仓库体积

本项目会长期保存 Bing 历史壁纸，因此仓库体积会持续增长。

主要空间来自：

```text
images/
preview/
```

其中：

```text
images/
```

保存高清原图。

```text
preview/
```

保存用于前端展示的压缩图片。

而：

```text
data/
```

保存结构化元数据、颜色信息和 Base64 缩略图。

因此：

> 如果只需要使用壁纸数据而不需要图片资源，可以只读取 `data/`。

---

# 📊 数据设计原则

这个项目的数据设计主要遵循几个原则：

### 1. 📅 按月份拆分

避免一个 JSON 文件无限增长。

### 2. 🖼️ 原图与 Preview 分离

让前端列表无需加载高清图片。

### 3. ⚡ Base64 快速占位

让页面可以快速显示低成本的图片预览。

### 4. 🎨 预计算颜色

避免前端重复进行图片分析。

### 5. ♻️ 尽量复用历史资源

避免重复下载和重复计算。

### 6. 🤖 自动化更新

通过 GitHub Actions 自动维护数据。

---

# 🔐 环境变量

项目使用：

```text
.env
```

保存数据生成和资源地址相关配置。

尤其是资源部署地址等配置，应根据当前运行环境进行设置。

不要将真正的敏感信息提交到公开仓库。

---

# 📦 相关项目

🖼️ 前端：

https://github.com/chendada00/bing-wallpaper

🗃️ 数据：

https://github.com/chendada00/bing-data

---

# 📄 License

请以仓库实际 License 文件为准。

---

> 🌅 保存每天的 Bing 风景，也保存时间留下来的痕迹。
