type Locale = 'ja' | 'en' | 'zh'

const dict = {
  'demo.defaultUser': { ja: 'Demo User', en: 'Demo User', zh: 'Demo User' },
  'demo.disabled': { ja: 'デモでは利用できません', en: 'Not available in demo', zh: '演示模式下不可用' },
  'demo.aiDisabled': { ja: 'AI機能はセルフホスト版で利用できます', en: 'AI features require your own instance', zh: 'AI 功能需要自托管实例' },
  'demo.sampleArticle': { ja: 'サンプル記事', en: 'Sample Article', zh: '示例文章' },
  'demo.sampleArticleBody': { ja: 'これはデモ用のサンプル記事です。', en: 'This is a sample article generated for the demo.', zh: '这是为演示生成的示例文章。' },
  'demo.translateReply': {
    ja: 'これはデモ版のため、実際の AI 翻訳は生成されません。セルフホスト版では 6 つの翻訳エンジン（Anthropic / Gemini / OpenAI / DeepL / Google Translate）から選択できます。',
    en: 'This is a demo, so actual AI translations are not generated. In the self-hosted version, you can choose from 6 translation engines including Anthropic, Gemini, OpenAI, DeepL, and Google Translate.',
    zh: '这是演示版，不会生成实际的 AI 翻译。在自托管版本中，您可以从 6 种翻译引擎中选择：Anthropic、Gemini、OpenAI、DeepL 和 Google 翻译。',
  },
} as const

type DemoMessageKey = keyof typeof dict

export function getLocale(): Locale {
  const v = localStorage.getItem('locale')
  return v === 'ja' ? 'ja' : v === 'zh' ? 'zh' : 'en'
}

export function dt(key: DemoMessageKey): string {
  return dict[key][getLocale()]
}
