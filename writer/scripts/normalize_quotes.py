#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把章节里的英文直引号统一成中文弯引号（成对交替）。

用法：
  python3 <skill>/scripts/normalize_quotes.py [--root 项目根目录] [--dry-run]
"""
import os

import booklib


def convert(text):
    out, dq, sq = [], 0, 0
    for ch in text:
        if ch == '"':
            out.append("“" if dq % 2 == 0 else "”")
            dq += 1
        elif ch == "'":
            out.append("‘" if sq % 2 == 0 else "’")
            sq += 1
        else:
            out.append(ch)
    return "".join(out)


def main():
    ap = booklib.build_parser(__doc__)
    ap.add_argument("--dry-run", action="store_true", help="只报告，不改写")
    args = ap.parse_args()
    root, cfg = booklib.setup(args.root)

    changed = 0
    for fp in booklib.chapter_files(root, cfg):
        t = booklib.read(fp)
        if '"' not in t and "'" not in t:
            continue
        nd, ns = t.count('"'), t.count("'")
        nt = convert(t)
        if not args.dry_run:
            with open(fp, "w", encoding="utf-8") as f:
                f.write(nt)
        changed += 1
        verb = "待转换" if args.dry_run else "已转换"
        print(f'{os.path.basename(fp)}: " ×{nd}, \' ×{ns} {verb}')

    print(f"\n{changed} 个文件{'需要' if args.dry_run else '已'}处理。")


if __name__ == "__main__":
    main()
