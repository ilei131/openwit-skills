#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""writer skill 公共库：定位书籍项目根目录、加载 book.json、发现章节。

设计要点：**脚本本身与安装位置无关**。
项目根目录按以下顺序解析：
  1. 命令行 `--root/-C DIR`
  2. 环境变量 `BOOK_ROOT`
  3. 当前工作目录
书稿配置读取 `<root>/book.json`；缺失时使用内置默认值，因此旧项目也能直接跑。

所有 writer skill 脚本都通过本模块取得路径与配置。
"""
import argparse
import glob
import json
import os
import re
import sys

CJK = re.compile(r"[\u4e00-\u9fff]")

# 内置默认值。任何一项都可以被 <root>/book.json 覆盖。
DEFAULTS = {
    # ---- 成品信息（封面 / 合成稿） ----
    "title": "未命名书稿",
    "subtitle": "",
    "author": "",
    "intro": [],
    "notice": "",
    # ---- 章节结构 ----
    "chapters_dir": "chapters",
    "chapter_glob": "第*章_*.md",
    "chapter_re": r"第(\d{2,})章_(.+)\.md$",
    "heading_format": "# 第 {n} 章 {title}",
    # ---- 验收阈值 ----
    "word_range": [4000, 5200],       # 每章中文字符数下限/上限
    "duplicate_min_len": 12,          # 判定"重复句子"的最短字符数
    "duplicate_window": 10,           # 重复片段滑动窗口字数
    "duplicate_min_chapters": 3,      # 片段跨多少章才算高频
    # ---- 书稿专属清单（通常由 book.json 提供） ----
    "volumes": [],                    # [{"name": "...", "start": 1, "end": 8}, ...]
    "expected_titles": [],            # 按章序排列的标题，用于与目录核对
    "term_aliases": {},               # {"错误写法": "应改为 ..."}
    "core_terms": [],                 # 必须出现的核心术语
    "appellations": [],               # 需要统计的称谓
    "placeholder_markers": ["待写", "TODO", "待补", "（略）", "XXX", "待续"],
    "ai_phrases": [],                 # 追加到 AI 味自查的题材专属套话
    "ai_ignore": [],                  # 有意保留的口头禅/母题，命中后跳过
    "ai_cluster_min": 2,              # 同段出现多少个不同软性词才算聚簇
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def cjk_count(text):
    return len(CJK.findall(text))


def resolve_root(override=None):
    """返回书籍项目根目录的绝对路径。"""
    for cand in (override, os.environ.get("BOOK_ROOT"), os.getcwd()):
        if cand:
            return os.path.abspath(os.path.expanduser(cand))
    return os.getcwd()


def load_config(root):
    """加载 `<root>/book.json` 并覆盖默认值。"""
    cfg = dict(DEFAULTS)
    path = os.path.join(root, "book.json")
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                user = json.load(f)
        except Exception as exc:
            sys.exit(f"[book.json] 解析失败：{path}\n  {exc}")
        if not isinstance(user, dict):
            sys.exit(f"[book.json] 顶层必须是 JSON 对象：{path}")
        cfg.update(user)
    return cfg


def setup(root_arg=None):
    """一次性返回 (root, cfg)。"""
    root = resolve_root(root_arg)
    return root, load_config(root)


def build_parser(description=None):
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--root", "-C", metavar="DIR",
                    help="书籍项目根目录（默认取 $BOOK_ROOT 或当前目录）")
    return ap


def chapters_dir(root, cfg):
    return os.path.join(root, cfg["chapters_dir"])


def chapter_files(root, cfg):
    """按章号排序的章节文件绝对路径列表。"""
    pattern = os.path.join(chapters_dir(root, cfg), cfg["chapter_glob"])
    files = glob.glob(pattern)

    def key(fp):
        m = re.match(cfg["chapter_re"], os.path.basename(fp))
        return int(m.group(1)) if m else 10 ** 9

    return sorted(files, key=key)


def parse_chapter(path, cfg):
    """从文件名解析 (章号, 标题)。"""
    base = os.path.basename(path)
    m = re.match(cfg["chapter_re"], base)
    if not m:
        return None, os.path.splitext(base)[0]
    return int(m.group(1)), m.group(2)


def strip_heading(text):
    """去掉正文首行的一级标题。"""
    lines = text.splitlines()
    if lines and lines[0].lstrip().startswith("#"):
        return "\n".join(lines[1:])
    return text


def heading(n, title, cfg):
    return cfg["heading_format"].format(n=n, title=title)


def split_body(text):
    """按空行切段（忽略分隔线 ---）。"""
    return [p.strip() for p in re.split(r"\n\s*\n", text)
            if p.strip() and p.strip() != "---"]
