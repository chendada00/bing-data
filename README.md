<div align="center">

# 🗂️ Bing Wallpaper Data

**Bing 每日壁纸收藏系统的数据与预览资源仓库**

[![Data](https://img.shields.io/badge/Data-JSON-5b8def)](https://github.com/chendada00/bing-data)
[![Automation](https://img.shields.io/badge/Automation-GitHub_Actions-2088ff?logo=githubactions&logoColor=white)](https://github.com/chendada00/bing-data/actions)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

🌐 **网站：** [bing.伴随.cn](https://bing.伴随.cn)  
🗂️ **数据服务：** [bing-data.伴随.cn](https://bing-data.伴随.cn)  
🖥️ **UHD 图片：** [bing-uhd.伴随.cn](https://bing-uhd.伴随.cn)

</div>

------------------------------------------------------------------------

## 📌 仓库简介

`bing-data` 是 Bing Wallpaper
收藏系统的数据仓库，负责保存结构化壁纸信息、历史索引、预览图片以及图片分析结果。UHD
高清原图已经拆分到独立的
[`bing-uhd`](https://github.com/chendada00/bing-uhd) 仓库中。

整个系统由三个仓库组成：

| 仓库                                                             | 主要职责                                       |
|------------------------------------------------------------------|------------------------------------------------|
| [`bing-wallpaper`](https://github.com/chendada00/bing-wallpaper) | 前端网站                                       |
| **`bing-data`**                                                  | 月度 JSON、历史索引、预览图、Base64 与颜色数据 |
| [`bing-uhd`](https://github.com/chendada00/bing-uhd)             | UHD 高清原图                                   |

## 🧰 本仓库保存什么

- 🧾 每日壁纸元数据与月度 JSON
- 🔎 `data/index.json` 历史搜索索引
- 🖼️ `preview/` 预览图
- 🫧 小尺寸 JPEG 的 Base64 数据
- 🎨 图片主色调信息
- 🌈 HSV 颜色直方图
- 📐 图片宽度与高度等元数据

**本仓库不负责保存 UHD 高清原图。** 高清镜像统一位于
`chendada00/bing-uhd`。

## 📁 目录结构

``` text
bing-data/
├── data/
│   ├── index.json
│   ├── 2026/
│   │   ├── 01.json
│   │   ├── 02.json
│   │   └── ...
│   └── 2025/
│       └── ...
├── preview/
│   └── YYYY/
│       └── MM/
│           └── YYYY-MM-DD.jpg
├── scripts/
│   ├── update-bing.js
│   ├── repair-history.js
│   ├── color-histogram.js
│   └── index.js
├── .github/
│   └── workflows/
│       └── update-bing.yml
├── _headers
└── README.md
```

> 目录中的历史年份和月份会随着数据更新继续增加；以上为结构示意。

## 📦 月度 JSON 数据

壁纸按年份和月份保存，例如：

``` text
data/2026/09.json
```

每个文件通常是一个对象，包含 `year`、`month` 和
`items`。单条壁纸记录可能包含以下字段：

``` json
{
  "date": "2026-09-23",
  "title": "Example title",
  "description": "Example description",
  "copyright": "Example copyright",
  "copyrightLink": "https://example.com",
  "image": "https://bing-uhd.伴随.cn/images/2026/09/2026-09-23.jpg",
  "preview": "https://bing-data.伴随.cn/preview/2026/09/2026-09-23.jpg",
  "sourceImage": "https://www.bing.com/...",
  "base64": "data:image/jpeg;base64,...",
  "color": {},
  "colorHistogram": {
    "version": 1,
    "bins": []
  },
  "width": 3840,
  "height": 2160
}
```

上面是字段示例，不代表每条历史记录都必然包含所有字段。历史数据修复脚本会用于检查和补齐支持的缺失数据。

## 🖼️ 图片地址字段

| 字段          | 含义                    | 典型用途                     |
|---------------|-------------------------|------------------------------|
| `preview`     | 数据仓库中的预览图地址  | 首页卡片与普通浏览           |
| `image`       | 项目维护的 UHD 镜像地址 | 高清查看或下载的备用来源     |
| `sourceImage` | Bing 官方原图地址       | 优先尝试获取官方 UHD 原图    |
| `base64`      | 小尺寸 JPEG 的 Data URL | 模糊占位、首页背景等视觉效果 |

典型地址形式：

``` text
预览图：
https://bing-data.伴随.cn/preview/YYYY/MM/YYYY-MM-DD.jpg

UHD 镜像：
https://bing-uhd.伴随.cn/images/YYYY/MM/YYYY-MM-DD.jpg
```

`base64` 不是 UHD 原图，也不应该用作高清下载资源。

## 🎨 主色调与颜色直方图

### `color`

保存图片主色调分析结果，可供前端进行颜色展示和颜色搜索等操作。具体对象结构以生成脚本与当前数据为准。

### `colorHistogram`

保存 HSV 颜色分布。当前版本使用以下分桶配置：

``` text
Hue（色相）             12 桶
Saturation（饱和度）     3 桶
Value（明度）            3 桶

12 × 3 × 3 = 108 个区域
```

`bins`
中保存归一化后的区域统计值。它描述整张图片的颜色组成，而不是图片中的空间坐标：`bins[0]`
不代表原图左上角。

## 🔎 历史索引 `data/index.json`

索引用于支持前端全历史搜索。索引采用轻量级结构，典型内容如下：

``` json
{
  "version": 1,
  "updatedAt": "2026-09-23T00:00:00.000Z",
  "items": [
    [
      "2026-09-23",
      "Example title",
      "Example description"
    ]
  ]
}
```

每个索引条目依次保存：

1.  日期
2.  标题
3.  描述

前端先在索引中查找符合条件的日期，再按月份加载完整
JSON，而不是一次性下载全部历史数据。

## 🔄 自动更新

每日壁纸更新由 GitHub Actions 工作流执行，工作流文件为：

``` text
.github/workflows/update-bing.yml
```

当前工作流配置了定时触发和手动触发。其基本流程如下：

``` text
获取 Bing 每日壁纸信息
          ↓
获取 UHD 图片
          ↓
写入 bing-uhd/images/
          ↓
生成 preview 与 Base64
          ↓
提取主色调与 HSV 颜色直方图
          ↓
更新月度 JSON
          ↓
重建 data/index.json
          ↓
提交更新
```

工作流的实际执行时间以 GitHub Actions 中的 cron
配置为准；定时任务也可能受到 GitHub Actions 调度延迟影响。

### GitHub Actions 配置

工作流需要能够读取本仓库代码，并将 UHD 图片写入 `chendada00/bing-uhd`：

- 在 `bing-data` 仓库的 **Settings → Secrets and variables → Actions**
  中配置 `BING_UHD_TOKEN`。
- Token 需要具备对 `chendada00/bing-uhd`
  执行检出、提交和推送所需的权限；建议仅授予必要仓库与权限。
- 仓库根目录需要有工作流读取的 `.env` 配置，其中包含：

``` dotenv
# preview 图片的公开根地址
PREVIEW_BASE_URL=https://bing-data.伴随.cn

# UHD 镜像的公开根地址
IMAGE_BASE_URL=https://bing-uhd.伴随.cn
```

上述地址用于生成写入 JSON 的资源 URL。请按实际域名调整，不要在公开
README 或日志中放入 Token。

## 🧰 数据维护脚本

| 脚本                         | 用途                                   |
|------------------------------|----------------------------------------|
| `scripts/update-bing.js`     | 获取并处理每日壁纸，生成数据与预览资源 |
| `scripts/repair-history.js`  | 检查和修复历史记录及相关图片数据       |
| `scripts/color-histogram.js` | 生成 HSV 颜色直方图                    |
| `scripts/index.js`           | 根据月度 JSON 重建历史搜索索引         |

运行脚本前，请先检查脚本实际需要的参数、环境变量和工作目录。历史修复脚本可能修改多个月份的数据，建议在执行前备份仓库并先检查运行日志。

## 🌐 静态托管与缓存

本仓库可以作为静态资源部署到支持静态文件托管的服务，并通过
`bing-data.伴随.cn` 提供 JSON 和预览图。

根目录 `_headers` 用于配置部分响应头，当前包含：

- 公共跨域访问响应头
- 预览图的较长缓存时间
- `data/index.json` 的较短缓存时间
- 月度 JSON 的缓存策略

不同托管平台对 `_headers`
的支持可能不同。若部署平台不识别该文件，需要在平台对应的规则配置中设置
CORS 与 Cache-Control。

## 🧪 本地维护

本仓库的更新流程主要由 GitHub Actions
执行。脚本依赖以工作流中的安装步骤为准；例如每日处理工作流会安装 `jimp`
与 `node-vibrant` 等图像处理依赖。

``` bash
git clone https://github.com/chendada00/bing-data.git
cd bing-data
```

运行具体脚本前，请先阅读对应脚本与工作流，确认所需环境变量、`bing-uhd`
仓库检出路径和权限配置。

## 🔗 相关链接

- 🌐 [在线网站](https://bing.伴随.cn)
- 🖥️ [bing-wallpaper
  前端仓库](https://github.com/chendada00/bing-wallpaper)
- 🗂️ [bing-data 数据仓库](https://github.com/chendada00/bing-data)
- 🖼️ [bing-uhd 高清图片仓库](https://github.com/chendada00/bing-uhd)

## 📄 License

本仓库使用 MIT License，详见仓库中的 `LICENSE` 文件。
