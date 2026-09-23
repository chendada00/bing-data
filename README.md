# Bing Wallpaper Data

Bing Wallpaper 的历史壁纸数据仓库。

本仓库主要负责：

* Bing 每日壁纸数据采集
* 历史数据保存
* 图片与预览图保存
* 图片颜色分析
* 历史搜索索引生成

前端项目通过月度 JSON 文件读取这里的数据。

---

## 📁 目录结构

```text
bing-data/
├── data/
│   ├── index.json
│   └── YYYY/
│       ├── 01.json
│       ├── 02.json
│       ├── ...
│       └── 12.json
│
├── images/
│   └── ...
│
├── preview/
│   └── ...
│
├── scripts/
│   ├── update-bing.js
│   └── ...
│
├── .github/
│   └── workflows/
│       └── update-bing.yml
│
└── _headers
```

---

## 📦 月度数据

壁纸按照月份保存。

例如：

```text
data/2026/09.json
```

结构：

```json
{
  "year": 2026,
  "month": 9,
  "items": [
    {
      "date": "2026-09-23",
      "title": "Example title",
      "description": "Example description",
      "copyright": "Example copyright",
      "copyrightLink": "https://example.com",
      "image": "https://example.com/image.jpg",
      "preview": "https://example.com/preview.jpg",
      "color": {},
      "colorHistogram": {
        "version": 1,
        "bins": []
      }
    }
  ]
}
```

---

## 🎨 Color 数据

每张图片会保存颜色分析结果。

### `color`

保存图片的主要颜色信息。

主要用于：

* 页面主色展示
* 颜色选择
* 视觉效果

---

## 📊 `colorHistogram`

`colorHistogram` 是图片的 HSV 颜色分布数据。

当前版本：

```text
Hue        12 桶
Saturation 3 桶
Value      3 桶

12 × 3 × 3 = 108
```

因此：

```json
{
  "version": 1,
  "bins": [ ... 108 个数值 ... ]
}
```

`bins` 中的每个数字表示：

> 图片中落入对应 HSV 色彩区域的像素数量。

它描述的是整张图片的颜色分布，而不是图片的空间位置。

因此：

```text
bins[0]
```

并不代表：

```text
图片左上角
```

而是代表一个特定的 HSV 颜色区域。

---

## 🔎 历史索引

`data/index.json` 用于支持全历史搜索。

索引保存轻量级的数据：

```text
日期
标题
描述
```

示例：

```json
[
  [
    "2026-09-23",
    "Example title",
    "Example description"
  ]
]
```

前端首先搜索这个索引。

找到匹配日期后，再加载对应月份的数据。

这样可以避免为了搜索历史数据而一次性下载全部月度 JSON。

---

## 🖼️ 图片

图片与 JSON 数据分开保存。

```text
images/
preview/
```

其中：

* `images`：原图
* `preview`：前端浏览使用的预览图

前端通常先加载 `preview`，用户进入详情页后再加载原图。

---

## 🔄 数据更新

数据通过 GitHub Actions 定期更新。

主要流程：

```text
Bing
 ↓
获取每日壁纸
 ↓
保存图片
 ↓
生成 preview
 ↓
颜色分析
 ↓
生成 colorHistogram
 ↓
更新月度 JSON
 ↓
更新 index.json
 ↓
提交 Git
```

---

## 🌐 Cloudflare Pages

本仓库可以作为静态数据源部署到 Cloudflare Pages。

部署后：

```text
前端
 ↓
Cloudflare Pages
 ↓
/data/YYYY/MM.json
/images/*
/preview/*
```

可以利用 HTTP Cache 缓存静态数据和图片。

其中图片和预览图属于基本不会变化的静态资源，可以使用较长的缓存时间。

月度 JSON 和 `index.json` 更新频率更高，因此应该使用相对短的缓存时间。

---

## 🧪 本地开发

安装依赖：

```bash
npm install
```

根据项目中的脚本运行对应的数据处理任务。

---

## 📌 数据设计原则

### 月度 JSON

负责保存完整壁纸数据。

### `index.json`

负责快速历史搜索。

### `color`

负责主色调展示。

### `colorHistogram`

负责：

* 颜色相似度搜索
* 色彩分布可视化
* 更细粒度的颜色分析

---

## 📄 License

MIT
