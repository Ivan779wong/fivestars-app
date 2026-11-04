# Five Stars 每日作战 app

给 Five Stars Share 资深顾问用的手机 app：每日积分（满 20 分放工）、初恋表格 ABC 名单、晚间复盘、预约后天 appointment；leader 可以看全组进度。

- **Android**：GitHub 自动打包成 APK，在 Releases 页面下载安装。
- **iPhone**：GitHub Pages 网址用 Safari 打开 →「加入主屏幕」，桌面有图标，全屏打开，像 app 一样用。
- 两边是同一套资料：顾问用同一个 email 登入，换手机也不会丢。

---

## 第 1 步：建 GitHub 仓库并上传（约 5 分钟）

1. 登入 [github.com](https://github.com)，右上角「+」→ **New repository**。
2. Repository name 填 `fivestars-app`，选 **Public**（免费的 GitHub Pages 要 Public），按 **Create repository**。
3. 在新仓库页面按 **uploading an existing file**。
4. 把这个压缩包**解压后**的所有文件和文件夹拖进去（包括 `.github` 文件夹；电脑如果看不到它，请开启「显示隐藏文件」）。
5. 下面按 **Commit changes**。

## 第 2 步：开启 GitHub Pages（iPhone 版）

1. 仓库页面 → **Settings** → 左边 **Pages**。
2. **Source** 选 **GitHub Actions**。
3. 到 **Actions** 页面，等「Deploy to GitHub Pages」变绿勾（约 1 分钟）。
4. 网址是：`https://你的GitHub用户名.github.io/fivestars-app/`

**iPhone 安装：** 用 Safari 打开上面的网址 → 按下方「分享」→「加入主屏幕」→「加入」。

## 第 3 步：下载 Android APK

1. 到 **Actions** 页面，等「Build Android APK」变绿勾（约 5–8 分钟）。
2. 到仓库右边 **Releases** → 最新版本 → 下载 `FiveStars-Daily.apk`。
3. 把 APK 用 WhatsApp 或 Releases 链接发给顾问。安卓手机打开 APK，如果手机问「是否允许安装未知来源 app」，按允许。

以后每次在 GitHub 改代码，Android 和 iPhone 版都会自动更新：iPhone 重新打开就是新版，Android 下载新 APK 直接安装覆盖，资料不会丢。

---

## 第 4 步：开 Firebase，让全组资料同步（约 15 分钟）

**没做这一步之前，app 是「单机模式」**：资料只存在那支手机，leader 看不到。做完后，每位顾问注册账号，资料存在你的 Firebase，leader 看得到全组。

1. 到 [console.firebase.google.com](https://console.firebase.google.com) 用你的 Google 账号登入 → **建立专案**，名字填 `fivestars-app`（Google Analytics 可以关掉）。
2. **开登入功能**：左边 **Build → Authentication** → **Get started** → **Email/Password** → 开启 → 储存。
3. **开资料库**：左边 **Build → Firestore Database** → **建立资料库** → 位置选 `asia-southeast1 (Singapore)` → 选「正式版模式」。
4. **贴规则**：Firestore 里的 **Rules** 分页 → 把整个 `firestore.rules` 文件的内容贴进去，覆盖原本的 → **Publish**。
5. **设定 leader**：Firestore 的 **Data** 分页 →「开始集合」：
   - 集合 ID：`config`
   - 文件 ID：`leaders`
   - 栏位：`emails`，类型选 **array**，加入你的 email（全部小写）。其他 leader（例如 Unit Manager）的 email 也可以加进来。
6. **拿设定码**：左上角齿轮 → **专案设定** → 下面「你的应用程式」→ 按 **</>**（网页）→ 名字填 `fivestars` → 注册。画面会出现一段 `firebaseConfig = { apiKey: ..., ... }`。
7. **填进 app**：在 GitHub 仓库打开 `www/firebase-config.js` → 按铅笔图示编辑 → 把 6 个值对应贴进去 → **Commit changes**。

Commit 之后，GitHub 会自动重新打包。几分钟后：
- iPhone 版重新打开就会出现登入画面。
- Android 版请到 Releases 下载新的 APK 安装。

> `firebase-config.js` 里的设定码放在公开仓库是正常的，它不是密码。资料安全靠第 4 步的规则：每位顾问只能看和改自己的名单，只有 leaders 名单里的 email 能看全组。

---

## 顾问第一次使用

1. 安装 app（Android：APK；iPhone：Safari「加入主屏幕」）。
2. 打开 →「第一次用？注册」→ 填名字、email、密码。
3. 到「我的」填目标、起床时间、复盘时间 → 保存。
   - Android：按「设定每天起床和复盘提醒」，手机每天会准时响通知。
   - iPhone：按「加入手机日历」，用日历提醒；要闹钟铃声请在「时钟」app 设同样时间。
4. 到「名单」输入 A 10 位、B 30 位。
5. 每做到一项就在「今天」按一下记分，满 20 分放工。

Leader 用 leaders 名单里的 email 登入，下面会多一个「团队」页。

---

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `www/` | app 本身（index.html、app.js、图标） |
| `www/firebase-config.js` | Firebase 设定码（第 4 步填） |
| `firestore.rules` | 资料库权限规则（第 4 步贴到 Firebase） |
| `.github/workflows/android.yml` | 自动打包 Android APK |
| `.github/workflows/pages.yml` | 自动发布 iPhone 网页版 |
| `android-debug.keystore` | APK 签名，让新版 APK 能直接覆盖安装，请不要删除 |
| `resources/` | Android app 图标 |

关于上架：目前 Android 用 APK 直接安装，iPhone 用主屏幕版，不需要上架费用。以后想上架 Google Play（一次 US$25）或 App Store（每年 US$99，需要 Mac 打包），这套代码可以继续用。
