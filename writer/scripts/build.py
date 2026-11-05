#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把各章合成为全书，并导出 Markdown / Word(docx) / PDF。

书名、副标题、作者、卷结构、简介、创作声明均取自 book.json。

用法：
  python3 <skill>/scripts/build.py [--root 项目根目录]
                                   [--formats md,docx,pdf] [--out 输出目录]
依赖：pip install python-docx reportlab
"""
import argparse
import hashlib
import os
import re

# 兼容：新版 reportlab 调用 hashlib.md5(usedforsecurity=False)，旧 Python/OpenSSL 不支持
_orig_md5 = hashlib.md5


def _md5_compat(*args, **kwargs):
    kwargs.pop("usedforsecurity", None)
    return _orig_md5(*args, **kwargs)


hashlib.md5 = _md5_compat

import booklib


def load_chapters(root, cfg):
    out = []
    for fp in booklib.chapter_files(root, cfg):
        num, _ = booklib.parse_chapter(fp, cfg)
        lines = booklib.read(fp).splitlines()
        head = lines[0].lstrip("# ").strip()
        body = "\n".join(lines[1:]).strip("\n")
        paras = [p.strip() for p in re.split(r"\n\s*\n", body)
                 if p.strip() and p.strip() != "---"]
        out.append((num, head, paras))
    return out


def groups(cfg, chapters):
    """返回 [(卷名或 None, [(num, head, paras), ...]), ...]。"""
    vols = cfg.get("volumes") or []
    if not vols:
        return [(None, chapters)]
    out = []
    for v in vols:
        sel = [(n, h, p) for (n, h, p) in chapters if v["start"] <= n <= v["end"]]
        out.append((v["name"], sel))
    return out


# ---------------- Markdown ----------------
def build_md(cfg, chapters, path):
    L = [f"# {cfg['title']}", ""]
    if cfg.get("subtitle"):
        L += [f"> {cfg['subtitle']}", ""]
    if cfg.get("author"):
        L += [f"> {cfg['author']}", ""]
    for p in cfg.get("intro", []):
        L += [p, ""]
    if cfg.get("notice"):
        L += [cfg["notice"], ""]
    L += ["---", "", "## 目录", ""]
    for vname, sel in groups(cfg, chapters):
        if vname:
            L += [f"**{vname}**", ""]
        for _n, head, _p in sel:
            L += [f"- {head}"]
        L += [""]
    L += ["---", ""]
    for vname, sel in groups(cfg, chapters):
        if vname:
            L += [f"# {vname}", ""]
        for _n, head, paras in sel:
            L += [f"## {head}", ""]
            for p in paras:
                L += [p, ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L).rstrip() + "\n")


# ---------------- Word ----------------
def build_docx(cfg, chapters, path, font="Songti SC"):
    from docx import Document
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = font
    normal.font.size = Pt(11.5)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), font)

    def set_font(run, name=font):
        run.font.name = name
        run._element.rPr.rFonts.set(qn("w:eastAsia"), name)

    def para(text, size=11.5, bold=False, align=None, indent=True,
             space_before=0, space_after=6, line=1.5):
        p = doc.add_paragraph()
        if align is not None:
            p.alignment = align
        pf = p.paragraph_format
        pf.space_before = Pt(space_before)
        pf.space_after = Pt(space_after)
        pf.line_spacing = line
        if indent:
            pf.first_line_indent = Pt(size * 2)
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.bold = bold
        set_font(run)
        return p

    # 封面
    for _ in range(4):
        doc.add_paragraph()
    para(cfg["title"], size=30, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
         indent=False, space_after=16)
    if cfg.get("subtitle"):
        para(cfg["subtitle"], size=15, align=WD_ALIGN_PARAGRAPH.CENTER,
             indent=False, space_after=6)
    if cfg.get("author"):
        para(cfg["author"], size=12, align=WD_ALIGN_PARAGRAPH.CENTER,
             indent=False, space_after=40)
    for line in cfg.get("intro", []):
        para(line, size=11.5, align=WD_ALIGN_PARAGRAPH.CENTER, indent=False)
    if cfg.get("notice"):
        para(cfg["notice"], size=10, indent=False, space_before=24)
    doc.add_page_break()

    # 目录
    para("目录", size=20, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
         indent=False, space_after=18)
    for vname, sel in groups(cfg, chapters):
        if vname:
            para(vname, size=13, bold=True, indent=False, space_before=8, space_after=4)
        for _n, head, _p in sel:
            para(head, size=11, indent=False, space_after=2, line=1.2)
    doc.add_page_break()

    # 正文
    for vname, sel in groups(cfg, chapters):
        if vname:
            para(vname, size=22, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
                 indent=False, space_before=40, space_after=30)
            doc.add_page_break()
        for _n, head, paras in sel:
            para(head, size=17, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER,
                 indent=False, space_before=6, space_after=14)
            for p in paras:
                para(p, size=11.5)
            doc.add_page_break()
    doc.save(path)


# ---------------- PDF ----------------
def build_pdf(cfg, chapters, path):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    from reportlab.lib.units import mm

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    FONT = "STSong-Light"

    def esc(t):
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    st_title = ParagraphStyle("t", fontName=FONT, fontSize=30, leading=42,
                              alignment=TA_CENTER, spaceAfter=16)
    st_sub = ParagraphStyle("s", fontName=FONT, fontSize=15, leading=24,
                            alignment=TA_CENTER, spaceAfter=6)
    st_au = ParagraphStyle("a", fontName=FONT, fontSize=12, leading=20,
                           alignment=TA_CENTER, spaceAfter=30)
    st_intro = ParagraphStyle("i", fontName=FONT, fontSize=11.5, leading=19,
                              alignment=TA_CENTER, spaceAfter=8)
    st_notice = ParagraphStyle("n", fontName=FONT, fontSize=9.5, leading=15,
                               alignment=TA_JUSTIFY, spaceBefore=20, textColor="#555555")
    st_h2 = ParagraphStyle("h2", fontName=FONT, fontSize=20, leading=30,
                           alignment=TA_CENTER, spaceAfter=16)
    st_vol = ParagraphStyle("v", fontName=FONT, fontSize=22, leading=34,
                            alignment=TA_CENTER, spaceBefore=60, spaceAfter=30)
    st_chap = ParagraphStyle("c", fontName=FONT, fontSize=16, leading=26,
                             alignment=TA_CENTER, spaceBefore=10, spaceAfter=16)
    st_body = ParagraphStyle("b", fontName=FONT, fontSize=11.5, leading=20,
                             alignment=TA_JUSTIFY, firstLineIndent=23, spaceAfter=7)
    st_toc_v = ParagraphStyle("tv", fontName=FONT, fontSize=13, leading=22,
                              spaceBefore=10, spaceAfter=4)
    st_toc_c = ParagraphStyle("tc", fontName=FONT, fontSize=11, leading=18,
                              leftIndent=12, spaceAfter=1)

    story = []
    story.append(Spacer(1, 120 * mm))
    story.append(Paragraph(esc(cfg["title"]), st_title))
    if cfg.get("subtitle"):
        story.append(Paragraph(esc(cfg["subtitle"]), st_sub))
    if cfg.get("author"):
        story.append(Paragraph(esc(cfg["author"]), st_au))
    for line in cfg.get("intro", []):
        story.append(Paragraph(esc(line), st_intro))
    if cfg.get("notice"):
        story.append(Paragraph(esc(cfg["notice"]), st_notice))
    story.append(PageBreak())

    story.append(Paragraph("目录", st_h2))
    for vname, sel in groups(cfg, chapters):
        if vname:
            story.append(Paragraph(esc(vname), st_toc_v))
        for _n, head, _p in sel:
            story.append(Paragraph(esc(head), st_toc_c))
    story.append(PageBreak())

    for vname, sel in groups(cfg, chapters):
        if vname:
            story.append(Paragraph(esc(vname), st_vol))
            story.append(PageBreak())
        for _n, head, paras in sel:
            story.append(Paragraph(esc(head), st_chap))
            for p in paras:
                story.append(Paragraph(esc(p), st_body))
            story.append(PageBreak())

    doc = SimpleDocTemplate(path, pagesize=A4,
                            leftMargin=22 * mm, rightMargin=22 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm,
                            title=cfg["title"])
    doc.build(story)


def main():
    ap = booklib.build_parser(__doc__)
    ap.add_argument("--formats", default="md,docx,pdf",
                    help="要导出的格式，逗号分隔（默认 md,docx,pdf）")
    ap.add_argument("--out", metavar="DIR", help="输出目录（默认项目根目录）")
    args = ap.parse_args()
    root, cfg = booklib.setup(args.root)

    chapters = load_chapters(root, cfg)
    if not chapters:
        print(f"未在 {booklib.chapters_dir(root, cfg)} 找到章节文件。")
        return
    print(f"载入 {len(chapters)} 章")

    out = os.path.abspath(os.path.expanduser(args.out)) if args.out else root
    os.makedirs(out, exist_ok=True)
    title = cfg["title"]
    wanted = {s.strip().lower() for s in args.formats.split(",") if s.strip()}

    if "md" in wanted:
        p = os.path.join(out, f"{title}.md")
        build_md(cfg, chapters, p)
        print("MD   ->", p)
    if "docx" in wanted:
        p = os.path.join(out, f"{title}.docx")
        build_docx(cfg, chapters, p)
        print("DOCX ->", p)
    if "pdf" in wanted:
        p = os.path.join(out, f"{title}.pdf")
        build_pdf(cfg, chapters, p)
        print("PDF  ->", p)


if __name__ == "__main__":
    main()
