#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 味自查：可定位、可分级的"机器腔"提示器。

设计原则（对齐 humanizer 的 cluster rule）：
  - 孤立命中不算证据；软性词只在同段聚簇时提示。
  - 必改项（blocking）只收高置信套路词，避免把正常中文判成 AI。
  - 每条命中给 文件:行:列 + 原文 + 规则名 + 改法。
  - 不判断"是否 AI"；命中少不代表过检，命中多也不等于会被判 AI。

可在 book.json 中配置：
  "ai_phrases": ["追加为必改项的题材套话"],
  "ai_ignore":  ["有意保留的口头禅/母题，命中后跳过"],
  "ai_cluster_min": 2   # 同段出现多少个不同软性词才算聚簇

用法：python3 <skill>/scripts/ai_lint.py [--root 项目根目录]
"""
import collections
import os
import re

import booklib

# 高置信套路词：命中即计入 blocking。可按题材用 ai_ignore 放行。
HARD_RULES = {
    "总而言之": ("summary-transition", "删掉总结句，直接陈述最后一句事实。"),
    "综上所述": ("summary-transition", "删掉总结句，直接陈述最后一句事实。"),
    "毫无疑问": ("summary-transition", "改成具体判断或直接删。"),
    "值得注意的是": ("summary-transition", "删掉提示语，直接写值得注意的事。"),
    "不可否认": ("summary-transition", "删掉让步套话，直接写事实。"),
    "显而易见": ("summary-transition", "删掉判断词，让读者自己看出来。"),
    "命运的齿轮": ("grand-noun", "换成场景里真实存在的物件、动作或数字。"),
    "时代的洪流": ("grand-noun", "换成场景里真实存在的物件、动作或数字。"),
    "历史的尘埃": ("grand-noun", "换成场景里真实存在的物件、动作或数字。"),
    "仿佛在诉说": ("personification-cliche", "删掉拟人，写物件本身的状态。"),
    "无声地诉说": ("personification-cliche", "删掉拟人，写物件本身的状态。"),
    "嘴角勾起": ("novel-cliche", "换成具体动作：抿嘴、咬腮、别开脸。"),
    "眼神深邃": ("novel-cliche", "写眼睛在看什么、怎么移动，不写‘深邃’。"),
    "意味深长": ("novel-cliche", "用对话或停顿制造意味，不贴标签。"),
    "心中五味杂陈": ("emotion-label", "写生理反应或动作，不直接报情绪。"),
    "涌上心头": ("emotion-label", "写触发它的具体细节。"),
    "百感交集": ("emotion-label", "写生理反应或动作，不直接报情绪。"),
    "无法言喻": ("emotion-label", "写人物说不出口时做了什么。"),
    "难以言表": ("emotion-label", "写人物说不出口时做了什么。"),
    "熠熠生辉": ("ornate-cliche", "删掉形容，只留发光的东西和它的位置。"),
    "泛起涟漪": ("ornate-cliche", "写水面/关系实际发生了什么变化。"),
    "空气中弥漫": ("ornate-cliche", "写气味来源、浓度、谁先闻到。"),
    "氤氲": ("ornate-cliche", "换成具体的水汽、烟、雾或气味。"),
    "不知过了多久": ("time-skip-cliche", "给一个可指认的时间锚：钟声、光线、伤口。"),
    "不知从何时起": ("time-skip-cliche", "给一个可指认的时间锚。"),
}

# 软性词：单独出现很可能是正常中文，只在同段聚簇时提示。
SOFT_RULES = {
    "然而": ("soft-transition", "能删就删；不能删就换成具体转折。"),
    "而是": ("soft-contrast", "检查是否套用‘不是……而是’公式。"),
    "与此同时": ("soft-transition", "换成具体同时发生的动作。"),
    "似乎": ("soft-hedge", "能确定就确定，不能确定就写依据。"),
    "好像": ("soft-hedge", "能确定就确定，不能确定就写依据。"),
    "大概是": ("soft-hedge", "能确定就确定，不能确定就写依据。"),
    "如同": ("soft-simile", "只保留一处最有效的比喻。"),
    "宛如": ("soft-simile", "只保留一处最有效的比喻。"),
    "恰似": ("soft-simile", "只保留一处最有效的比喻。"),
    "恍若": ("soft-simile", "只保留一处最有效的比喻。"),
    "一抹": ("soft-quantifier", "删掉量词，写动作本身。"),
    "缓缓地": ("soft-adverb", "删掉副词，让动词自己带速度。"),
    "深深地": ("soft-adverb", "删掉副词，让动作自己带力度。"),
    "轻轻地": ("soft-adverb", "删掉副词，让动作自己带力度。"),
    "静静地": ("soft-adverb", "删掉副词，写环境或动作。"),
    "微微地": ("soft-adverb", "删掉副词，写具体幅度。"),
    "淡淡地": ("soft-adverb", "删掉副词，写具体表情或语气。"),
    "璀璨": ("soft-ornate", "换成具体的灯、星、反光。"),
    "交织": ("soft-ornate", "写两条线实际怎么碰在一起。"),
    "勾勒": ("soft-ornate", "写具体的线条或轮廓。"),
    "画卷": ("soft-metaphor", "换成场景里的实物。"),
    "篇章": ("soft-metaphor", "换成具体事件或阶段。"),
    "涟漪": ("soft-metaphor", "写实际的水纹或关系变化。"),
    "不禁": ("soft-filler", "删掉，直接写动作。"),
    "不由自主": ("soft-filler", "删掉，直接写动作。"),
    "在这一刻": ("soft-moment", "删掉时间套话，直接写发生的事。"),
    "那一刻": ("soft-moment", "删掉时间套话，直接写发生的事。"),
    "仿佛": ("soft-simile", "只保留一处最有效的比喻。"),
}

HARD_REGEX = [
    (re.compile(r"不仅[^。！？\n]{0,40}而且"), "formulaic-contrast",
     "拆成一个短句直接陈述，不要用递进公式。"),
    (re.compile(r"与其说[^。！？\n]{0,40}不如说"), "formulaic-contrast",
     "拆成一句直接判断，不要用对仗公式。"),
]

OPEN_STOP = set("的了是在他她它我你们和与而就都也又很不这那有被把上下里".split())


def iter_occurrences(text, phrase):
    start = 0
    while True:
        idx = text.find(phrase, start)
        if idx < 0:
            return
        yield idx
        start = idx + len(phrase)


def line_col(text, idx):
    line = text.count("\n", 0, idx) + 1
    col = idx - text.rfind("\n", 0, idx)
    return line, col


def line_snippet(text, idx, width=88):
    start = text.rfind("\n", 0, idx) + 1
    end = text.find("\n", idx)
    if end < 0:
        end = len(text)
    line = text[start:end].strip()
    if len(line) <= width:
        return line or "（空行）"
    pos = max(0, idx - start)
    s = max(0, pos - width // 2)
    e = min(len(line), s + width)
    return ("…" if s else "") + line[s:e].strip() + ("…" if e < len(line) else "")


def iter_paragraphs(text):
    start = 0
    for m in re.finditer(r"\n[ \t\u3000]*\n", text):
        yield start, text[start:m.start()]
        start = m.end()
    yield start, text[start:]


def main():
    ap = booklib.build_parser(__doc__)
    args = ap.parse_args()
    root, cfg = booklib.setup(args.root)

    files = booklib.chapter_files(root, cfg)
    if not files:
        print(f"未在 {booklib.chapters_dir(root, cfg)} 找到章节文件。")
        return

    hard = dict(HARD_RULES)
    for p in cfg.get("ai_phrases", []):
        hard.setdefault(p, ("custom-phrase", "这是题材专属套话，按上下文改写或登记到 ai_ignore。"))
    ignore = set(cfg.get("ai_ignore", []))
    cluster_min = int(cfg.get("ai_cluster_min", 2))
    soft_rules = {k: v for k, v in SOFT_RULES.items() if k not in hard}

    total = 0
    blocking = []
    advisories = []
    soft_counts = collections.Counter()
    soft_files = collections.defaultdict(set)
    openers = collections.Counter()
    para_lens = []

    for fp in files:
        num, _ = booklib.parse_chapter(fp, cfg)
        label = f"第{num:02d}章" if num else fp
        rel = os.path.relpath(fp, root)
        txt = booklib.read(fp)
        total += booklib.cjk_count(txt)

        # 必改项：逐处定位
        for phrase, (rule, hint) in hard.items():
            if phrase in ignore:
                continue
            for idx in iter_occurrences(txt, phrase):
                line, col = line_col(txt, idx)
                blocking.append((rel, line, col, rule, phrase, line_snippet(txt, idx), hint))
        for rx, rule, hint in HARD_REGEX:
            for m in rx.finditer(txt):
                line, col = line_col(txt, m.start())
                blocking.append((rel, line, col, rule, m.group(0), line_snippet(txt, m.start()), hint))

        # 软性词：同段聚簇才提示
        for start, para in iter_paragraphs(txt):
            if not para.strip():
                continue
            n = booklib.cjk_count(para)
            if n:
                para_lens.append(n)
            for sent in re.split(r"[。！？\n]+", para):
                sent = sent.strip("　 “”‘’")
                if len(sent) >= 6 and not sent.startswith("#"):
                    openers[sent[:2]] += 1
            hits = []
            for phrase, (rule, hint) in soft_rules.items():
                if phrase in ignore:
                    continue
                c = para.count(phrase)
                if c:
                    hits.append((phrase, c, rule, hint))
                    soft_counts[phrase] += c
                    soft_files[phrase].add(label)
            if not hits:
                continue
            distinct = len(hits)
            top = max(c for _, c, _, _ in hits)
            if distinct < cluster_min and top < 3:
                continue
            line, _ = line_col(txt, start)
            names = "、".join(f"“{p}”×{c}" for p, c, _, _ in hits[:6])
            advisories.append((rel, line, "soft-cluster", names, line_snippet(txt, start), hits[0][3]))

    print(f"扫描 {len(files)} 章，共 {total} 中文字符\n")

    print(f"一、必改项（blocking）：{len(blocking)} 处")
    if not blocking:
        print("  无命中。")
    limit = 80
    for rel, line, col, rule, phrase, snippet, hint in blocking[:limit]:
        print(f"  {rel}:{line}:{col}  [{rule}] “{phrase}”")
        print(f"    原文：{snippet}")
        print(f"    改法：{hint}")
    if len(blocking) > limit:
        print(f"  …其余 {len(blocking) - limit} 处未展开，先处理高频项。")

    print(f"\n二、聚簇提示（advisory）：{len(advisories)} 处（孤立命中不报）")
    if not advisories:
        print("  无聚簇。")
    for rel, line, rule, names, snippet, hint in advisories[:40]:
        print(f"  {rel}:{line}  [{rule}] {names}")
        print(f"    原文：{snippet}")
        print(f"    建议：{hint} 同段多个软性词会叠加出机器腔，优先拆句或删修饰。")
    if len(advisories) > 40:
        print(f"  …其余 {len(advisories) - 40} 处未展开。")

    print("\n三、软性词背景统计（仅作背景，不单独判为问题）")
    if not soft_counts:
        print("  无命中。")
    for ph, c in soft_counts.most_common(15):
        print(f"  {ph}：{c} 次 / {len(soft_files[ph])} 章")

    print("\n四、句首重复 Top 15（同一开头过多 = 节奏单调，仅提示）")
    for w, c in openers.most_common(15):
        if w not in OPEN_STOP:
            print(f"  “{w}…”：{c} 次")

    print("\n五、段落长度（过于均匀 = 结构机械，仅提示）")
    if para_lens:
        import statistics
        avg = statistics.mean(para_lens)
        sd = statistics.pstdev(para_lens)
        print(f"  段数 {len(para_lens)}；均长 {avg:.1f} 字；标准差 {sd:.1f}")
        print("  → 标准差越大越自然；若 <6，考虑故意插入超短句/长句。")

    print("\n说明：本脚本只标“机器腔”线索，不判“是否 AI”。孤立命中不算证据；")
    print("     先看必改项与聚簇，再改。同一比喻全文不超过 2—3 次。")
    print("     有意保留的口头禅/母题写进 book.json 的 ai_ignore。")


if __name__ == "__main__":
    main()
