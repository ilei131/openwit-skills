# 脚本与 book.json 说明

skill 自带 6 个脚本，全部与安装位置无关：项目根目录由 `--root DIR`、
环境变量 `BOOK_ROOT` 或**当前工作目录**（优先级从高到低）决定。
所以既可以在书稿项目根目录直接用相对路径调用，也可以用绝对路径从任意位置调用：

```sh
# 方式一：站在项目根目录
python3 /path/to/skills/writer/scripts/check.py

# 方式二：显式指定项目根
python3 /path/to/skills/writer/scripts/check.py --root ~/books/my-novel
```

## 脚本一览

| 脚本 | 作用 | 常用参数 |
|---|---|---|
| `scripts/init_book.py` | 初始化项目骨架（00—07 模板 + book.json + chapters/） | `--root DIR`、`--force` |
| `scripts/check.py` | 每章字数 + 跨章重复句子 + 术语别名 | `--root` |
| `scripts/ai_lint.py` | AI 味自查：必改项 + 聚簇提示，输出文件:行:列 | `--root` |
| `scripts/audit.py` | 全书审计：编号/标题、占位符、术语、重复片段、称谓 | `--root` |
| `scripts/normalize_quotes.py` | 英文直引号 → 中文弯引号 | `--root`、`--dry-run` |
| `scripts/build.py` | 合成全书并导出 md / docx / pdf | `--root`、`--formats`、`--out` |

## book.json 字段

放在书稿项目根目录。**所有字段都可省略**，省略即用脚本内置默认值；
因此没有 book.json 的旧项目也能直接跑。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `title` | str | `未命名书稿` | 书名（成品文件名、封面） |
| `subtitle` | str | `""` | 副标题 |
| `author` | str | `""` | 作者/卷册说明行 |
| `intro` | str[] | `[]` | 封面简介段落 |
| `notice` | str | `""` | 创作声明/版权说明 |
| `chapters_dir` | str | `chapters` | 章节所在目录 |
| `chapter_glob` | str | `第*章_*.md` | 章节文件通配 |
| `chapter_re` | regex | `第(\d{2,})章_(.+)\.md$` | 从文件名解析章号与标题 |
| `heading_format` | str | `# 第 {n} 章 {title}` | 首行标题格式（`{n}` 为章号，`{title}` 为标题） |
| `word_range` | [int,int] | `[4000,5200]` | 每章中文字符数下限/上限 |
| `duplicate_min_len` | int | `12` | 判定"重复句子"的最短字符数 |
| `duplicate_window` | int | `10` | 重复片段滑动窗口字数 |
| `duplicate_min_chapters` | int | `3` | 片段跨多少章算高频 |
| `volumes` | obj[] | `[]` | `[{"name","start","end"}]`，空则不分卷 |
| `expected_titles` | str[] | `[]` | 按章序的标题，用于与文件名/首行核对 |
| `term_aliases` | obj | `{}` | `{"错误写法":"应改为…"}`，命中即告警 |
| `core_terms` | str[] | `[]` | 必须出现 ≥1 次的核心术语 |
| `appellations` | str[] | `[]` | 需要统计出现次数的称谓 |
| `placeholder_markers` | str[] | 常见占位词 | audit 的残留扫描词 |
| `ai_phrases` | str[] | `[]` | 追加到 AI 味自查的题材专属套话（计入 blocking） |
| `ai_ignore` | str[] | `[]` | 有意保留的口头禅/母题，命中后跳过 |
| `ai_cluster_min` | int | `2` | 同段出现多少个不同软性词才算聚簇（advisory） |

## 从旧项目迁移

旧版脚本把项目根写死为"脚本所在目录的上一级"，且把书稿专属数据（章标题、
术语别名、书名/卷名）硬编码在脚本里。迁移方式：

1. 把书稿专属数据抄进项目根的 `book.json`（可参照 `assets/book.example.json`）。
2. 改用 skill 里的 `scripts/*.py`。
3. 旧 `tools/*.py` 可保留作参考，不再需要维护。
