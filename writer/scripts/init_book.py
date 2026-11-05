#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""初始化一个书籍项目骨架：00—07 模板 + book.json + chapters/。

把 skill 自带的空白模板铺到目标目录，供第 0 步"搭建总纲"填写。
已存在的文件默认跳过（不会覆盖你的内容）；加 --force 才覆盖。

用法：
  python3 <skill>/scripts/init_book.py [--root 目标目录] [--force]
"""
import argparse
import os
import shutil

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
TEMPLATES = os.path.join(ASSETS, "templates")
EXAMPLE = os.path.join(ASSETS, "book.example.json")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", "-C", metavar="DIR",
                    help="目标目录（默认当前目录）")
    ap.add_argument("--force", action="store_true", help="覆盖已存在的文件")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.root or os.getcwd()))
    os.makedirs(root, exist_ok=True)

    created, skipped = [], []

    # 1) 00—07 模板
    for name in sorted(os.listdir(TEMPLATES)):
        src = os.path.join(TEMPLATES, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(root, name)
        if os.path.exists(dst) and not args.force:
            skipped.append(name)
            continue
        shutil.copyfile(src, dst)
        created.append(name)

    # 2) book.json
    dst = os.path.join(root, "book.json")
    if os.path.exists(dst) and not args.force:
        skipped.append("book.json")
    else:
        shutil.copyfile(EXAMPLE, dst)
        created.append("book.json")

    # 3) chapters/
    ch = os.path.join(root, "chapters")
    if not os.path.isdir(ch):
        os.makedirs(ch)
        created.append("chapters/")

    print(f"目标目录：{root}")
    for f in created:
        print(f"  ＋ 创建 {f}")
    for f in skipped:
        print(f"  · 跳过（已存在）{f}")
    print("\n下一步：")
    print("  1. 编辑 00_总纲.md / 01_目录.md / 02_写作规范.md / 03_术语表.md / 04_验收标准.md")
    print("  2. 把 01_目录.md 的章标题填入 book.json 的 expected_titles，并按需配置")
    print("  3. 逐章写入 chapters/第NN章_标题.md，然后运行 check.py / audit.py")


if __name__ == "__main__":
    main()
