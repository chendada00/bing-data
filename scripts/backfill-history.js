const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");

const Jimp = require("jimp");
const Vibrant = require("node-vibrant");

// ============================================================
// 配置
// ============================================================

// 历史数据源
const SOURCE_API =
  "https://bing.npanuhin.me/CN-zh.json";

// 从什么时候开始补
// 默认从 2024-01-01 开始。
// Bing-Wallpaper-Archive 的 CN-zh 数据主要覆盖 2024 年以后。
const START_DATE = "2026-08-14";

// 留空表示一直补到源仓库目前最新日期
const END_DATE = "";

// GitHub 仓库地址
const RAW_BASE =
  "https://raw.githubusercontent.com/chendada00/bing-data/main";

// 原图保存目录
const IMAGE_ROOT = "images";

// Preview 保存目录
const PREVIEW_ROOT = "preview";

// JSON 保存目录
const DATA_ROOT = "data";

// Preview 最大目标大小
const PREVIEW_MAX_SIZE = 800 * 1024;


// ============================================================
// 日志
// ============================================================

function log(message) {
  console.log(
    `[${new Date().toISOString()}] ${message}`
  );
}


// ============================================================
// sleep
// ============================================================

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


// ============================================================
// HTTP 请求
// ============================================================

function requestBuffer(url, retry = 0) {

  return new Promise((resolve, reject) => {

    if (retry > 3) {

      reject(
        new Error(
          `Request failed after 3 retries: ${url}`
        )
      );

      return;
    }

    const client =
      url.startsWith("https://")
        ? https
        : http;

    const request =
      client.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 " +
              "(Windows NT 10.0; Win64; x64) " +
              "AppleWebKit/537.36 " +
              "Chrome/140 Safari/537.36",

            "Accept":
              "*/*"
          }
        },
        response => {

          // ----------------------------------------------------
          // 重定向
          // ----------------------------------------------------

          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {

            response.resume();

            const redirectUrl =
              new URL(
                response.headers.location,
                url
              ).toString();

            requestBuffer(
              redirectUrl,
              retry
            )
              .then(resolve)
              .catch(reject);

            return;
          }


          // ----------------------------------------------------
          // HTTP 错误
          // ----------------------------------------------------

          if (
            response.statusCode !== 200
          ) {

            response.resume();

            reject(
              new Error(
                `HTTP ${response.statusCode}: ${url}`
              )
            );

            return;
          }


          const chunks = [];

          response.on(
            "data",
            chunk => {
              chunks.push(chunk);
            }
          );


          response.on(
            "end",
            () => {

              resolve(
                Buffer.concat(chunks)
              );

            }
          );


          response.on(
            "error",
            reject
          );

        }
      );


    request.setTimeout(
      60000,
      () => {

        request.destroy(
          new Error(
            `Request timeout: ${url}`
          )
        );

      }
    );


    request.on(
      "error",
      error => {

        if (retry < 3) {

          log(
            `Request failed, retry ${retry + 1}/3: ${url}`
          );

          sleep(
            2000 * (retry + 1)
          )
            .then(() => {

              requestBuffer(
                url,
                retry + 1
              )
                .then(resolve)
                .catch(reject);

            });

        } else {

          reject(error);

        }

      }
    );

  });

}


// ============================================================
// 获取 JSON
// ============================================================

async function requestJson(url) {

  const buffer =
    await requestBuffer(url);

  return JSON.parse(
    buffer.toString("utf8")
  );

}


// ============================================================
// 下载图片
// ============================================================

async function downloadImage(url) {

  log(
    `Downloading image: ${url}`
  );

  const buffer =
    await requestBuffer(url);


  if (
    !buffer ||
    buffer.length < 50 * 1024
  ) {

    throw new Error(
      `Image is too small: ${buffer ? buffer.length : 0} bytes`
    );

  }

  return buffer;
}


// ============================================================
// 日期工具
// ============================================================

function normalizeDate(value) {

  if (!value) {
    return null;
  }

  const text =
    String(value).trim();


  // YYYY-MM-DD
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {

    return text;

  }


  // YYYYMMDD
  if (
    /^\d{8}$/.test(text)
  ) {

    return (
      text.substring(0, 4) +
      "-" +
      text.substring(4, 6) +
      "-" +
      text.substring(6, 8)
    );

  }


  return null;
}


// ============================================================
// 日期比较
// ============================================================

function dateToNumber(date) {

  return Number(
    date.replace(/-/g, "")
  );

}


// ============================================================
// 计算日期的前一天
// ============================================================

function getPreviousDate(date) {

  const d =
    new Date(
      `${date}T00:00:00Z`
    );

  d.setUTCDate(
    d.getUTCDate() - 1
  );

  return d
    .toISOString()
    .substring(0, 10);
}


// ============================================================
// 计算日期的下一天
// ============================================================

function getNextDate(date) {

  const d =
    new Date(
      `${date}T00:00:00Z`
    );

  d.setUTCDate(
    d.getUTCDate() + 1
  );

  return d
    .toISOString()
    .substring(0, 10);
}


// ============================================================
// RGB -> HEX
// ============================================================

function componentToHex(num) {

  const hex =
    Math.round(num)
      .toString(16);

  return hex.length === 1
    ? "0" + hex
    : hex;
}


function rgbToHex(rgb) {

  return (
    "#" +
    componentToHex(rgb[0]) +
    componentToHex(rgb[1]) +
    componentToHex(rgb[2])
  );

}


// ============================================================
// 获取颜色
//
// 与目前 update-bing.yml 使用的 node-vibrant 逻辑一致
// ============================================================

async function getMainColors(
  imageBuffer,
  tempFile
) {

  log(
    "Analyzing image colors..."
  );


  const image =
    await Jimp.read(
      imageBuffer
    );


  await image.writeAsync(
    tempFile
  );


  const palette =
    await new Promise(
      (resolve, reject) => {

        Vibrant
          .from(tempFile)
          .getPalette(
            (error, result) => {

              if (error) {
                reject(error);
                return;
              }

              resolve(result);

            }
          );

      }
    );


  const colors = {};


  const colorNames = [
    "Vibrant",
    "DarkVibrant",
    "LightVibrant",
    "Muted",
    "DarkMuted",
    "LightMuted"
  ];


  colorNames.forEach(
    key => {

      const swatch =
        palette &&
        palette[key];


      if (
        swatch &&
        swatch.rgb
      ) {

        colors[key] =
          rgbToHex(
            swatch.rgb
          );

      } else {

        colors[key] = null;

      }

    }
  );


  return colors;
}


// ============================================================
// 生成 Base64
//
// 16 × 9
// 用于前端模糊占位
// ============================================================

async function getBase64(
  imageBuffer
) {

  log(
    "Generating Base64 thumbnail..."
  );


  const image =
    await Jimp.read(
      imageBuffer
    );


  image
    .resize(
      16,
      9
    )
    .quality(
      90
    );


  return await image.getBase64Async(
    Jimp.MIME_JPEG
  );

}


// ============================================================
// 生成 Preview
//
// 1600 × 900
// 最大约 800KB
// ============================================================

async function generatePreview(
  imageBuffer,
  previewFile
) {

  log(
    "Generating preview..."
  );


  const source =
    await Jimp.read(
      imageBuffer
    );


  const qualities = [
    82,
    78,
    75,
    72,
    70
  ];


  // ----------------------------------------------------------
  // 1600 × 900
  // ----------------------------------------------------------

  for (
    const quality of qualities
  ) {

    const image =
      source.clone();


    image
      .resize(
        1600,
        900
      )
      .quality(
        quality
      );


    const buffer =
      await image.getBufferAsync(
        Jimp.MIME_JPEG
      );


    log(
      `Preview: 1600x900 quality=${quality}, ` +
      `${Math.round(buffer.length / 1024)}KB`
    );


    if (
      buffer.length <=
        PREVIEW_MAX_SIZE ||
      quality === 70
    ) {

      fs.mkdirSync(
        path.dirname(previewFile),
        {
          recursive: true
        }
      );


      fs.writeFileSync(
        previewFile,
        buffer
      );


      return {
        width: 1600,
        height: 900
      };

    }

  }


  // ----------------------------------------------------------
  // 1280 × 720
  // ----------------------------------------------------------

  const fallbackQualities = [
    78,
    75,
    72,
    70
  ];


  for (
    const quality of fallbackQualities
  ) {

    const image =
      source.clone();


    image
      .resize(
        1280,
        720
      )
      .quality(
        quality
      );


    const buffer =
      await image.getBufferAsync(
        Jimp.MIME_JPEG
      );


    log(
      `Preview fallback: 1280x720 quality=${quality}, ` +
      `${Math.round(buffer.length / 1024)}KB`
    );


    if (
      buffer.length <=
        PREVIEW_MAX_SIZE ||
      quality === 70
    ) {

      fs.mkdirSync(
        path.dirname(previewFile),
        {
          recursive: true
        }
      );


      fs.writeFileSync(
        previewFile,
        buffer
      );


      return {
        width: 1280,
        height: 720
      };

    }

  }

}


// ============================================================
// 从文件读取月数据
// ============================================================

function loadMonthData(
  year,
  month
) {

  const jsonFile =
    path.join(
      DATA_ROOT,
      year,
      `${month}.json`
    );


  if (
    !fs.existsSync(
      jsonFile
    )
  ) {

    return {
      version: 1,
      year: Number(year),
      month: Number(month),
      updatedAt: null,
      items: []
    };

  }


  try {

    const data =
      JSON.parse(
        fs.readFileSync(
          jsonFile,
          "utf8"
        )
      );


    if (
      !Array.isArray(
        data.items
      )
    ) {

      data.items = [];

    }


    return data;

  } catch (error) {

    log(
      `Invalid JSON, rebuilding: ${jsonFile}`
    );


    return {
      version: 1,
      year: Number(year),
      month: Number(month),
      updatedAt: null,
      items: []
    };

  }

}


// ============================================================
// 保存月数据
// ============================================================

function saveMonthData(
  year,
  month,
  data
) {

  const dir =
    path.join(
      DATA_ROOT,
      year
    );


  fs.mkdirSync(
    dir,
    {
      recursive: true
    }
  );


  data.version = 1;
  data.year = Number(year);
  data.month = Number(month);
  data.updatedAt =
    new Date().toISOString();


  // 日期倒序
  data.items.sort(
    (a, b) =>
      b.date.localeCompare(
        a.date
      )
  );


  // 一个自然月最多 31 条
  if (
    data.items.length > 31
  ) {

    data.items =
      data.items.slice(
        0,
        31
      );

  }


  fs.writeFileSync(
    path.join(
      dir,
      `${month}.json`
    ),
    JSON.stringify(
      data,
      null,
      2
    ) + "\n",
    "utf8"
  );

}


// ============================================================
// 获取已有 item
// ============================================================

function findItem(
  monthData,
  date
) {

  return monthData.items.find(
    item =>
      item.date === date
  );

}


// ============================================================
// 创建历史 item
// ============================================================

function createItem(
  source,
  date,
  imageUrl,
  colors,
  base64,
  width,
  height
) {

  const copyright =
    source.copyright ||
    "";


  const title =
    source.title ||
    source.headline ||
    copyright ||
    "";


  const description =
    source.description ||
    source.caption ||
    source.subtitle ||
    "";


  const bingUrl =
    source.bing_url ||
    source.bingUrl ||
    "";


  const sourceImage =
    bingUrl ||
    imageUrl;


  // 当前项目使用 32 位 MD5
  const id =
    crypto
      .createHash("md5")
      .update(
        sourceImage ||
        imageUrl ||
        date
      )
      .digest("hex");


  // 历史源没有当前 Bing API 那样完整的时间字段。
  //
  // 这里使用日期推导一个稳定值。
  const startDate =
    getPreviousDate(date)
      .replace(/-/g, "");


  const fullStartDate =
    `${startDate}1600`;


  const endDate =
    date.replace(
      /-/g,
      ""
    );


  return {

    date,

    title,

    description,

    copyright,

    copyrightLink:
      bingUrl,

    image:
      `${RAW_BASE}/images/` +
      date.substring(0, 4) +
      "/" +
      date.substring(5, 7) +
      "/" +
      `${date}.jpg`,

    preview:
      `${RAW_BASE}/preview/` +
      date.substring(0, 4) +
      "/" +
      date.substring(5, 7) +
      "/" +
      `${date}.jpg`,

    sourceImage,

    base64,

    color:
      colors,

    width,

    height,

    id,

    startDate,

    fullStartDate,

    endDate

  };

}


// ============================================================
// 处理一个日期
// ============================================================

async function processItem(
  source
) {

  const date =
    normalizeDate(
      source.date
    );


  if (!date) {

    log(
      "Skipping item without valid date."
    );

    return {
      status: "skip"
    };

  }


  const year =
    date.substring(
      0,
      4
    );


  const month =
    date.substring(
      5,
      7
    );


  const imageDir =
    path.join(
      IMAGE_ROOT,
      year,
      month
    );


  const previewDir =
    path.join(
      PREVIEW_ROOT,
      year,
      month
    );


  const imageFile =
    path.join(
      imageDir,
      `${date}.jpg`
    );


  const previewFile =
    path.join(
      previewDir,
      `${date}.jpg`
    );


  const monthData =
    loadMonthData(
      year,
      month
    );


  const existing =
    findItem(
      monthData,
      date
    );


  // ----------------------------------------------------------
  // 图片地址
  //
  // Bing-Wallpaper-Archive 的 url 是它自己归档的图片，
  // 历史图片优先使用它。
  // ----------------------------------------------------------

  const imageUrl =
    source.url ||
    source.image ||
    source.bing_url;


  if (!imageUrl) {

    log(
      `[${date}] No image URL, skipped.`
    );

    return {
      status: "skip"
    };

  }


  // ----------------------------------------------------------
  // 原图
  // ----------------------------------------------------------

  let imageBuffer = null;


  if (
    fs.existsSync(
      imageFile
    )
  ) {

    log(
      `[${date}] Original image already exists.`
    );

  } else {

    log(
      `[${date}] Original image missing.`
    );


    imageBuffer =
      await downloadImage(
        imageUrl
      );


    fs.mkdirSync(
      imageDir,
      {
        recursive: true
      }
    );


    fs.writeFileSync(
      imageFile,
      imageBuffer
    );


    log(
      `[${date}] Original image saved.`
    );

  }


  // ----------------------------------------------------------
  // 如果后面需要处理图片，而原图之前就存在，
  // 这时候才从磁盘读取。
  // ----------------------------------------------------------

  if (
    !imageBuffer
  ) {

    imageBuffer =
      fs.readFileSync(
        imageFile
      );

  }


  // ----------------------------------------------------------
  // 获取图片尺寸
  // ----------------------------------------------------------

  const image =
    await Jimp.read(
      imageBuffer
    );


  const width =
    image.bitmap.width;


  const height =
    image.bitmap.height;


  // ----------------------------------------------------------
  // Preview
  // ----------------------------------------------------------

  if (
    fs.existsSync(
      previewFile
    )
  ) {

    log(
      `[${date}] Preview already exists.`
    );

  } else {

    await generatePreview(
      imageBuffer,
      previewFile
    );

    log(
      `[${date}] Preview generated.`
    );

  }


  // ----------------------------------------------------------
  // Base64
  // ----------------------------------------------------------

  let base64 =
    existing &&
    existing.base64;


  if (
    !base64
  ) {

    base64 =
      await getBase64(
        imageBuffer
      );

  }


  // ----------------------------------------------------------
  // Color
  // ----------------------------------------------------------

  let colors =
    existing &&
    existing.color;


  if (
    !colors ||
    Object.keys(colors).length === 0
  ) {

    const tempFile =
      path.join(
        process.env.RUNNER_TEMP ||
          "/tmp",
        `bing-color-${date}.jpg`
      );


    colors =
      await getMainColors(
        imageBuffer,
        tempFile
      );

  }


  // ----------------------------------------------------------
  // 如果已经存在 JSON
  //
  // 尽量保留已有字段。
  // ----------------------------------------------------------

  const item =
    createItem(
      source,
      date,
      imageUrl,
      colors,
      base64,
      width,
      height
    );


  const finalItem = {

    ...item,

    ...(existing || {}),

    // 以下字段必须以实际处理结果为准
    date,
    title:
      source.title ||
      source.headline ||
      existing?.title ||
      "",

    description:
      source.description ||
      source.caption ||
      source.subtitle ||
      existing?.description ||
      "",

    copyright:
      source.copyright ||
      existing?.copyright ||
      "",

    copyrightLink:
      source.bing_url ||
      source.bingUrl ||
      existing?.copyrightLink ||
      "",

    image:
      item.image,

    preview:
      item.preview,

    sourceImage:
      source.bing_url ||
      source.bingUrl ||
      existing?.sourceImage ||
      imageUrl,

    base64,

    color:
      colors,

    width,

    height,

    id:
      existing?.id ||
      item.id,

    startDate:
      existing?.startDate ||
      item.startDate,

    fullStartDate:
      existing?.fullStartDate ||
      item.fullStartDate,

    endDate:
      existing?.endDate ||
      item.endDate

  };


  // ----------------------------------------------------------
  // 写入月 JSON
  // ----------------------------------------------------------

  const index =
    monthData.items.findIndex(
      item =>
        item.date === date
    );


  if (
    index >= 0
  ) {

    monthData.items[index] =
      finalItem;

  } else {

    monthData.items.push(
      finalItem
    );

  }


  saveMonthData(
    year,
    month,
    monthData
  );


  log(
    `[${date}] Completed.`
  );


  return {
    status: existing
      ? "updated"
      : "added"
  };

}


// ============================================================
// 主程序
// ============================================================

async function main() {

  log(
    "========================================"
  );

  log(
    "Bing historical data backfill"
  );

  log(
    `Source: ${SOURCE_API}`
  );

  log(
    `Start date: ${START_DATE}`
  );

  log(
    `End date: ${END_DATE || "source latest"}`
  );

  log(
    "========================================"
  );


  // ----------------------------------------------------------
  // 1. 获取源 API
  // ----------------------------------------------------------

  log(
    "Fetching source API..."
  );


  const sourceData =
    await requestJson(
      SOURCE_API
    );


  // ----------------------------------------------------------
  // 2. 兼容不同 JSON 结构
  // ----------------------------------------------------------

  let sourceItems = [];


  if (
    Array.isArray(
      sourceData
    )
  ) {

    sourceItems =
      sourceData;

  } else if (
    Array.isArray(
      sourceData.items
    )
  ) {

    sourceItems =
      sourceData.items;

  } else if (
    Array.isArray(
      sourceData.images
    )
  ) {

    sourceItems =
      sourceData.images;

  } else {

    throw new Error(
      "Unsupported source JSON structure."
    );

  }


  log(
    `Source items: ${sourceItems.length}`
  );


  // ----------------------------------------------------------
  // 3. 日期过滤
  // ----------------------------------------------------------

  const startNumber =
    dateToNumber(
      START_DATE
    );


  const endNumber =
    END_DATE
      ? dateToNumber(END_DATE)
      : Number.MAX_SAFE_INTEGER;


  const items =
    sourceItems
      .map(item => {

        return {
          source: item,
          date:
            normalizeDate(
              item.date ||
              item.enddate ||
              item.endDate
            )
        };

      })
      .filter(item => {

        if (!item.date) {
          return false;
        }

        const n =
          dateToNumber(
            item.date
          );

        return (
          n >= startNumber &&
          n <= endNumber
        );

      })
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      );


  log(
    `Items after date filter: ${items.length}`
  );


  if (
    items.length === 0
  ) {

    log(
      "No items need processing."
    );

    return;

  }


  // ----------------------------------------------------------
  // 4. 统计
  // ----------------------------------------------------------

  let added = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;


  // ----------------------------------------------------------
  // 5. 逐张处理
  //
  // 故意串行。
  //
  // 原因：
  // 1. GitHub Actions 内存有限
  // 2. 每张图片需要 Jimp + Vibrant
  // 3. 避免同时请求大量历史图片
  // ----------------------------------------------------------

  for (
    let i = 0;
    i < items.length;
    i++
  ) {

    const {
      source,
      date
    } = items[i];


    log(
      `========================================`
    );


    log(
      `[${i + 1}/${items.length}] Processing ${date}`
    );


    try {

      const result =
        await processItem(
          {
            ...source,
            date
          }
        );


      if (
        result.status === "added"
      ) {

        added++;

      } else if (
        result.status === "updated"
      ) {

        updated++;

      } else {

        skipped++;

      }

    } catch (error) {

      failed++;


      console.error(
        `[${date}] FAILED:`,
        error
      );


      // 单张失败不要让整个历史任务立即停止
      // 下一张继续处理。
      //
      // 如果网络临时异常，重复执行 Action
      // 会自动补上这一张。

    }


    // 稍微降低对源服务器的请求压力
    await sleep(500);

  }


  // ----------------------------------------------------------
  // 6. 最终统计
  // ----------------------------------------------------------

  log(
    "========================================"
  );

  log(
    "Backfill finished."
  );

  log(
    `Added: ${added}`
  );

  log(
    `Updated: ${updated}`
  );

  log(
    `Skipped: ${skipped}`
  );

  log(
    `Failed: ${failed}`
  );

  log(
    "========================================"
  );


  if (
    failed > 0
  ) {

    // 有失败项时让 Action 最终显示失败，
    // 这样你可以直接看到需要重新执行。
    process.exitCode = 1;

  }

}


// ============================================================
// 启动
// ============================================================

main()
  .catch(error => {

    console.error(
      "Fatal error:",
      error
    );

    process.exit(1);

  });