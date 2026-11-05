---
name: "writer"
version: 1.2.0
display_name: 长文档写作框架
display_name_en: Long-Form Writing Framework
description: >
  用于撰写长文档（书籍、手册、课程、系列文章等）的可分发执行框架。
  核心逻辑：先建总纲 → 逐章执行「读总纲→生成提纲→写正文→查重→更新进度与连续性→验收」
  → 每章通过才进下一章 → 全书完成后统一审计 → 导出 Word/PDF。
  自带与安装位置无关的质检脚本（字数/查重/AI 味/审计/引号归一/合成导出），
  书稿专属数据由项目根目录的 book.json 提供。
  触发：写书、写手册、写课程、写系列文章、长篇写作、逐章续写、书稿质检与导出。
  Invoke when the user wants to write a book, manual, course, or any long-form document,
  or to audit, continue, or export an existing manuscript.
description_zh: 面向书籍、手册、课程、系列文章等长文档的自包含写作框架：先搭总纲与写作规范，再按「读总纲→生成提纲→写正文→查重→更新进度与连续性→逐章验收」循环推进，章章通过后统一审计并导出 md/Word/PDF；内置字数、跨章查重、AI 味自查、术语/占位符审计、引号归一与成品合成脚本，书稿专属配置集中于 book.json。适用于中长篇创作、连载续写、多人协作与旧稿整理；不适用于短文案与单篇营销稿。
description_en: A self-contained long-form writing framework for books, manuals, courses, and serialized articles. It scaffolds the outline and style rules, then runs a six-step per-chapter loop (read outline → plan scenes → draft → dedupe → update progress and continuity → accept), followed by a whole-book audit and md/docx/pdf export. Position-independent QC scripts cover word count, cross-chapter repetition, AI-tone lint, terminology and placeholder audit, quote normalization, and final assembly. Book-specific settings live in book.json. Best for multi-chapter works, serialized continuation, and collaborative drafting; not for short copy or one-off marketing posts.
---

# 写书执行框架：让 Agent 按固定流程逐章完成长文档，不跑偏、不重复

本 skill 自包含：**脚本、模板、细则全部在 skill 目录内**，可直接复制分发到任意项目。

## 包结构

```
writer/
├── SKILL.md              本文件：操作总纲
├── scripts/              与安装位置无关的脚本（见 references/book-config.md）
│   ├── booklib.py            公共库：定位项目根、加载 book.json、发现章节
│   ├── init_book.py          初始化项目骨架（00—07 + book.json + chapters/）
│   ├── check.py              每章字数 + 跨章重复句子 + 术语别名
│   ├── ai_lint.py            AI 味自查：必改项 + 聚簇提示，输出文件:行:列
│   ├── audit.py              全书审计：编号/标题、占位符、术语、重复片段、称谓
│   ├── normalize_quotes.py   英文直引号 → 中文弯引号
│   └── build.py              合成全书并导出 md / docx / pdf
├── references/           长文档细则，按需查阅
│   ├── workflow.md           逐章循环、验收、全书审计、容错自愈、导出的展开版
│   ├── anti-ai.md            降低"AI 味"的完整指南（含合规提醒）
│   └── book-config.md        脚本用法与 book.json 字段表
└── assets/
    ├── book.example.json     配置样例
    └── templates/            00—07 空白模板
```

> 路径约定：本文件内所有 `scripts/…`、`references/…`、`assets/…` 路径都**相对于
> 本文件所在目录**（skill 基准目录）。脚本运行时则相对**书稿项目根目录**。

## 一、如何使用（首次）

1. 把 skill 目录放到任意位置即可（OpenCode 可放 `.opencode/skills/writer/`，
   Trae 可放 `.trae/skills/writer/`，或经 `skills` 配置挂载的外部目录）。
2. 进入目标书稿项目目录，运行初始化：

   ```sh
   python3 <skill目录>/scripts/init_book.py
   ```

   它会在**当前目录**铺好 `00_总纲.md` … `07_写作任务说明.md`、`book.json`、`chapters/`
   （已存在的文件默认跳过，加 `--force` 覆盖）。
3. 若已有旧项目，只需在项目根目录新建 `book.json`（参照 `assets/book.example.json`
   与 `references/book-config.md`），脚本即可直接工作——**所有字段都可省略**。

所有脚本的项目根目录解析顺序：`--root DIR` → 环境变量 `BOOK_ROOT` → 当前目录。

## 二、前置文件（第 0 步产出）

| 文件名 | 内容 |
|--------|------|
| `00_总纲.md` | 书名、目标读者、全书定位、核心问题、分卷结构 |
| `01_目录.md` | 每章标题 + 一句话说明该章解决什么 |
| `02_写作规范.md` | 语言风格、视角、段落长度、人物声音、禁忌清单 |
| `03_术语表.md` | 全书统一术语、固定定义、固定称谓 |
| `04_验收标准.md` | 每章必须满足的验收条件 |
| `05_进度跟踪.md` | 章节状态（待写/写作中/待验收/已完成） |
| `06_连续性档案.md` | 滚动台账：实体台账、分章状态卡、承诺/伏笔台账、滚动摘要 |
| `07_写作任务说明.md` | 逐章执行的固定规程（可直接交给子代理） |
| `book.json` | 脚本配置（书名/卷结构/字数区间/术语别名等） |
| `chapters/` | 每章一个文件，`第NN章_标题.md` |

## 三、第 0 步：搭建总纲（文件缺失时执行）

提示词模板（Agent 自动填充书名等信息）：

```
请为主题《<书名>》搭建长篇写作总纲，只产出文件，不要开始写正文。
主题信息：目标读者=<…>；体裁=<…>；篇幅=<总字数与章节数>；风格=<…>；必须包含的要点=<…>。

请生成：
- 00_总纲.md      书名、定位、核心问题、结构总览、主题落点
- 01_目录.md      全部章节标题 + 每章一句话作用
- 02_写作规范.md  文体、视角、段落长度、每章字数、人物/术语声音、禁忌清单、文件命名
- 03_术语表.md    全书固定术语及定义（含统一称谓）
- 04_验收标准.md  每章必须满足的硬性指标
- 05_进度跟踪.md  章节状态表
- 06_连续性档案.md 基础设定 + 实体台账 + 分章状态卡 + 承诺/伏笔台账 + 滚动摘要
- book.json       把 01 的章标题填入 expected_titles，配好 volumes / word_range / term_aliases

要求：术语必须唯一、可检索；章节目标要写成"可验收"的句子；先把规则定死，再动笔。
```

**各文件写法要点**

- `00_总纲.md`：一页说清"这本书解决什么问题、给谁看、分几部分"，核心问题写成一句问句。
- `01_目录.md`：每章标题后跟一句"本章解决什么/推进什么"。
- `02_写作规范.md`：把"风格"翻译成**可检查的规则**（字数、段长、比例、禁忌）。
- `03_术语表.md`：两列表（术语/定义+备注），并列出**固定称谓**。
- `04_验收标准.md`：勾选清单，逐条可判定"是/否"。
- `book.json`：见 `references/book-config.md`。

**完成后**：把结果简述给用户，等确认后进入第 1 章；用户授权"不停"则直接继续。

## 四、核心循环：逐章执行

### 写前门槛（硬性）

首次开工前，先把 `00/01/02/03/04` 全文读一遍并确认。之后每章按下表读；**缺文件或没读完就停，先报准确路径，不得先写正文再补读**。每个任务、每个会话重新读；表中限定"相关节/相关条目"的，按限定读，其余整份读到结尾。

| 时刻 | 必读 | 按需读 |
|---|---|---|
| 写一章 | `04_验收标准.md` 全文；`01_目录.md` 本章条目；`02_写作规范.md` 的文体/视角/禁忌相关节；`06` 滚动摘要 + 最新章节状态卡 | `03` 本章涉及的术语；`06` 相关实体台账与承诺/伏笔台账 |
| 续写 / 日更 | `05` 当前状态；`06` 滚动摘要 + 状态卡 + 台账；上一章正文结尾 | 本章细纲、相关设定 |
| 改稿 / 去 AI 味 | 被改章原文；`04` 改稿附加验收；`06` 相关状态卡与台账 | `02` 声音规范、`03` 术语 |
| 全书审计 | `00/01/04`；`06` 承诺/伏笔台账 | `03` 术语表、`05` 进度表 |

对**每一章**，严格按顺序完成六步；任意一步不通过都不得进入下一章。

1. **读门槛**：按上表读完必读项；缺文件或没读完即停。
2. **生成提纲**：拆成 3—6 个场景/小节，标明每节**目标、冲突、结尾**与本章结尾钩子。
3. **写正文**：按 `02_写作规范.md` 成文 → `chapters/第NN章_标题.md`，首行 `# 第 N 章 标题`。
4. **检查重复**：跑 `scripts/check.py`，发现重复**必须改写**后再继续。
5. **更新进度与连续性**：写 `05_进度跟踪.md`；在 `06_连续性档案.md` 补本章状态卡、更新实体台账与承诺/伏笔台账、更新滚动摘要。
6. **本章验收**：对照 `04_验收标准.md` 逐条核对，全过 → "已完成"；否则回到第 3 步。

> 只有当前章"已完成"，才允许开始下一章。

每章必须齐备五要素：**开场钩子 / 明确目标 / 有效冲突 / 人物(内容)变化 / 结尾推进**。
展开版见 `references/workflow.md`。

## 五、改稿与回炉模式（改第 X 章 / 重写 / 去 AI 味）

用户要求"改第 X 章""重写""去 AI 味""回炉"时，**不走顺序写作循环**，按以下步骤：

1. **确认范围**：只改表达 / 允许结构调整 / 允许改剧情。范围不明就问；未授权不得改事件、动机、结果或人物选择。
2. **备份原稿**：把被改章复制到项目根目录 `work/改前原稿/{YYYYMMDD}_{原文件名}.md`，改后回读对照。
3. **读相关记忆**：按上表"改稿/去 AI 味"行读取；只读本章相关条目，不整读全书。
4. **执行改动**：
   - 只改表达时，事实、人物选择、因果、伏笔、揭露顺序一律不动；不得新增事实、人物、数字、引文，也不得用新微动作/粗话硬造"真人感"。
   - 剧情级改动必须单独标注，并同步更新 `06` 状态卡、实体台账、承诺/伏笔台账与滚动摘要。
5. **复检**：重跑 `check.py` 与 `ai_lint.py`，`blocking` 清零或全部在 `ai_ignore` 中登记；对照 `04` 的"改稿附加验收"逐条核对。
6. **汇报**：说明改了哪几处、为什么改、哪些没有动、仍需授权的剧情缺口；不把规则名和脚本字段当评价。

> 目录与文件名不变；改稿后仍要满足当章字数区间与连续性台账。

## 六、质检脚本（在书稿项目根目录运行）

| 时机 | 命令 | 看什么 |
|---|---|---|
| 每章写完 | `python3 <skill>/scripts/check.py` | 字数是否 `OK`；跨章重复句子是否为 0 |
| 每章写完 | `python3 <skill>/scripts/ai_lint.py` | `blocking` 必改（带文件:行:列）；`advisory` 看聚簇；段长标准差 <6 需打散 |
| 全书完成 | `python3 <skill>/scripts/audit.py` | 编号/标题/术语/占位符/重复片段/称谓 |
| 格式统一 | `python3 <skill>/scripts/normalize_quotes.py --dry-run` | 英文直引号残留；确认后去掉 `--dry-run` |
| 导出成品 | `python3 <skill>/scripts/build.py` | 生成 `书名.md` / `.docx` / `.pdf` |

判定标准与处理见 `references/workflow.md` 第三节；AI 味改写见 `references/anti-ai.md`。

## 七、全书完成后的统一审计

跑 `scripts/audit.py`，逐项确认：

1. **编号与标题**：章序号连续、文件名与标题、首行标题与 `01_目录.md` 全部一致。
2. **术语**：无别名乱用、无中途改名。
3. **重复**：跨章重复句子与高频片段已处理（保留者须是有意呼应）。
4. **格式**：引号、标点、数字、章节分隔统一。
5. **占位符**：`待写/TODO/待补/（略）` 等无残留。
6. **承诺/伏笔回收**：对照 `06` 台账逐条确认，超 15 章未推进项已回收或明确废弃。
7. **连续性档案**：状态卡、实体台账、滚动摘要与正文一致。
8. **时间线**：跨章核对季节、日期、人物状态。

发现问题 → 就地修复 → 重跑脚本，直到干净，再导出。

## 八、导出与长任务策略

- 导出用 `scripts/build.py`（md/docx/pdf）。依赖 `pip install python-docx reportlab`，
  导出后**抽样渲染一页**确认中文不乱码、分页正常。
- 长任务：用户授权"一次性写完"时，中途问题自行修复后继续，只在最后统一汇报；
  把"读资料→写本章→查重→登记"打包成固定指令交给子代理逐章执行，主控只维护
  `05/06`；会话中断时先跑 `audit.py` 定位缺口再补齐。

> **一句话总纲**：先定规则，再逐章推进；每章"读→写→查重→登记→验收"，章章过关；
> 全书做完统一审计，再导出成品。
