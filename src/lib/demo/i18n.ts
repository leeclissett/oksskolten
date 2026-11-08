type Locale = 'ja' | 'en' | 'zh'

const dict = {
  'demo.defaultUser': { ja: 'Demo User', en: 'Demo User', zh: 'Demo User' },
  'demo.disabled': { ja: 'デモでは利用できません', en: 'Not available in demo', zh: '演示模式下不可用' },
  'demo.sampleArticle': { ja: 'サンプル記事', en: 'Sample Article', zh: '示例文章' },
  'demo.sampleArticleBody': { ja: 'これはデモ用のサンプル記事です。', en: 'This is a sample article generated for the demo.', zh: '这是为演示生成的示例文章。' },
} as const

type DemoMessageKey = keyof typeof dict

export function getLocale(): Locale {
  const v = localStorage.getItem('locale')
  return v === 'ja' ? 'ja' : v === 'zh' ? 'zh' : 'en'
}

export function dt(key: DemoMessageKey): string {
  return dict[key][getLocale()]
}
