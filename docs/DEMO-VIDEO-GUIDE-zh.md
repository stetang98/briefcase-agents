# Demo 视频录制指南(中文版,照着做就行)

总长约 3 分钟。核心目标只有一个:**让评委在视频里清楚看到 MetaMask 弹出的
ERC-7715 Advanced Permission 授权窗口**(镜头 3)——这是所有 5 个赛道的硬性
资格证据,那一帧要停留 2~3 秒。

---

## 一、录制前准备(不录进视频)

1. **唤醒服务器:** 浏览器访问 https://briefcase-api-rekh.onrender.com/healthz
   看到 `{"ok":true}` 即可(免费层睡眠后首次要等约 50 秒)。
2. **预热一次任务:** 打开 https://briefcase-lime.vercel.app 完整跑一遍
   (连接 → 授权 → 派遣一个话题),确认整条链路是热的。正式录制时换一个新话题再跑。
3. **MetaMask 准备:** 版本 13.34.1,已解锁,切到 **Base Sepolia** 网络,选中演示账户。
4. **录屏设置(macOS):** 按 `Cmd+Shift+5` → 选"录制整个屏幕";浏览器缩放 110%;
   关掉无关标签页、通知(系统设置里开"勿扰模式")。
5. 重新打开 https://briefcase-lime.vercel.app,停在首页,开始录制。

---

## 二、分镜表:做什么 + 说什么

> 英文台词是给评委听的(评委是 MetaMask / 1Shot 团队)。
> 不想说英文的话,见第三节的三种配音方案。

| # | 你要做的操作 | 英文台词(逐字) | 中文意思(帮你理解) |
|---|---|---|---|
| 1 | 停在首页,鼠标别动 | "This is Briefcase. You grant a budget once in MetaMask, and an autonomous AI research team works for you — buying its own intelligence, data, and gas. Nothing moves without your permission, and you can revoke it in one click." | 这是 Briefcase。你在 MetaMask 里授权一次预算,一支自主 AI 研究团队就为你工作——自己购买情报、数据和 gas。没有你的许可什么都动不了,且一键可撤销。 |
| 2 | 点 **1 · Connect MetaMask**,在弹窗里确认 | "First I connect MetaMask." | 先连接 MetaMask。 |
| 3 | 点 **2 · Grant 10 USDC/day**;MetaMask 弹出 Advanced Permissions 授权窗口 → **在这个弹窗上停 2~3 秒再点确认!** | "Now the core: I grant an ERC-7715 Advanced Permission — up to 10 USDC per day. This is fine-grained, revocable spending authority, signed right in the MetaMask extension. MetaMask upgrades my account to a smart account behind the scenes." | 核心来了:我授予一个 ERC-7715 高级权限——每天最多 10 USDC。这是细粒度、可撤销的消费授权,直接在 MetaMask 插件里签名。MetaMask 在幕后把我的账户升级成智能账户。 |
| 4 | 确认授权;看到 USER 和 CHIEF 两个节点亮起 | "Granted. The chief agent now holds delegated authority." | 授权完成,主管 agent 现在持有委托权限。 |
| 5 | 在输入框输入一个话题(如 `uniswap`),点 **3 · Dispatch team** | "I dispatch the team on a topic." | 我给团队派遣一个研究话题。 |
| 6 | 看委托树:三条分支动画展开,Scout / Analyst / Designer 徽章变成 working | "Watch the budget split. The chief redelegates narrower slices to three specialists — this is agent-to-agent coordination via ERC-7710 redelegation." | 看预算被切分:主管把更小额度再委托给三个专家——这就是基于 ERC-7710 再委托的 agent 间协作。 |
| 7 | 事件流里出现 "x402 payment settled" 行 | "Each specialist pays for what it needs over x402 — premium intel, Venice AI inference — using its delegation slice. No API keys, no pre-funding. The payment settles on-chain through the MetaMask facilitator." | 每个专家用自己的委托额度通过 x402 付费购买所需——付费情报、Venice AI 推理。没有 API key,无需预充值,付款通过 MetaMask facilitator 链上结算。 |
| 8 | 报告面板渲染出来,带封面图 | "The result: a research brief, with on-chain signals and a Venice-generated cover. Venice is the brain end to end." | 成果:一份研究简报,含链上信号和 Venice 生成的封面。Venice 是端到端的大脑。 |
| 9 | (可选,加分)切到终端,展示主网 1Shot 结算的 basescan 交易页 `0x535b…276a` | "Settlement runs on Base mainnet through the 1Shot permissionless relayer — gas paid in USDC, the account upgraded via EIP-7702, zero ETH ever held. Status arrives over signed webhooks." | 结算跑在 Base 主网,通过 1Shot 无许可中继器——gas 用 USDC 支付,账户经 EIP-7702 升级,从未持有过 ETH。状态通过签名 webhook 回传。 |
| 10 | 回到界面,点 **Revoke permission (kill switch)** | "And the kill switch is real. One click cancels the run and revokes the on-chain authority — the agents physically cannot spend another cent, even if they try." | 紧急开关是真的:一键取消运行并撤销链上权限——agent 就算想花,物理上也花不出一分钱。 |
| 11 | 回到首页,定格结尾 | "Briefcase. Permission you can hand over — and take back." | Briefcase:可以交出去、也能收回来的权限。 |

镜头 9 不想弄终端的话可以直接跳过,或者只在浏览器里打开那笔主网交易的
basescan 页面停 3 秒:
https://basescan.org/tx/0x535b74786a4bff3be3fd8410521a5a6fdfce11761417df3b72fd1399a233276a

---

## 三、配音的三种方案(选一个)

1. **不开口(最简单,推荐):** 全程只录屏不录音,录完把英文台词做成字幕/
   文字卡贴上去。可以让 Claude 按你的视频时间点生成 SRT 字幕文件,
   QuickTime 录完后用 iMovie / 剪映加字幕即可。
2. **照着念英文:** 台词都是短句,逐字念就行,语速放慢;念错就停顿重念,
   后期剪掉即可(一次性录不满意很正常,大家都剪)。
3. **说中文 + 英文字幕:** 对着"中文意思"那栏用自己的话说,后期贴英文字幕。

评委只看内容是否真实可跑,口音和流利度完全不影响评分。

---

## 四、录制小贴士

- 任务跑起来 Scout→Analyst→Designer 全程约 1~2 分钟,期间正好把镜头 6/7/8 的
  台词说完;如果中途等待太长,后期把等待部分加速或剪掉。
- 万一某个 agent 失败(Venice 偶发过载已加自动重试,概率很低),停止录制,
  重新派遣一个新话题再录一遍即可。
- 录完检查:镜头 3 的 MetaMask 授权弹窗里"10 USDC / day"等细节是否清晰可读
  ——这一帧是资格证据,看不清就重录这一段。
