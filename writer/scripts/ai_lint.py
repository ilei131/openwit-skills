#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 味自查：套路词/句式、句首重复、段落整齐度。

这是"机械感提示器"，不是检测器：命中多不等于会被判 AI，命中少也不保证过检。
可在 book.json 的 "ai_phrases" 里追加题材专属的套话。

用法：python3 <skill>/scripts/ai_lint.py [--root 项目根目录]
"""
import collections
import re

import booklib

# 常见"AI 腔"套路词/句式（可按题材增删）
DEFAULT_PHRASES = [
    "不仅仅是", "而是", "与此同时", "然而", "总而言之", "综上所述",
    "仿佛在诉说", "无声地诉说", "命运的齿轮", "时代的洪流", "历史的尘埃",
    "宛如", "一抹", "泛起涟漪", "空气中弥漫", "不知过了多久", "不知从何时起",
    "嘴角勾起", "眼神深邃", "意味深长", "在这一刻", "那一刻", "不禁", "不由自主",
    "缓缓地", "深深地", "轻轻地", "静静地", "微微地", "淡淡地",
    "璀璨", "熠熠生辉", "交织", "勾勒", "画卷", "篇章", "涟漪", "氤氲",
    "心中五味杂陈", "涌上心头", "百感交集", "无法言喻", "难以言表",
    "如同", "恰似", "恍若", "似乎", "好像", "大概是",
]

OPEN_STOP = set("的了是在他她它我你们和与而就都也又很不这那有被把上下里".split())


def main():
    ap = booklib.build_parser(__doc__)
    args = ap.parse_args()
    root, cfg = booklib.setup(args.root)

    files = booklib.chapter_files(root, cfg)
    if not files:
        print(f"未在 {booklib.chapters_dir(root, cfg)} 找到章节文件。")
        return

    phrases = list(DEFAULT_PHRASES)
    for p in cfg.get("ai_phrases", []):
        if p not in phrases:
            phrases.append(p)

    total = 0
    counts = collections.Counter()
    hit_files = collections.defaultdict(set)   # 词 -> 出现的章
    openers = collections.Counter()
    para_lens = []

    for fp in files:
        num, _ = booklib.parse_chapter(fp, cfg)
        label = f"第{num:02d}章" if num else fp
        txt = booklib.read(fp)
        total += booklib.cjk_count(txt)
        for ph in phrases:
            c = txt.count(ph)
            if c:
                counts[ph] += c
                hit_files[ph].add(label)
        # 句首两字统计
        for sent in re.split(r"[。！？\n]+", txt):
            sent = sent.strip("　 “”‘’")
            if len(sent) >= 6:
                openers[sent[:2]] += 1
        # 段长
        for para in re.split(r"\n\s*\n", txt):
            n = booklib.cjk_count(para)
            if n:
                para_lens.append(n)

    print(f"扫描 {len(files)} 章，共 {total} 中文字符\n")

    print("一、套路词/句式命中（词 × 次数 × 涉及章数）")
    if not counts:
        print("  无命中。")
    for ph, c in counts.most_common():
        warn = "  ⚠ 高频" if c >= 15 or len(hit_files[ph]) >= 8 else ""
        print(f"  {ph}：{c} 次 / {len(hit_files[ph])} 章{warn}")

    print("\n二、句首重复 Top 15（同一开头过多 = 节奏单调）")
    for w, c in openers.most_common(15):
        if w not in OPEN_STOP:
            print(f"  “{w}…”：{c} 次")

    print("\n三、段落长度分布（过于均匀 = 结构机械）")
    if para_lens:
        import statistics
        avg = statistics.mean(para_lens)
        sd = statistics.pstdev(para_lens)
        print(f"  段数 {len(para_lens)}；均长 {avg:.1f} 字；标准差 {sd:.1f}")
        print("  → 标准差越大越自然；若 <6，考虑故意插入超短句/长句。")

    print("\n提示：本脚本只标'机器腔'，不判'是否 AI'。请人工把命中处改成有具体细节、")
    print("     带个人口吻与停顿的表达；同一比喻全文不超过 2—3 次。")


if __name__ == "__main__":
    main()
