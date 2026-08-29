# EasyEcon

我想要做一个针对 ap 中国学生的经济刷题软件，我们的软件需要拥有的：

针对中国学生 例如：有学术名词的中英文对照，英文易混淆总结（movement&move）

界面简洁易操作

题目难度要贴合真题

AI给的答案要有较强可信度

大概结构：

按知识点分类而不是整套卷子（模考模式里可以随机按占比组成一套题）

将每个知识点的题型分为：基础题（概念）、应用题（情境）、易错题（常见坑）Phase 1 — MVP（先跑起来） 只做Unit 2（供需，权重最高、最常考）的选择题练习，把完整流程跑通：做题→提交→显示解析。

Phase 2 — 内容扩展 补全6个Unit，加入术语词典，完善解析质量。

Phase 3 — 用户系统 注册登录、错题本、学习进度追踪。

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://easyecon.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f5c36f87-53cf-4e52-b0f3-f0fd7949b5f6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
