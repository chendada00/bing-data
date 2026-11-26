'use strict'

const Jimp = require('jimp')

// 修改后让新生成任务识别到 Prompt 更新；历史记录不会自动覆盖，需通过 backfill 的 force 参数重生成。
const AI_STORY_PROMPT_VERSION = '1.3.0'

const SYSTEM_PROMPT = `

你是一位具有深厚文学修养、细腻情感感知力和哲学思考能力的中文散文作家。

你的任务不是简单介绍图片内容，也不是撰写摄影作品赏析，而是以图片为灵感，创作一篇具有文学美感、情感深度和人生感悟的短篇散文。

请记住：

图片是文章的起点，而不是文章的终点。
不要让文字停留在描述画面，而要从画面走进生活，从景物走向人心，从一瞬间的视觉感受延伸到关于人生、时间、情感、命运和世界的思考。

【一、核心创作理念】

你需要完成一次从视觉到精神的转化：

第一层：感知画面。
理解图片真正呈现的主体、环境、光影、色彩、姿态和氛围。

第二层：发现隐喻。
思考画面中是否存在能够与现实生活产生联系的意象。
例如：
- 一棵独自生长的树，可以让人想到孤独、坚守与生命的韧性。
- 两个彼此依偎的生命，可以让人想到陪伴、信任与相互取暖。
- 一条延伸至远方的道路，可以让人想到选择、离别与人生旅途。
- 一座被岁月包围的建筑，可以让人想到时间、记忆与人世变迁。
- 雪中的一束暖光，可以让人想到困境中的希望，以及人与人之间微小却珍贵的善意。
- 一片辽阔而空旷的海洋，可以让人想到自由、遗憾、人生的边界与内心的平静。

这些只是思考方向，不是固定模板。必须根据实际图片寻找真正自然的联系。

第三层：抵达生活。
将画面中的意象转化为对现实生活的观察。
可以写人情冷暖、相遇与离别、得失与取舍、孤独与陪伴、时间与成长、平凡与珍贵，也可以思考人与自然、人与世界之间的关系。

第四层：留下余韵。
文章不需要强行总结大道理，更不要像心灵鸡汤一样直接教育读者。
真正好的文字，应当让读者在读完之后有所触动，产生自己的联想。

【二、文学表达要求】

1. 使用优雅、克制、细腻、有质感的中文表达。
2. 可以借鉴现代文学散文的意境、节奏和表达方式，但不得模仿或引用特定作家的作品。
3. 善用隐喻、象征、对照、留白和富有画面感的语言。
4. 句式要有变化，长短句结合，避免机械、刻板的说明文表达。
5. 情感表达要含蓄，不要直接堆砌“美好、治愈、温暖、浪漫、感动”等空洞形容词。
6. 可以适度引入人情世故、生活经历和人生哲理，但必须与图片建立自然的联系。
7. 允许有文学性的想象和联想，但不能把想象写成真实发生过的事件。
8. 不要为了显得高级而堆砌生僻词、古典辞藻或晦涩句子。真正的高级感来自思想、情感和表达的准确。
9. 不要每篇文章都以“或许”“原来”“人生就是”开头，也不要反复使用相同的抒情句式。
10. 不要把所有图片都写成温暖治愈的风格。悲凉、孤独、壮阔、苍茫、欢愉、宁静都可以成为文章的情感底色。

【三、明确禁止的写作方式】

禁止将文章写成图片说明书。

不要反复介绍：
- 图片中有什么物体；
- 主体是什么颜色；
- 光线从哪个方向照射；
- 背景里有哪些景物；
- 画面采用了什么构图。

这些视觉信息只用于帮助你理解图片，不应成为文章的主要内容。

禁止使用以下套路：
- “画面中，一只……”
- “我们可以看到……”
- “这张图片展现了……”
- “从这幅画面中，我们感受到了……”
- “它仿佛在告诉我们……”
- “生活就像这张图片一样……”
- “所以我们应该珍惜当下……”

禁止写成：
- 直白的鸡汤文；
- 空洞的励志文章；
- 堆砌形容词的风景散文；
- 与图片毫无关系的泛泛人生感悟；
- 为了追求哲理而强行拔高主题。

【四、文章结构】

生成一篇约 140～220 个汉字的中文短篇散文，分为两个自然段。

第一段：
从图片中最有意味的细节或氛围切入，但不要详细介绍图片。
通过一个自然的文学意象，建立画面与某种情感、生活体验或人生境遇之间的联系。

第二段：
逐渐从画面走向更广阔的生活。
可以探讨人情冷暖、生命际遇、时间流逝、人与人之间的关系，或者其他适合这张图片的主题。
结尾要有余韵，可以是一句含蓄的感悟，也可以停留在一个富有意味的意象上。

不要求每篇文章都遵循完全相同的叙事顺序。
允许自由选择切入点和结构，避免模板化。

【五、创作质量自检】

正式输出之前，请在内部检查：

1. 如果去掉图片中的主体描述，文章是否仍然具有独立的文学价值？
2. 是否真正从画面联想到了生活，而不是换一种方式介绍图片？
3. 是否有值得回味的观点、情感或隐喻？
4. 是否避免了空洞鸡汤和刻意煽情？
5. 是否能够让读者产生“这张图片原来还可以这样理解”的感受？
6. 是否针对当前图片进行了独立创作，而不是套用了其他图片的主题？

如果文章仍然主要在描述图片，请重新构思。

【六、事实边界】

所有文学联想必须以真实可见的画面为起点。

不要臆造人物身份、亲属关系、爱情关系、历史背景、具体地点和真实事件。
不要仅凭动物靠近就判断它们是伴侣或亲子。
不要将不确定的物种、文化符号或场景解释写成确定事实。

可以借助画面进行象征性表达，但必须让读者能够感受到这是文学联想，而不是事实陈述。

【七、输出格式】

严格输出合法 JSON，不要使用 Markdown 代码块，不要添加任何解释性文字，不要在 JSON 字符串中输出未转义的换行符或多余引号。

格式如下：

{
  "title": "一个有文学意境、值得回味的短标题",
  "subtitle": "一句简洁、有情绪张力的副标题",
  "story": "第一自然段\n\n第二自然段",
  "mood": ["情绪关键词1", "情绪关键词2", "情绪关键词3"],
  "visualElements": [
    "具有象征意义的画面意象1",
    "具有象征意义的画面意象2",
    "具有象征意义的画面意象3"
  ]
}

标题应当有文学性，避免直接使用图片主体作为标题。
副标题应当凝练，不要重复标题。
mood 应当体现文章的情感基调。
visualElements 应当选取真正值得关注的画面元素，而不是简单罗列所有物体。

`

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value.replace(/\u0000/g, '').trim().slice(0, maxLength)
}

function cleanStringArray(value, max, itemMaxLength) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const raw of value) {
    const item = cleanString(raw, itemMaxLength)
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
    if (result.length >= max) break
  }
  return result
}

// 从文本中提取第一个完整 JSON 对象；支持代码围栏、前后说明和字符串内的花括号。
function extractJsonObject(text) {
  const source = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
  const start = source.indexOf('{')
  if (start < 0) throw new Error('响应中没有 JSON 对象')

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(source.slice(start, i + 1))
    }
  }
  throw new Error('响应中的 JSON 对象不完整')
}

function extractMessageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      if (typeof part?.content === 'string') return part.content
      return ''
    }).join('\n').trim()
  }
  return ''
}

function validateStory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('返回内容不是 JSON 对象')
  }
  const allowed = ['title', 'subtitle', 'story', 'mood', 'visualElements']
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  const title = cleanString(value.title, 40)
  const subtitle = cleanString(value.subtitle, 80)
  const story = cleanString(value.story, 1200)
  const mood = cleanStringArray(value.mood, 3, 12)
  const visualElements = cleanStringArray(value.visualElements, 4, 24)

  if (title.length < 2) throw new Error('标题缺失或过短')
  if (subtitle.length < 4) throw new Error('副标题缺失或过短')
  if (story.length < 60) throw new Error('故事正文过短')
  if (mood.length < 2) throw new Error('情绪关键词至少需要 2 项')
  if (visualElements.length < 2) throw new Error('画面细节至少需要 2 项')

  // 额外字段不写入数据，避免模型偶尔自行扩展 schema。
  if (unexpected.length) {
    // 不因额外字段直接失败，保留五个约定字段即可。
  }
  return { title, subtitle, story, mood, visualElements }
}

async function createImageDataUrl(imageBuffer) {
  const image = await Jimp.read(imageBuffer)
  const resized = image.clone().scaleToFit(1280, 1280).quality(80)
  return resized.getBase64Async(Jimp.MIME_JPEG)
}

function buildUserContext({ date, bing }, retry = false) {
  const metadata = {
    date: cleanString(date, 20),
    originalTitle: cleanString(bing?.title, 200),
    officialDescription: cleanString(bing?.description, 1000),
    copyright: cleanString(bing?.copyright, 400)
  }
  return [
    '请直接观察本条消息中的图片，完成视觉解读。不要只根据元数据写作。',
    '元数据仅供辅助核对；若与图片不一致，以图片中能确认的视觉事实为准。',
    JSON.stringify(metadata, null, 2),
    retry
      ? '这是一次格式纠正重试。上次输出未能通过 JSON/字段校验。请重新作答，只输出完整、可解析的 JSON 对象；不得输出解释、Markdown 或额外字段。'
      : '请严格遵守系统中的事实边界、字段长度和 JSON 格式要求。'
  ].join('\n\n')
}

function isJsonModeUnsupported(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('response_format') ||
    message.includes('json_object') ||
    message.includes('json mode') ||
    message.includes('unsupported parameter')
}

async function requestCompletion(client, request) {
  try {
    return await client.chat.completions.create(request)
  } catch (error) {
    if (!request.response_format || !isJsonModeUnsupported(error)) throw error
    const fallback = { ...request }
    delete fallback.response_format
    return client.chat.completions.create(fallback)
  }
}

function formatAIError(error) {
  const status = error?.status || error?.response?.status
  const code = error?.code
  const message = error?.message || '未知错误'

  let detail = ''

  const body = error?.error || error?.response?.data

  if (typeof body === 'string') {
    detail = body
  } else if (body && typeof body === 'object') {
    detail = body.message || body.error || body.detail || ''
  }

  if (status) {
    return [
      `HTTP：${status}`,
      `错误：${message}`,
      detail && detail !== message ? `详情：${String(detail).slice(0, 500)}` : '',
      code ? `错误代码：${code}` : ''
    ].filter(Boolean).join('\n')
  }

  return [
    code ? `错误代码：${code}` : '',
    `错误：${message}`,
    detail && detail !== message ? `详情：${String(detail).slice(0, 500)}` : ''
  ].filter(Boolean).join('\n')
}

async function generateWallpaperStory({ imageBuffer, date, bing }) {
  const apiKey = process.env.AI_API_KEY
  const baseURL = (process.env.AI_BASE_URL || 'https://api.chatanywhere.org/v1').replace(/\/+$/, '')
  const model = process.env.AI_MODEL || 'gpt-4o'
  if (!apiKey) throw new Error('AI_API_KEY is not configured')
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('A valid wallpaper image buffer is required')
  }

  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey, baseURL, timeout: 90000, maxRetries: 2 })
  const imageDataUrl = await createImageDataUrl(imageBuffer)
  let lastError

  // 仅对模型输出格式/内容问题重试一次；网络和鉴权错误交由 SDK/调用方处理。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserContext({ date, bing }, attempt > 0) },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
          ]
        }
      ],
      temperature: attempt === 0 ? 0.6 : 0.25,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    }

    const completion = await requestCompletion(client, request)
    const choice = completion?.choices?.[0]
    const content = extractMessageText(choice?.message)



    try {
      if (!content) {
        const finishReason = choice?.finish_reason || 'unknown'
        const refusal = choice?.message?.refusal

        if (finishReason === 'length') {
          throw new Error('模型未生成正文：输出 token 已耗尽（length）')
        }

        if (refusal) {
          throw new Error(`模型拒绝生成：${String(refusal).slice(0, 200)}`)
        }

        throw new Error(`模型返回空正文（停止原因：${finishReason}）`)
      }
      const parsed = extractJsonObject(content)
      const story = validateStory(parsed)
      return {
        version: 1,
        promptVersion: AI_STORY_PROMPT_VERSION,
        model: cleanString(completion?.model || model, 100),
        generatedAt: new Date().toISOString(),
        ...story
      }
    } catch (error) {
      lastError = error
      if (attempt === 0) continue
      const preview = content ? `；响应片段：${content.slice(0, 180).replace(/\s+/g, ' ')}` : ''
      throw new Error(`${error.message}${preview}`)
    }
  }
  throw lastError || new Error('AI story generation failed')
}

module.exports = {
  AI_STORY_PROMPT_VERSION,
  generateWallpaperStory,
  extractJsonObject,
  validateStory
}
