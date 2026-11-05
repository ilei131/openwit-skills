#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全书统一审计：编号/标题、占位符、术语别名、核心术语、重复片段、称谓。

书稿专属清单放在 book.json：
  expected_titles / term_aliases / core_terms / appellations / placeholder_markers
缺省时只做与具体书无关的通用检查（编号连续、标题格式一致、重复片段）。

用法：python3 <skill>/scripts/audit.py [--root 项目根目录]
"""
import collections
import os
import re

import booklib


def main():
    ap = booklib.build_parser(__doc__)
    args = ap.parse_args()
    root, cfg = booklib.setup(args.root)

    files = booklib.chapter_files(root, cfg)
    if not files:
        print(f"未在 {booklib.chapters_dir(root, cfg)} 找到章节文件。")
        return

    expected = cfg.get("expected_titles") or []
    ok = True

    print("一、编号与标题")
    for i, fp in enumerate(files, 1):
        num, title = booklib.parse_chapter(fp, cfg)
        head = booklib.read(fp).splitlines()[0]
        if num != i:
            print(f"  ⚠ 编号不连续：{os.path.basename(fp)}（应为第 {i} 章）")
            ok = False
        want = booklib.heading(i, title, cfg)
        if head != want:
            print(f"  ⚠ 首行标题不符：{os.path.basename(fp)}\n"
                  f"     实际 {head!r}\n     期望 {want!r}")
            ok = False
        if expected:
            if i > len(expected):
                print(f"  ⚠ 目录缺第 {i} 章标题：{os.path.basename(fp)}")
                ok = False
            elif title != expected[i - 1]:
                print(f"  ⚠ 标题与目录不符：{os.path.basename(fp)} ≠ {expected[i-1]}")
                ok = False
    print(f"  共 {len(files)} 章；{'全部一致' if ok else '存在不一致'}")

    joined = "".join(booklib.read(f) for f in files)

    markers = cfg.get("placeholder_markers") or []
    if markers:
        print("\n二、占位符/临时内容")
        hit = False
        for bad in markers:
            if bad in joined:
                print(f"  ⚠ 残留：{bad} ×{joined.count(bad)}")
                hit = True
        if not hit:
            print("  未发现残留。")

    aliases = cfg.get("term_aliases") or {}
    if aliases:
        print("\n三、术语别名检查")
        hit = False
        for k, hint in aliases.items():
            c = joined.count(k)
            if c:
                print(f"  ⚠ 『{k}』×{c}：{hint}")
                hit = True
        if not hit:
            print("  未发现别名乱用。")

    terms = cfg.get("core_terms") or []
    if terms:
        print("\n四、核心术语出现情况（应 ≥1）")
        for t in terms:
            c = joined.count(t)
            print(f"  {t}: {c}{'' if c else '  ⚠ 未出现'}")

    win = int(cfg.get("duplicate_window", 10))
    min_ch = int(cfg.get("duplicate_min_chapters", 3))
    print(f"\n五、重复片段（{win} 字窗口，跨章 ≥{min_ch} 次）")
    grams = collections.defaultdict(set)
    for fp in files:
        txt = re.sub(r"\s", "", booklib.read(fp))
        seen = set()
        for i in range(len(txt) - win):
            g = txt[i:i + win]
            if booklib.CJK.search(g):
                seen.add(g)
        for g in seen:
            grams[g].add(os.path.basename(fp)[:6])
    dup = {g: ch for g, ch in grams.items() if len(ch) >= min_ch}
    kept = []
    for g in sorted(dup, key=len, reverse=True):
        if not any(g in k for k in kept):
            kept.append(g)
    kept = kept[:40]
    if not kept:
        print(f"  未发现跨 {min_ch} 章以上重复的 {win} 字片段。")
    for g in kept:
        print(f"  - “{g}”  ← {len(dup[g])} 章")

    apps = cfg.get("appellations") or []
    if apps:
        print("\n六、称谓统计")
        for t in apps:
            print(f"  {t}: {joined.count(t)}")


if __name__ == "__main__":
    main()
