import { createContext, useContext } from 'react'

export type Locale = 'ja' | 'en' | 'zh'

export const APP_NAME = 'Oksskolten'

const dict = {
  // Header
  'header.menu': { ja: 'メニュー', en: 'Menu', zh: '菜单'},
  'header.back': { ja: '戻る', en: 'Back', zh: '返回'},
  'header.modeSystem': { ja: 'システム', en: 'System', zh: '系统'},
  'header.modeDark': { ja: 'ダークモード', en: 'Dark', zh: '深色'},
  'header.modeLight': { ja: 'ライトモード', en: 'Light', zh: '浅色'},
  'header.title': { ja: APP_NAME, en: APP_NAME, zh: APP_NAME },

  // FeedList
  'feeds.title': { ja: 'フィード', en: 'Feeds', zh: '订阅源'},
  'feeds.inbox': { ja: 'Inbox', en: 'Inbox', zh: '收件箱'},
  'feeds.add': { ja: 'フィード', en: 'Feed', zh: '订阅源'},
  'feeds.theme': { ja: 'テーマ', en: 'Theme', zh: '主题'},
  'feeds.colorMode': { ja: 'カラーモード', en: 'Color mode', zh: '颜色模式'},
  'feeds.rename': { ja: '名前を変更', en: 'Rename', zh: '重命名'},
  'feeds.markAllRead': { ja: 'すべて既読にする', en: 'Mark all as read', zh: '全部标为已读'},
  'feeds.delete': { ja: '削除', en: 'Delete', zh: '删除'},
  'feeds.deleteFeed': { ja: 'フィードを削除', en: 'Delete Feed', zh: '删除订阅源'},
  'feeds.reEnableFeed': { ja: 'フィードを再有効化', en: 'Re-enable Feed', zh: '重新启用订阅源'},
  'feeds.deleteConfirm': {
    ja: '${name} を削除しますか？紐づく記事もすべて削除されます。',
    en: 'Delete ${name}? All associated articles will also be deleted.',
    zh: '确定删除 ${name}？所有关联的文章也将被删除。'
  },
  'feeds.reEnableConfirm': {
    ja: 'このフィードは連続エラーにより無効化されています。再有効化しますか？',
    en: 'This feed was disabled due to repeated errors. Re-enable it?',
    zh: '此订阅源因多次错误被禁用。是否重新启用？'
  },
  'feeds.enable': { ja: '有効化', en: 'Enable', zh: '启用'},
  'feeds.bookmarks': { ja: 'あとで読む', en: 'Read Later', zh: '稍后阅读'},
  'feeds.likes': { ja: 'いいね', en: 'Liked', zh: '已点赞'},
  'feeds.today': { ja: 'Today', en: 'Today', zh: '今天'},
  'feeds.history': { ja: '読んだ記事', en: 'Read', zh: '已读'},
  'feeds.fetch': { ja: 'フェッチ', en: 'Fetch articles', zh: '获取文章'},
  'category.fetchAll': { ja: 'すべてフェッチ', en: 'Fetch all feeds', zh: '获取所有订阅源'},
  'feeds.reDetect': { ja: 'RSS を再検出', en: 'Re-detect RSS', zh: '重新检测 RSS'},
  'feeds.clips': { ja: 'クリップ', en: 'Clips', zh: '剪藏'},
  'feeds.clipArticle': { ja: '記事をクリップ', en: 'Clip Article', zh: '剪藏文章'},
  'feeds.articleUrlPlaceholder': { ja: '記事のURLを入力', en: 'Enter article URL', zh: '输入文章 URL'},
  'modal.clipExistsInFeed': {
    ja: 'この記事はフィード「',
    en: 'This article already exists in feed "',
    zh: '此文章已存在于订阅源「'
  },
  'modal.clipExistsInFeedSuffix': {
    ja: '」に登録済みです',
    en: '"',
    zh: '」中'
  },
  'modal.clipViewArticle': {
    ja: '記事を見る',
    en: 'View article',
    zh: '查看文章'
  },
  'modal.clipAlreadyExists': {
    ja: 'この記事はすでにクリップに保存されています',
    en: 'This article is already saved in Clips',
    zh: '此文章已保存在剪藏中'
  },
  'modal.clipMoveToClips': { ja: 'クリップに移動', en: 'Move to Clips', zh: '移至剪藏'},

  // ArticleList
  'articles.loadError': { ja: '読み込みに失敗しました', en: 'Failed to load', zh: '加载失败'},
  'articles.retry': { ja: '再試行', en: 'Retry', zh: '重试'},
  'articles.empty': { ja: '記事がありません', en: 'No articles', zh: '暂无文章'},
  'articles.allRead': { ja: 'すべて読みました', en: 'All caught up!', zh: '全部读完了！'},
  'articles.showReadArticles': { ja: '既読記事を表示する', en: 'Show read articles', zh: '显示已读文章'},

  // FeedErrorBanner - pipeline stages
  'feedError.stage.discovery': { ja: 'RSS検出', en: 'RSS Discovery', zh: 'RSS 发现'},
  'feedError.stage.bridge': { ja: 'Bridge変換', en: 'Bridge', zh: '桥接'},
  'feedError.stage.fetch': { ja: '記事取得', en: 'Fetch', zh: '获取'},
  'feedError.stage.parse': { ja: '解析', en: 'Parse', zh: '解析'},

  // FeedErrorBanner - error explanations
  'feedError.noRssUrl': {
    ja: 'このサイトからRSSフィードのURLを検出できませんでした。サイトがRSSを提供していない可能性があります。「RSSを再検出」でRSS Bridge経由の取得を試みることができます。',
    en: 'Could not detect an RSS feed URL from this site. The site may not provide RSS. Try "Re-detect RSS" to attempt fetching via RSS Bridge.',
    zh: '无法从此站点检测到 RSS 订阅源 URL。该站点可能不提供 RSS。尝试「重新检测 RSS」以通过 RSS Bridge 获取。'
  },
  'feedError.flareSolverrFailed': {
    ja: 'このサイトはBot検出（Cloudflare等）で保護されており、突破に失敗しました。しばらく時間をおいてから「再取得」を試してください。',
    en: 'This site is protected by bot detection (e.g. Cloudflare) and bypass failed. Wait a moment and try "Retry Fetch".',
    zh: '此站点受机器人检测（如 Cloudflare）保护，绕过失败。请稍等片刻后尝试「重试获取」。'
  },
  'feedError.httpError': {
    ja: 'サーバーからHTTPエラー（{{code}}）が返されました。サイトが一時的にダウンしているか、URLが変更された可能性があります。',
    en: 'The server returned HTTP error ({{code}}). The site may be temporarily down or the URL may have changed.',
    zh: '服务器返回 HTTP 错误（{{code}}）。站点可能暂时不可用或 URL 已更改。'
  },
  'feedError.parseFailed': {
    ja: 'フィードのXMLを解析できませんでした。フィードの形式が壊れているか、RSS/Atom形式でない可能性があります。「RSSを再検出」で別のフィードソースを探すことができます。',
    en: 'Could not parse the feed XML. The feed format may be broken or not RSS/Atom. Try "Re-detect RSS" to find an alternative feed source.',
    zh: '无法解析订阅源 XML。订阅源格式可能损坏或不是 RSS/Atom 格式。尝试「重新检测 RSS」查找替代订阅源。'
  },
  'feedError.cssBridgeFailed': {
    ja: 'CSSセレクタによるスクレイピングで記事を抽出できませんでした。サイトの構造が変わった可能性があります。「RSSを再検出」でセレクタを再推論できます。',
    en: 'Failed to extract articles via CSS selector scraping. The site structure may have changed. Try "Re-detect RSS" to re-infer the selector.',
    zh: '通过 CSS 选择器抓取文章失败。站点结构可能已更改。尝试「重新检测 RSS」以重新推断选择器。'
  },
  'feedError.unknown': {
    ja: 'フィードの取得中に予期しないエラーが発生しました。しばらく待ってから「再取得」を試してください。',
    en: 'An unexpected error occurred while fetching the feed. Wait a moment and try "Retry Fetch".',
    zh: '获取订阅源时发生意外错误。请稍等片刻后尝试「重试获取」。'
  },

  // FeedErrorBanner - actions & states
  'feedError.reDetect': { ja: 'RSSを再検出', en: 'Re-detect RSS', zh: '重新检测 RSS'},
  'feedError.retry': { ja: '再取得', en: 'Retry Fetch', zh: '重试获取'},
  'feedError.processing': { ja: '記事を取得しています…', en: 'Fetching articles…', zh: '正在获取文章…'},

  // Hint banners
  'hint.today': { ja: 'あなたの行動をもとにスコアリングされたおすすめ記事。AIに「今日何読む？」と聞くこともできます。', en: 'Articles scored by your engagement. You can also ask the AI "What should I read today?"', zh: '根据您的互动评分的文章。您也可以问 AI「今天读什么？」' },
  'hint.inbox': { ja: '未読記事だけが集まるOksskoltenの玄関口。既読にするとInboxには表示されなくなります。', en: 'The front door of Oksskolten, where only unread articles live. Once marked as read, they won\'t appear in Inbox anymore.', zh: 'Oksskolten 的入口，只有未读文章。标为已读后将不再出现在收件箱中。' },
  'hint.bookmarks': { ja: '気になる記事を一旦キープ。あとで読みたいときに使えます。', en: 'Keep articles for later. A quick way to save something you want to come back to.', zh: '保留文章以便稍后阅读。快速保存您想回来看的内容。' },
  'hint.likes': { ja: 'いいねした記事がここに。検索やレコメンドのスコアリングにも反映されます。', en: 'Articles you\'ve liked live here. Likes also boost search and recommendation scoring.', zh: '您点赞的文章在这里。点赞也会提升搜索和推荐评分。' },
  'hint.clips': { ja: 'フィードを追跡するほどじゃない相手の記事を、URL指定で個別に保存できます。', en: 'Save individual articles by URL — perfect for sources you don\'t need a full feed for.', zh: '通过 URL 保存单篇文章 — 适合不需要完整订阅的来源。' },
  'hint.history': { ja: '記事を開いて読んだ履歴。「スクロールで自動既読」で流れたものは含まず、実際に開いた記事だけが残ります。', en: 'Articles you actually opened and read. Items swept away by "Auto-Mark As Read On Scroll" aren\'t included — only articles you tapped into.', zh: '您实际打开并阅读的文章。「滚动时自动标为已读」跳过的不包括在内 — 只有您点进去看的文章。' },
  'articles.showOlder': { ja: 'もっと読む（${count}件）', en: 'Show older articles (${count})', zh: '显示更早的文章（${count}）'},
  'articles.allCaughtUp': { ja: '全部読んだよ！', en: "You're all caught up!", zh: "全部读完了！"},

  // ArticleDetail
  'article.noContent': { ja: 'コンテンツがありません', en: 'No content available', zh: '暂无内容'},
  'article.sourceArticle': { ja: '元記事', en: 'Source Article', zh: '原文链接'},
  'article.notFound': { ja: '記事が見つかりませんでした', en: 'Article not found', zh: '文章未找到'},
  'article.rawMarkdown': { ja: 'マークダウン表示', en: 'Raw Markdown', zh: 'Markdown 原文'},
  'article.similarAlreadyRead': { ja: 'この記事は ${feedNames} にもあり、既に読んでいます', en: 'You already read this story from ${feedNames}', zh: '您已经从 ${feedNames} 读过这篇文章'},
  'article.similarCoveredBy': { ja: 'この記事は ${feedNames} にもあります', en: 'This story was also covered by ${feedNames}', zh: '这篇文章也被 ${feedNames} 报道过'},
  'article.similarShowSources': { ja: '${count} 件の類似記事を表示', en: 'Show ${count} similar sources', zh: '显示 ${count} 个相似来源'},
  'article.archiveImages': { ja: '画像を保存', en: 'Save Images', zh: '保存图片'},
  'article.imagesArchived': { ja: '画像保存済み', en: 'Images Saved', zh: '图片已保存'},
  'article.archivingImages': { ja: '画像を保存中...', en: 'Saving images...', zh: '正在保存图片...'},
  'article.addBookmark': { ja: '後で読む', en: 'Read later', zh: '稍后阅读'},
  'article.removeBookmark': { ja: '後で読むを解除', en: 'Remove from read later', zh: '取消稍后阅读'},
  'article.addLike': { ja: 'いいね', en: 'Like', zh: '点赞'},
  'article.removeLike': { ja: 'いいねを解除', en: 'Unlike', zh: '取消点赞'},
  'article.delete': { ja: '削除', en: 'Delete', zh: '删除'},
  'article.deleteConfirm': { ja: 'この記事を削除しますか？', en: 'Delete this article?', zh: '确定删除这篇文章？'},

  // AddModal (unified)
  'modal.addNew': { ja: 'はじめる', en: 'Get Started', zh: '开始使用'},
  'modal.addFeedOption': { ja: 'フィード', en: 'Feed', zh: '订阅源'},
  'modal.addFeedDesc': { ja: 'URLからRSSフィードを追加', en: 'Add an RSS feed from a URL', zh: '从 URL 添加 RSS 订阅源'},
  'modal.clipArticleOption': { ja: 'クリップ', en: 'Clip', zh: '剪藏'},
  'modal.clipArticleDesc': { ja: 'URLから記事を取得してクリップ', en: 'Clip an article from a URL', zh: '从 URL 剪藏文章'},
  'modal.addFolderOption': { ja: 'フォルダ', en: 'Folder', zh: '文件夹'},
  'modal.addFolderDesc': { ja: 'フィードを整理するフォルダを作成', en: 'Create a folder to organize feeds', zh: '创建文件夹来整理订阅源'},
  'modal.addFolder': { ja: 'フォルダを追加', en: 'Add Folder', zh: '添加文件夹'},
  'modal.folderNamePlaceholder': { ja: 'フォルダ名', en: 'Folder name', zh: '文件夹名称'},
  'modal.create': { ja: '作成', en: 'Create', zh: '创建'},
  'modal.creating': { ja: '作成中...', en: 'Creating...', zh: '创建中...'},

  // FeedModal
  'modal.addFeed': { ja: 'フィードを追加', en: 'Add Feed', zh: '添加订阅源'},
  'modal.url': { ja: 'URL', en: 'URL', zh: 'URL'},
  'modal.discovering': { ja: '取得中...', en: 'Fetching...', zh: '获取中...'},
  'modal.namePlaceholder': { ja: '名前（自動取得）', en: 'Name (auto-detected)', zh: '名称（自动检测）'},
  'modal.cancel': { ja: 'キャンセル', en: 'Cancel', zh: '取消'},
  'modal.adding': { ja: '追加中...', en: 'Adding...', zh: '添加中...'},
  'modal.add': { ja: '追加', en: 'Add', zh: '添加'},
  'modal.errorRssNotDetected': { ja: 'このURLからRSSフィードを検出できませんでした', en: 'RSS could not be detected for this URL', zh: '无法从此 URL 检测到 RSS'},
  'modal.errorAlreadyExists': { ja: 'このフィードは既に登録されています', en: 'This feed already exists', zh: '此订阅源已存在'},
  'modal.errorHttpOrHttpsOnly': { ja: 'http:// または https:// で始まるURLのみ対応しています', en: 'Only http:// or https:// URLs are allowed', zh: '仅支持以 http:// 或 https:// 开头的 URL'},
  'modal.genericError': { ja: 'エラーが発生しました', en: 'An error occurred', zh: '发生错误'},
  'modal.step.rssDiscovery': { ja: 'RSS 検出', en: 'RSS discovery', zh: 'RSS 发现'},
  'modal.step.flaresolverr': { ja: 'JSレンダリング', en: 'JS rendering', zh: 'JS 渲染'},
  'modal.step.rssBridge': { ja: 'RSS Bridge', en: 'RSS Bridge', zh: 'RSS 桥接'},
  'modal.step.done': { ja: 'フィード作成完了', en: 'Feed created', zh: '订阅源已创建'},
  'modal.step.completed': { ja: '完了', en: 'Completed', zh: '已完成'},
  'modal.step.found': { ja: '検出', en: 'Found', zh: '已找到'},
  'modal.step.notFound': { ja: 'この段階では未検出', en: 'Not detected at this step', zh: '此步骤未检测到'},
  'modal.step.skipped': { ja: 'スキップ', en: 'Skipped', zh: '已跳过'},
  'modal.choiceTitle': { ja: 'サイト全体のRSSフィードが見つかりました', en: 'Found a site-wide RSS feed', zh: '找到全站 RSS 订阅源'},
  'modal.choiceWholeSite': { ja: 'サイト全体を購読', en: 'Subscribe to the whole site', zh: '订阅整个站点'},

  // Settings
  'feeds.dateFormat': { ja: '日付表示', en: 'Date', zh: '日期'},
  'feeds.dateRelative': { ja: '相対', en: 'Relative', zh: '相对'},
  'feeds.dateAbsolute': { ja: '絶対', en: 'Absolute', zh: '绝对'},
  'date.justNow': { ja: 'たった今', en: 'just now', zh: '刚刚'},

  // Sidebar menu
  'sidebar.settings': { ja: '設定', en: 'Settings', zh: '设置'},

  // Settings page
  'settings.title': { ja: '設定', en: 'Settings', zh: '设置'},
  'settings.general': { ja: '一般', en: 'General', zh: '通用'},
  'settings.appearance': { ja: '外観', en: 'Appearance', zh: '外观'},
  'settings.colorMode': { ja: 'カラーモード', en: 'Color mode', zh: '颜色模式'},
  'settings.colorModeDesc': { ja: 'アプリ全体の明暗を切り替えます。「自動」はOSの設定に連動します', en: 'Switch between light and dark appearance. "Auto" follows your OS setting', zh: '在浅色和深色外观之间切换。「自动」跟随系统设置' },
  'settings.colorModeLight': { ja: 'ライト', en: 'Light', zh: '浅色'},
  'settings.colorModeDark': { ja: 'ダーク', en: 'Dark', zh: '深色'},
  'settings.colorModeAuto': { ja: '自動', en: 'Auto', zh: '自动'},
  'settings.colorTheme': { ja: '配色テーマ', en: 'Color Theme', zh: '颜色主题'},
  'settings.themeDesc': { ja: 'サイドバー・背景・アクセントカラーなどアプリ全体の配色が変わります', en: 'Changes sidebar, background, and accent colors across the entire app', zh: '更改整个应用的侧边栏、背景和强调色' },
  'settings.dateFormat': { ja: '日付表示', en: 'Date format', zh: '日期格式'},
  'settings.dateFormatDesc': { ja: '相対または絶対表示', en: 'Relative or absolute display', zh: '相对或绝对显示' },
  'settings.plugins': { ja: 'プラグイン', en: 'Plugins', zh: '插件'},
  'settings.viewer': { ja: 'フィード管理', en: 'Feeds', zh: '订阅源'},
  'settings.underDevelopment': { ja: 'この機能は現在開発中です', en: 'This feature is currently under development', zh: '此功能正在开发中'},
  'settings.profile': { ja: 'プロフィール', en: 'Profile', zh: '个人资料'},
  'settings.accountName': { ja: 'アカウント名', en: 'Account name', zh: '账户名称'},
  'settings.accountNameHint': { ja: 'このRSSリーダーアプリはあなた専用です。アカウント名はどこにも公開されないので、愛着の湧く好きな名前をつけてあげてください。', en: "This RSS reader app is just for you. Your account name won't be shown anywhere, so pick whatever feels right.", zh: "这个 RSS 阅读器只属于您。您的账户名称不会在任何地方显示，随便取个喜欢的名字就好。" },
  'settings.cancel': { ja: 'キャンセル', en: 'Cancel', zh: '取消'},
  'settings.save': { ja: '変更を保存', en: 'Save changes', zh: '保存更改'},
  'settings.saving': { ja: '保存中...', en: 'Saving...', zh: '保存中...'},

  // Reading
  'settings.imageStorage': { ja: '画像保存', en: 'Image Storage', zh: '图片存储'},
  'imageStorage.title': { ja: '画像ストレージ設定', en: 'Image Storage Settings', zh: '图片存储设置'},
  'imageStorage.desc': { ja: '記事内の画像をローカルに保存して永続化します', en: 'Save article images locally for permanent access', zh: '将文章图片保存到本地以永久访问'},
  'imageStorage.enabled': { ja: '画像保存を有効化', en: 'Enable image archiving', zh: '启用图片归档'},
  'imageStorage.enabledDesc': { ja: '有効にすると、記事ごとに画像保存ボタンが表示されます', en: 'When enabled, a save images button appears on each article', zh: '启用后，每篇文章会显示保存图片按钮'},
  'imageStorage.storagePath': { ja: '保存先パス', en: 'Storage path', zh: '存储路径'},
  'imageStorage.storagePathDesc': { ja: 'サーバー上の画像保存ディレクトリ（空欄はデフォルト）', en: 'Image storage directory on server (empty for default)', zh: '服务器上的图片存储目录（留空使用默认）'},
  'imageStorage.maxSize': { ja: '最大サイズ (MB)', en: 'Max size (MB)', zh: '最大大小（MB）'},
  'imageStorage.maxSizeDesc': { ja: '1画像あたりの最大サイズ', en: 'Maximum size per image', zh: '每张图片的最大大小'},
  'imageStorage.mode': { ja: 'ストレージモード', en: 'Storage mode', zh: '存储模式'},
  'imageStorage.modeLocal': { ja: 'ローカル', en: 'Local', zh: '本地'},
  'imageStorage.modeLocalDesc': { ja: 'サーバーのディスクに画像を保存します', en: 'Save images to the server\'s local disk', zh: '将图片保存到服务器本地磁盘'},
  'imageStorage.modeRemote': { ja: 'リモート', en: 'Remote', zh: '远程'},
  'imageStorage.modeRemoteDesc': { ja: '外部サービス（Imgur、Cloudflare Images 等）のAPIを通じて画像をアップロードし、記事内の画像URLをホスティング先に差し替えます。S3 / GCS は署名付きURLのプロキシが必要です', en: 'Upload images to external services like Imgur or Cloudflare Images via their API, replacing article image URLs with the hosted ones. S3 / GCS requires a signed-URL proxy', zh: '通过 API 将图片上传到 Imgur 或 Cloudflare Images 等外部服务，将文章图片 URL 替换为托管地址。S3/GCS 需要签名 URL 代理' },
  'imageStorage.url': { ja: 'アップロード先URL', en: 'Upload URL', zh: '上传 URL'},
  'imageStorage.urlPlaceholder': { ja: 'https://api.example.com/upload', en: 'https://api.example.com/upload', zh: 'https://api.example.com/upload'},
  'imageStorage.headers': { ja: 'リクエストヘッダー (JSON)', en: 'Request Headers (JSON)', zh: '请求头（JSON）'},
  'imageStorage.headersPlaceholder': { ja: '{"Authorization": "Bearer xxx"}', en: '{"Authorization": "Bearer xxx"}', zh: '{"Authorization": "Bearer xxx"}'},
  'imageStorage.headersConfigured': { ja: '設定済み', en: 'Configured', zh: '已配置'},
  'imageStorage.headersClear': { ja: 'ヘッダーを削除', en: 'Clear headers', zh: '清除请求头'},
  'imageStorage.fieldName': { ja: 'フィールド名', en: 'Field name', zh: '字段名'},
  'imageStorage.fieldNamePlaceholder': { ja: 'image', en: 'image', zh: 'image'},
  'imageStorage.respPath': { ja: 'レスポンスURLパス', en: 'Response URL path', zh: '响应 URL 路径'},
  'imageStorage.respPathPlaceholder': { ja: 'data.link', en: 'data.link', zh: 'data.link'},
  'imageStorage.saved': { ja: '設定を保存しました', en: 'Settings saved', zh: '设置已保存'},
  'imageStorage.test': { ja: 'テストアップロード', en: 'Test Upload', zh: '测试上传'},
  'imageStorage.testing': { ja: 'テスト中...', en: 'Testing...', zh: '测试中...'},
  'imageStorage.testSuccess': { ja: 'テスト成功', en: 'Test succeeded', zh: '测试成功'},
  'imageStorage.testFailed': { ja: 'テスト失敗', en: 'Test failed', zh: '测试失败'},
  'imageStorage.healthcheckUrl': { ja: 'ヘルスチェックURL', en: 'Healthcheck URL', zh: '健康检查 URL'},
  'imageStorage.healthcheckUrlPlaceholder': { ja: 'https://api.example.com/health', en: 'https://api.example.com/health', zh: 'https://api.example.com/health'},
  'imageStorage.healthcheckUrlDesc': { ja: '任意。設定するとリモートサービスの死活監視ができます', en: 'Optional. Configure to monitor remote service availability', zh: '可选。配置以监控远程服务可用性'},
  'imageStorage.healthcheck': { ja: 'ヘルスチェック', en: 'Healthcheck', zh: '健康检查'},
  'imageStorage.healthchecking': { ja: 'チェック中...', en: 'Checking...', zh: '检查中...'},
  'imageStorage.healthcheckOk': { ja: '正常', en: 'Healthy', zh: '正常'},
  'imageStorage.healthcheckFailed': { ja: '応答なし', en: 'Unreachable', zh: '不可达'},

  'settings.reading': { ja: '閲覧', en: 'Reading', zh: '阅读'},
  'settings.autoMarkRead': { ja: 'スクロールで自動既読', en: 'Auto-Mark As Read On Scroll', zh: '滚动时自动标为已读'},
  'settings.autoMarkReadDesc': {
    ja: 'スクロールして画面外に出た記事を自動的に既読にしますか？',
    en: 'Should articles be automatically marked as read when you scroll past them?',
    zh: '滚动经过文章时是否自动标为已读？'
  },
  'settings.autoMarkReadOn': { ja: 'オン', en: 'On', zh: '开'},
  'settings.autoMarkReadOff': { ja: 'オフ', en: 'Off', zh: '关'},
  'settings.unreadIndicator': { ja: '未読インジケーター', en: 'Unread Indicator', zh: '未读指示器'},
  'settings.unreadIndicatorDescDot': {
    ja: '記事リストに未読マーク（ドット）を表示しますか？',
    en: 'Show unread dot marks on the article list?',
    zh: '在文章列表中显示未读圆点标记？'
  },
  'settings.unreadIndicatorDescLine': {
    ja: '記事リストに未読マーク（ライン）を表示しますか？',
    en: 'Show unread line marks on the article list?',
    zh: '在文章列表中显示未读线条标记？'
  },
  'settings.unreadIndicatorOn': { ja: 'オン', en: 'On', zh: '开'},
  'settings.unreadIndicatorOff': { ja: 'オフ', en: 'Off', zh: '关'},
  'settings.showThumbnails': { ja: 'サムネイル', en: 'Thumbnails', zh: '缩略图'},
  'settings.showThumbnailsDesc': { ja: '記事一覧にサムネイル画像を表示しますか？', en: 'Show thumbnail images in the article list?', zh: '在文章列表中显示缩略图？'},
  'settings.showThumbnailsOn': { ja: 'オン', en: 'On', zh: '开'},
  'settings.showThumbnailsOff': { ja: 'オフ', en: 'Off', zh: '关'},
  'settings.showFeedActivity': { ja: 'フィードの更新状況', en: 'Feed Activity', zh: '订阅源活动'},
  'settings.showFeedActivityDesc': { ja: 'サイドバーにフィードの更新頻度やステータスを表示します', en: 'Show feed update frequency and status in the sidebar', zh: '在侧边栏显示订阅源更新频率和状态'},
  'settings.showFeedActivityOn': { ja: '表示する', en: 'Show', zh: '显示'},
  'settings.showFeedActivityOff': { ja: '表示しない', en: 'Hide', zh: '隐藏'},
  'settings.articleOpenMode': { ja: '記事の開き方', en: 'Article Open Mode', zh: '文章打开方式'},
  'settings.articleOpenModeDesc': { ja: '記事をクリックしたときの表示方法を選択します', en: 'Choose how articles are displayed when clicked', zh: '选择点击文章时的显示方式'},
  'settings.articleOpenModePage': { ja: 'ページ遷移', en: 'Full page', zh: '整页'},
  'settings.articleOpenModeOverlay': { ja: 'オーバーレイ', en: 'Overlay', zh: '覆盖层'},
  'settings.keyboardNavigation': { ja: 'キーボードナビゲーション', en: 'Keyboard Navigation', zh: '键盘导航'},
  'settings.keyboardNavigationDesc': { ja: 'j/k キーで記事リストを移動し、b でブックマーク、; で元記事を開きます', en: 'Navigate the article list with j/k, bookmark with b, and open the original article with ;', zh: '使用 j/k 导航文章列表，b 添加书签，; 打开原文' },
  'settings.keyboardNavigationOn': { ja: '有効', en: 'On', zh: '开'},
  'settings.keyboardNavigationOff': { ja: '無効', en: 'Off', zh: '关'},
  'settings.keybindings': { ja: 'キーバインド設定', en: 'Key Bindings', zh: '快捷键绑定'},
  'settings.keybindingsDesc': { ja: '各アクションに割り当てるキーを変更できます', en: 'Customize the key assigned to each action', zh: '自定义每个操作的快捷键'},
  'settings.keybindingsNext': { ja: '次の記事', en: 'Next article', zh: '下一篇文章'},
  'settings.keybindingsPrev': { ja: '前の記事', en: 'Previous article', zh: '上一篇文章'},
  'settings.keybindingsBookmark': { ja: 'ブックマーク', en: 'Bookmark', zh: '书签'},
  'settings.keybindingsOpenExternal': { ja: '元記事を開く', en: 'Open original', zh: '打开原文'},
  'settings.keybindingsDuplicate': { ja: '同じキーが複数のアクションに割り当てられています', en: 'Duplicate key assignment detected', zh: '检测到重复的快捷键分配'},
  'feeds.inactive': { ja: 'inactive', en: 'inactive', zh: '未活跃'},
  'metrics.articles': { ja: '記事', en: 'articles', zh: '篇文章'},
  'metrics.perWeek': { ja: '/週', en: '/wk', zh: '/周'},
  'metrics.lastUpdated': { ja: '最終更新', en: 'last', zh: '最近'},
  'metrics.inactive': { ja: '更新停止', en: 'inactive', zh: '未活跃'},
  'metrics.chars': { ja: '文字', en: 'chars', zh: '字符'},
  'metrics.preview': { ja: '12記事 · 2.1/週 · 3日前', en: '12 articles · 2.1/wk · 3d ago', zh: '12 篇文章 · 2.1/周 · 3 天前'},
  'settings.internalLinks': { ja: '内部リンク書き換え', en: 'Internal Link Rewriting', zh: '内部链接重写'},
  'settings.internalLinksDesc': {
    ja: `記事内のリンク先が ${APP_NAME} に存在する場合、${APP_NAME} 内リンクに書き換えます`,
    en: `Rewrite links in articles to ${APP_NAME} internal URLs when the linked article exists in your ${APP_NAME}`,
    zh: `当链接的文章存在于 ${APP_NAME} 中时，将文章中的链接重写为 ${APP_NAME} 内部 URL`
  },
  'settings.internalLinksOn': { ja: 'オン', en: 'On', zh: '开'},
  'settings.internalLinksOff': { ja: 'オフ', en: 'Off', zh: '关'},
  'settings.categoryUnreadOnly': { ja: 'カテゴリで未読のみ表示', en: 'Show Only Unread In Categories', zh: '分类中仅显示未读'},
  'settings.categoryUnreadOnlyDesc': {
    ja: 'カテゴリビューで未読記事のみを表示します（Inboxと同様の動作）',
    en: 'Show only unread articles in category views (same behavior as Inbox)',
    zh: '在分类视图中仅显示未读文章（与收件箱行为相同）'
  },
  'settings.categoryUnreadOnlyOn': { ja: 'オン', en: 'On', zh: '开'},
  'settings.categoryUnreadOnlyOff': { ja: 'オフ', en: 'Off', zh: '关'},

  // Language
  'settings.language': { ja: '言語', en: 'Language', zh: '语言'},
  'settings.languageDesc': { ja: 'UIの表示言語', en: 'Display language for UI', zh: '界面显示语言'},
  'settings.languageJa': { ja: '日本語', en: 'Japanese', zh: '日语' },
  'settings.languageEn': { ja: '英語', en: 'English', zh: '英语' },
  'settings.languageZh': { ja: '中国語', en: 'Chinese', zh: '简体中文' },

  // Data (OPML)
  'settings.data': { ja: 'データ', en: 'Data', zh: '数据'},
  'settings.importExport': { ja: 'フィード移行', en: 'Feed Migration', zh: '订阅源迁移'},
  'settings.importOpml': { ja: 'OPML インポート', en: 'Import OPML', zh: '导入 OPML'},
  'settings.importOpmlDesc': { ja: '他の RSS リーダーからフィードをインポート', en: 'Import feeds from another RSS reader', zh: '从其他 RSS 阅读器导入订阅源'},
  'settings.exportOpml': { ja: 'OPML エクスポート', en: 'Export OPML', zh: '导出 OPML'},
  'settings.exportOpmlDesc': { ja: 'フィード一覧を OPML ファイルとしてダウンロード', en: 'Download your feeds as an OPML file', zh: '将订阅源下载为 OPML 文件'},
  'settings.importing': { ja: 'インポート中...', en: 'Importing...', zh: '导入中...'},
  'settings.previewing': { ja: 'プレビュー中...', en: 'Loading preview...', zh: '加载预览...'},
  'settings.feedsSelected': { ja: '{selected} / {total} フィードを選択中（{duplicates} 件は登録済み）', en: '{selected} of {total} feeds selected ({duplicates} already subscribed)', zh: '已选择 {selected} / {total} 个订阅源（{duplicates} 个已订阅）'},
  'settings.selectAll': { ja: 'すべて選択', en: 'Select All', zh: '全选'},
  'settings.deselectAll': { ja: 'すべて解除', en: 'Deselect All', zh: '取消全选'},
  'settings.alreadySubscribed': { ja: '登録済み', en: 'Already subscribed', zh: '已订阅'},
  'settings.importSelected': { ja: '{count} フィードをインポート', en: 'Import {count} feeds', zh: '导入 {count} 个订阅源'},
  'settings.dbBackup': { ja: 'データベースバックアップ', en: 'Database Backup', zh: '数据库备份'},
  'settings.dbBackupDesc': { ja: 'SQLite データベースファイルのダウンロード・リストア', en: 'Download or restore the SQLite database file', zh: '下载或恢复 SQLite 数据库文件'},
  'settings.articlePurge': { ja: '記事の自動クリーンアップ', en: 'Article Cleanup', zh: '文章清理'},
  'settings.articlePurgeDesc': { ja: '古い記事を定期的に削除してストレージを節約', en: 'Periodically delete old articles to save storage', zh: '定期删除旧文章以节省存储'},
  'settings.comingSoon': { ja: '実装予定', en: 'Coming soon', zh: '即将推出'},
  'settings.retentionEnabled': { ja: '自動クリーンアップ', en: 'Auto cleanup', zh: '自动清理'},
  'settings.retentionReadDays': { ja: '既読記事の保持日数', en: 'Keep read articles for', zh: '保留已读文章'},
  'settings.retentionReadDaysDesc': { ja: '既読から指定日数経過した記事を削除', en: 'Delete articles after this many days since read', zh: '已读文章在指定天数后删除'},
  'settings.retentionUnreadDays': { ja: '未読記事の保持日数', en: 'Keep unread articles for', zh: '保留未读文章'},
  'settings.retentionUnreadDaysDesc': { ja: '取得から指定日数経過した未読記事を削除', en: 'Delete unread articles after this many days since fetched', zh: '未读文章在获取后指定天数删除'},
  'settings.retentionDays': { ja: '日', en: 'days', zh: '天'},
  'settings.retentionProtectedNote': { ja: 'ブックマーク・いいね済みの記事は削除されません', en: 'Bookmarked and liked articles are never deleted', zh: '书签和点赞的文章不会被删除'},
  'settings.retentionPurgeNow': { ja: '今すぐクリーンアップ', en: 'Clean up now', zh: '立即清理'},
  'settings.retentionPurgeConfirm': { ja: '{count} 件の記事を削除します。この操作は元に戻せません。よろしいですか？', en: 'This will delete {count} articles. This cannot be undone. Continue?', zh: '将删除 {count} 篇文章。此操作不可撤销。是否继续？'},
  'settings.retentionPurgeResult': { ja: '{count} 件の記事を削除しました', en: 'Deleted {count} articles', zh: '已删除 {count} 篇文章'},
  'settings.retentionEligible': { ja: '既読: {read} 件 ／ 未読: {unread} 件が対象', en: '{read} read / {unread} unread articles eligible', zh: '已读 {read} 篇 / 未读 {unread} 篇符合条件'},
  'settings.retentionPurging': { ja: 'クリーンアップ中...', en: 'Cleaning up...', zh: '清理中...'},

  // Categories
  'category.add': { ja: 'カテゴリを追加', en: 'Add category', zh: '添加分类'},
  'category.namePlaceholder': { ja: 'カテゴリ名', en: 'Category name', zh: '分类名称'},
  'category.rename': { ja: '名前を変更', en: 'Rename', zh: '重命名'},
  'category.delete': { ja: 'カテゴリを削除', en: 'Delete category', zh: '删除分类'},
  'category.deleteConfirm': {
    ja: '${name} を削除しますか？配下のフィードはトップに移動します。',
    en: 'Delete ${name}? Feeds will be moved to top.',
    zh: '确定删除 ${name}？订阅源将移至顶部。'
  },
  'category.markAllRead': { ja: 'すべて既読にする', en: 'Mark all as read', zh: '全部标为已读'},
  'category.moveToCategory': { ja: 'カテゴリに移動', en: 'Move to category', zh: '移动到分类'},
  'category.uncategorized': { ja: 'トップ', en: 'Top', zh: '顶部'},

  // Multi-select
  'feeds.selectedCount': { ja: '${count} 件選択中', en: '${count} feeds selected', zh: '已选择 ${count} 个'},
  'feeds.bulkMarkAllRead': { ja: 'すべて既読にする', en: 'Mark all as read', zh: '全部标为已读'},
  'feeds.bulkMoveToCategory': { ja: 'カテゴリに移動', en: 'Move to category', zh: '移动到分类'},
  'feeds.bulkFetch': { ja: 'フェッチ', en: 'Fetch articles', zh: '获取文章'},
  'feeds.bulkDelete': { ja: '${count} 件削除', en: 'Delete ${count} feeds', zh: '删除 ${count} 个订阅源'},
  'feeds.bulkDeleteConfirm': {
    ja: '${count} 件のフィードを削除しますか？紐づく記事もすべて削除されます。',
    en: 'Delete ${count} feeds? All associated articles will also be deleted.',
    zh: '确定删除 ${count} 个订阅源？所有关联的文章也将被删除。'
  },

  // Highlight theme
  'settings.highlightTheme': { ja: 'コードハイライト', en: 'Code Highlighting', zh: '代码高亮'},
  'settings.highlightThemeDesc': { ja: '記事内のコードブロックに適用される配色です。「自動」は配色テーマに合わせて切り替わります', en: 'Applied to code blocks in articles. "Auto" switches based on the color theme', zh: '应用于文章中的代码块。「自动」根据颜色主题切换' },
  'settings.highlightThemeAuto': { ja: '自動（テーマ連動）', en: 'Auto (follows theme)', zh: '自动（跟随主题）'},
  'settings.highlightThemeNone': { ja: 'なし', en: 'None', zh: '无'},

  // Custom themes
  'settings.customThemes': { ja: 'カスタムテーマ', en: 'Custom Themes', zh: '自定义主题'},
  'settings.customThemesDesc': { ja: 'JSON ファイルまたはテキストからテーマをインポートできます', en: 'Import themes from a JSON file or text', zh: '从 JSON 文件或文本导入主题'},
  'settings.importTheme': { ja: 'テーマをインポート', en: 'Import Theme', zh: '导入主题'},
  'settings.importFromFile': { ja: 'ファイルを選択', en: 'Choose File', zh: '选择文件'},
  'settings.importFromText': { ja: 'JSON を貼り付け', en: 'Paste JSON', zh: '粘贴 JSON'},
  'settings.importButton': { ja: 'インポート', en: 'Import', zh: '导入'},
  'settings.deleteTheme': { ja: 'テーマを削除', en: 'Delete theme', zh: '删除主题'},
  'settings.deleteThemeConfirm': { ja: 'このカスタムテーマを削除しますか？', en: 'Delete this custom theme?', zh: '确定删除此自定义主题？'},
  'settings.themeImported': { ja: 'テーマをインポートしました', en: 'Theme imported successfully', zh: '主题导入成功'},
  'settings.themeDeleted': { ja: 'テーマを削除しました', en: 'Theme deleted', zh: '主题已删除'},
  'settings.themeUpdated': { ja: 'テーマを更新しました', en: 'Theme updated successfully', zh: '主题更新成功'},
  'settings.editTheme': { ja: 'テーマを編集', en: 'Edit theme', zh: '编辑主题'},
  'settings.updateButton': { ja: '更新', en: 'Update', zh: '更新'},
  'settings.sampleButton': { ja: 'サンプル', en: 'Sample', zh: '示例'},
  'settings.themeLimit': { ja: 'カスタムテーマは最大20個までです', en: 'Maximum 20 custom themes allowed', zh: '最多允许 20 个自定义主题'},

  // Theme JSON validation errors
  'themeJson.invalidJson': { ja: '無効なJSON: オブジェクトが必要です', en: 'Invalid JSON: expected an object', zh: '无效 JSON：需要对象'},
  'themeJson.missingName': { ja: '必須フィールド "name" がありません', en: 'Missing required field: "name"', zh: '缺少必填字段："name"'},
  'themeJson.invalidName': { ja: '"name" は小文字英数字・ハイフン・アンダースコアのみ使用可能です（入力値: "${name}"）', en: '"name" must be lowercase alphanumeric, hyphens, or underscores (got "${name}")', zh: '"name" 只能使用小写字母、数字、连字符或下划线（输入值："${name}"）'},
  'themeJson.builtinConflict': { ja: '"${name}" はビルトインテーマ名と競合しています', en: '"${name}" conflicts with a built-in theme name', zh: '"${name}" 与内置主题名冲突'},
  'themeJson.duplicateName': { ja: '"${name}" という名前のカスタムテーマは既に存在します', en: 'A custom theme named "${name}" already exists', zh: '名为 "${name}" 的自定义主题已存在'},
  'themeJson.missingLabel': { ja: '必須フィールド "label" がありません', en: 'Missing required field: "label"', zh: '缺少必填字段："label"'},
  'themeJson.missingColors': { ja: '必須フィールド "colors" がありません', en: 'Missing required field: "colors"', zh: '缺少必填字段："colors"'},
  'themeJson.missingColorsVariant': { ja: '"colors.${variant}" は必須です', en: '"colors.${variant}" is required', zh: '"colors.${variant}" 为必填项'},
  'themeJson.missingColor': { ja: '必須カラー "${path}" がありません', en: 'Missing required color "${path}"', zh: '缺少必填颜色 "${path}"'},

  // Mascot
  'settings.mascot': { ja: 'マスコット', en: 'Mascot', zh: '吉祥物'},
  'settings.mascotDesc': { ja: '記事を全て読み終えたときに表示されるピクセルアートのマスコットです', en: 'Pixel art mascot shown when all articles are read', zh: '所有文章读完后显示的像素风吉祥物'},
  'settings.mascotOff': { ja: 'オフ', en: 'Off', zh: '关'},
  'settings.mascotDreamPuff': { ja: 'Dream Puff', en: 'Dream Puff', zh: 'Dream Puff'},
  'settings.mascotSleepyGiant': { ja: 'Sleepy Giant', en: 'Sleepy Giant', zh: 'Sleepy Giant'},
  'settings.mascotRequiresAutoMark': { ja: '「スクロールで自動既読」がオンのときのみ設定できます', en: 'Requires "Auto-Mark As Read On Scroll" to be enabled', zh: '需要启用"滚动时自动标为已读"'},

  // Article font
  'settings.articleFont': { ja: '記事フォント', en: 'Article Font', zh: '文章字体'},
  'settings.articleFontDesc': { ja: '記事一覧のタイトル・抜粋と記事本文に適用されます。Google Fontsから読み込むため初回表示が少し遅れる場合があります', en: 'Applied to article list titles, excerpts, and article body. Loaded from Google Fonts, so the first render may be slightly delayed', zh: '应用于文章列表标题、摘要和正文。从 Google Fonts 加载，首次渲染可能稍有延迟' },
  'settings.layout': { ja: 'レイアウト', en: 'Layout', zh: '布局'},
  'settings.layoutDesc': { ja: '記事一覧の並べ方を変更します。リスト・カード・マガジン・コンパクトから選べます', en: 'Change how articles are displayed. Choose from list, card, magazine, or compact views', zh: '更改文章显示方式。可选列表、卡片、杂志或紧凑视图' },
  'settings.layoutList': { ja: 'リスト', en: 'List', zh: '列表'},
  'settings.layoutCard': { ja: 'カード', en: 'Card', zh: '卡片'},
  'settings.layoutMagazine': { ja: 'マガジン', en: 'Magazine', zh: '杂志'},
  'settings.layoutCompact': { ja: 'コンパクト', en: 'Compact', zh: '紧凑'},

  // ConfirmDialog
  'confirm.cancel': { ja: 'キャンセル', en: 'Cancel', zh: '取消'},

  // Setup
  'setup.title': { ja: '初期設定', en: 'Initial Setup', zh: '初始设置'},
  'setup.subtitle': { ja: 'アカウントを作成して始めましょう', en: 'Create your account to get started', zh: '创建账户以开始使用'},
  'setup.confirmPassword': { ja: 'パスワード（確認）', en: 'Confirm password', zh: '确认密码'},
  'setup.submit': { ja: 'アカウントを作成', en: 'Create Account', zh: '创建账户'},
  'setup.creating': { ja: '作成中...', en: 'Creating...', zh: '创建中...'},
  'setup.passwordTooShort': { ja: 'パスワードは8文字以上にしてください', en: 'Password must be at least 8 characters', zh: '密码至少 8 个字符'},
  'setup.passwordMismatch': { ja: 'パスワードが一致しません', en: 'Passwords do not match', zh: '密码不匹配'},
  'setup.failed': { ja: 'アカウントの作成に失敗しました', en: 'Failed to create account', zh: '创建账户失败'},
  'setup.networkError': { ja: 'ネットワークエラー', en: 'Network error', zh: '网络错误'},

  // Login
  'login.title': { ja: 'ログイン', en: 'Sign in', zh: '登录'},
  'login.subtitle': { ja: 'メールアドレスでログイン', en: 'Sign in with your email', zh: '使用邮箱登录'},
  'login.email': { ja: 'メールアドレス', en: 'Email', zh: '邮箱'},
  'login.password': { ja: 'パスワード', en: 'Password', zh: '密码'},
  'login.submit': { ja: 'ログイン', en: 'Sign in', zh: '登录'},
  'login.loading': { ja: 'ログイン中...', en: 'Signing in...', zh: '登录中...'},
  'login.failed': { ja: 'ログインに失敗しました', en: 'Login failed', zh: '登录失败'},
  'login.networkError': { ja: 'ネットワークエラー', en: 'Network error', zh: '网络错误'},

  // Settings — security
  'settings.security': { ja: 'セキュリティ', en: 'Security', zh: '安全'},
  'settings.edit': { ja: '変更', en: 'Edit', zh: '编辑'},
  'settings.accountCredentials': { ja: 'アカウント情報', en: 'Account credentials', zh: '账户凭据'},
  'settings.password': { ja: 'パスワード', en: 'Password', zh: '密码'},

  // Settings — API tokens
  'settings.apiTokens': { ja: 'APIトークン', en: 'API Tokens', zh: 'API 令牌'},
  'settings.apiTokensDesc': { ja: '外部スクリプトやツールからAPIにアクセスするためのトークンを管理します', en: 'Manage tokens for accessing the API from external scripts and tools', zh: '管理用于从外部脚本和工具访问 API 的令牌'},
  'settings.createToken': { ja: 'トークンを作成', en: 'Create token', zh: '创建令牌'},
  'settings.tokenName': { ja: '名前', en: 'Name', zh: '名称'},
  'settings.tokenNamePlaceholder': { ja: '例: 監視スクリプト', en: 'e.g. Monitoring script', zh: '例如监控脚本'},
  'settings.tokenScopes': { ja: '権限', en: 'Scopes', zh: '权限范围'},
  'settings.tokenScopeRead': { ja: '読み取り専用', en: 'Read only', zh: '只读'},
  'settings.tokenScopeReadWrite': { ja: '読み書き', en: 'Read & Write', zh: '读写'},
  'settings.tokenGenerate': { ja: '生成', en: 'Generate', zh: '生成'},
  'settings.tokenCreated': { ja: 'トークンを作成しました', en: 'Token created', zh: '令牌已创建'},
  'settings.tokenCreatedCopy': { ja: 'トークンが生成されました。今すぐコピーしてください：', en: 'Your token has been generated. Copy it now:', zh: '您的令牌已生成。请立即复制：'},
  'settings.tokenOnceWarning': { ja: 'このトークンは二度と表示されません。安全な場所に保管してください。', en: 'This token will not be shown again. Store it in a safe place.', zh: '此令牌不会再次显示。请妥善保管。'},
  'settings.tokenDeleted': { ja: 'トークンを削除しました', en: 'Token deleted', zh: '令牌已删除'},
  'settings.tokenDelete': { ja: '削除', en: 'Delete', zh: '删除'},
  'settings.tokenLastUsed': { ja: '最終使用:', en: 'Last used:', zh: '上次使用：'},
  'settings.noTokens': { ja: 'APIトークンはまだありません', en: 'No API tokens yet', zh: '暂无 API 令牌'},

  // Settings — email change
  'settings.changeEmail': { ja: 'メールアドレス変更', en: 'Change Email', zh: '更改邮箱'},
  'settings.currentEmail': { ja: '現在のメールアドレス', en: 'Current email', zh: '当前邮箱'},
  'settings.newEmail': { ja: '新しいメールアドレス', en: 'New email address', zh: '新邮箱地址'},
  'settings.emailChanged': { ja: 'メールアドレスを変更しました', en: 'Email changed successfully', zh: '邮箱更改成功'},
  'settings.emailChangeFailed': { ja: 'メールアドレスの変更に失敗しました', en: 'Failed to change email', zh: '邮箱更改失败'},
  'settings.passwordForEmailChange': { ja: 'パスワード（確認用）', en: 'Password (for verification)', zh: '密码（用于验证）'},

  // Settings — password change
  'settings.changePassword': { ja: 'パスワード変更', en: 'Change Password', zh: '更改密码'},
  'settings.currentPassword': { ja: '現在のパスワード', en: 'Current password', zh: '当前密码'},
  'settings.newPassword': { ja: '新しいパスワード', en: 'New password', zh: '新密码'},
  'settings.confirmPassword': { ja: '新しいパスワード（確認）', en: 'Confirm new password', zh: '确认新密码'},
  'settings.passwordChanged': { ja: 'パスワードを変更しました', en: 'Password changed successfully', zh: '密码更改成功'},
  'settings.passwordChangeFailed': { ja: 'パスワードの変更に失敗しました', en: 'Failed to change password', zh: '密码更改失败'},
  'settings.passwordMismatch': { ja: 'パスワードが一致しません', en: 'Passwords do not match', zh: '密码不匹配'},
  'settings.passwordTooShort': { ja: 'パスワードは8文字以上にしてください', en: 'Password must be at least 8 characters', zh: '密码至少 8 个字符'},

  // Password strength
  'password.tooShort': { ja: '8文字以上必要です', en: 'At least 8 characters required', zh: '至少需要 8 个字符'},
  'password.weak': { ja: '弱い', en: 'Weak', zh: '弱'},
  'password.fair': { ja: '普通', en: 'Fair', zh: '一般'},
  'password.strong': { ja: '強い', en: 'Strong', zh: '强'},

  // Logout
  'sidebar.logout': { ja: 'ログアウト', en: 'Log out', zh: '退出登录'},

  // Command Palette
  'command.navigation': { ja: 'ナビゲーション', en: 'Navigation', zh: '导航'},
  'command.actions': { ja: 'アクション', en: 'Actions', zh: '操作'},
  'command.feeds': { ja: 'フィード', en: 'Feeds', zh: '订阅源'},
  'command.appearance': { ja: '外観', en: 'Appearance', zh: '外观'},
  'command.placeholder': { ja: 'コマンドを入力...', en: 'Type a command or search...', zh: '输入命令或搜索...'},
  'command.noResults': { ja: '結果が見つかりません', en: 'No results found.', zh: '未找到结果。'},
  'command.searchArticles': { ja: '記事を検索', en: 'Search articles', zh: '搜索文章'},
  'command.addFeed': { ja: 'フィードを追加', en: 'Add new feed', zh: '添加新订阅源'},
  'command.importOpml': { ja: 'OPML インポート', en: 'Import OPML', zh: '导入 OPML'},
  'command.exportOpml': { ja: 'OPML エクスポート', en: 'Export OPML', zh: '导出 OPML'},

  // Search
  'search.title': { ja: '検索', en: 'Search', zh: '搜索'},
  'search.placeholder': { ja: '記事を検索...', en: 'Search articles...', zh: '搜索文章...'},
  'search.noResults': { ja: '一致する記事がありません', en: 'No matching articles', zh: '没有匹配的文章'},
  'search.indexBuilding': { ja: '検索インデックスを構築中です…', en: 'Building search index…', zh: '正在构建搜索索引…'},
  'search.hint': { ja: '↑↓ 移動 · Enter 開く · Esc 閉じる', en: '↑↓ navigate · Enter open · Esc close', zh: '↑↓ 导航 · Enter 打开 · Esc 关闭'},
  'search.filterBookmarked': { ja: 'あとで読む', en: 'Read Later', zh: '稍后阅读'},
  'search.filterLiked': { ja: 'いいね', en: 'Liked', zh: '已点赞'},
  'search.filterUnread': { ja: '未読', en: 'Unread', zh: '未读'},
  'search.period.today': { ja: '今日', en: 'Today', zh: '今天'},
  'search.period.week': { ja: '1週間', en: 'Week', zh: '周'},
  'search.period.month': { ja: '1ヶ月', en: 'Month', zh: '月'},

  // About
  'settings.about': { ja: 'About', en: 'About', zh: '关于'},
  'about.version': { ja: 'バージョン', en: 'Version', zh: '版本'},
  'about.github': { ja: 'GitHub', en: 'GitHub', zh: 'GitHub'},
  'about.issues': { ja: 'フィードバック', en: 'Feedback', zh: '反馈'},
  'about.commit': { ja: 'コミット', en: 'Commit', zh: '提交'},
  'about.buildDate': { ja: 'ビルド日時', en: 'Build Date', zh: '构建日期'},

  // Toast
  'toast.fetchedArticles': { ja: '${name}: ${count}件の新しい記事を取得', en: '${name}: Fetched ${count} new articles', zh: '${name}：获取了 ${count} 篇新文章'},
  'toast.noNewArticles': { ja: '${name}: 新着なし', en: '${name}: No new articles', zh: '${name}：无新文章'},
  'toast.fetchError': { ja: '${name}: フェッチに失敗しました', en: '${name}: Fetch failed', zh: '${name}：获取失败'},
  'toast.newVersion': { ja: '新しいバージョンが利用可能です', en: 'A new version is available', zh: '有新版本可用'},
  'toast.reload': { ja: '更新', en: 'Reload', zh: '重新加载'},
} as const

type MessageKey = keyof typeof dict

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const defaultLocale: Locale = navigator.language.startsWith('ja') ? 'ja' : navigator.language.startsWith('zh') ? 'zh' : 'en'

function resolveLocale(): Locale {
  const stored = localStorage.getItem('locale')
  if (stored === 'ja' || stored === 'en' || stored === 'zh') return stored
  return defaultLocale
}

/** Translate outside React tree (resolves locale from localStorage) */
export function translate(key: MessageKey): string {
  return dict[key][resolveLocale()]
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
})

export type TranslateFn = (key: MessageKey, params?: Record<string, string>) => string

/** Check whether a string is a valid i18n message key. */
export function isMessageKey(key: string): key is MessageKey {
  return key in dict
}

export function useI18n() {
  const { locale, setLocale } = useContext(LocaleContext)
  const t = (key: MessageKey, params?: Record<string, string>): string => {
    let text: string = dict[key][locale]
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`\${${k}}`, v)
      }
    }
    return text
  }
  return { t, locale, setLocale } as const
}
