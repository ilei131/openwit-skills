#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""字数统计 + 跨章重复句子检查。

用法：
  python3 <skill>/scripts/check.py [--root 项目根目录]
项目根目录也可用环境变量 BOOK_ROOT 指定；默认为当前目录。
"""
import collections
import os
import re

import booklib


def split_sentences(text, min_len):
    """按句末标点切句，去掉标点后过滤过短的通用短语。"""
    out = []
    for part in re.split(r"[。！？；\n]+", text):
        s = re.sub(r"[\s\u3000\"'“”‘’（）()《》〈〉—…、，,：:]+", "", part)
        if len(s) >= min_len:
            out.append(s)
    return out


def main():
    ap = booklib.build_parser(__doc__)
    args = ap.parse_args()
    root, cfg = booklib.setup(args.root)

    files = booklib.chapter_files(root, cfg)
    if not files:
        print(f"未在 {booklib.chapters_dir(root, cfg)} 找到章节文件。")
        return

    lo, hi = cfg["word_range"]
    min_len = int(cfg["duplicate_min_len"])
    total = 0
    sent_map = collections.defaultdict(list)   # 句子 -> [章]

    print(f"{'章':<28}{'字数':>7}  状态")
    print("-" * 48)
    for fp in files:
        name = os.path.basename(fp).replace(".md", "")
        body = booklib.strip_heading(booklib.read(fp))
        n = booklib.cjk_count(body)
        total += n
        flag = "OK" if lo <= n <= hi else ("偏短" if n < lo else "偏长")
        print(f"{name:<28}{n:>7}  {flag}")
        for s in split_sentences(body, min_len):
            sent_map[s].append(name)
    print("-" * 48)
    print(f"章节数：{len(files)}　总字数（中文字符）：{total}　平均：{total // len(files)}")

    dups = {s: ch for s, ch in sent_map.items() if len(ch) > 1}
    print(f"\n跨章重复句子（长度>={min_len}字）：{len(dups)} 处")
    for s, ch in list(dups.items())[:40]:
        print(f"  - “{s}”  ← {', '.join(ch)}")

    aliases = cfg.get("term_aliases") or {}
    if aliases:
        print("\n术语检查：")
        joined = "".join(booklib.read(f) for f in files)
        hit = False
        for bad, hint in aliases.items():
            c = joined.count(bad)
            if c:
                print(f"  ⚠ 发现『{bad}』×{c}：{hint}")
                hit = True
        if not hit:
            print("  未发现别名乱用。")

    print("\n完成。")


if __name__ == "__main__":
    main()
