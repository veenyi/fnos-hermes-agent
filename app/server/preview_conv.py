#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Office 文件 → HTML 预览转换（零第三方依赖，仅用标准库）。

支持：
    .docx  → 段落 + 表格（word/document.xml）
    .xlsx  → 首个工作表 + 共享字符串（xl/worksheets/sheet1.xml + sharedStrings.xml）
    .pptx  → 每页幻灯片文本（ppt/slides/slideN.xml）

输出完整 HTML 文档（utf-8），stdout 输出；失败时 stderr 打错误、退出码非 0。

用法：
    python3 preview_conv.py <file.docx|xlsx|pptx>
"""
import html
import os
import re
import sys
import zipfile
from xml.etree import ElementTree

# OOXML 命名空间
NS_DOC = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_SHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_DRAW = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_PRES = "http://schemas.openxmlformats.org/presentationml/2006/main"

MAX_CELLS = 20000  # xlsx 单元格上限，防止超大表卡死
MAX_PARAS = 20000  # docx/pptx 段落上限

_HTML_HEAD = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
margin:0;padding:24px;background:#fff;color:#1f2328;font-size:14px;line-height:1.7}
h1,h2,h3{color:#111}
table{border-collapse:collapse;margin:12px 0;width:auto;max-width:100%}
th,td{border:1px solid #d0d7de;padding:6px 10px;text-align:left;font-size:13px}
th{background:#f6f8fa;font-weight:600}
tr:nth-child(even) td{background:#fafbfc}
.slide{margin:0 0 20px;padding:14px 18px;border:1px solid #d0d7de;border-radius:8px;background:#fafbfc}
.slide-title{font-size:15px;font-weight:600;color:#0969da;margin-bottom:8px}
p{margin:6px 0}
.bold{font-weight:600}.center{text-align:center}
pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px;
font-family:'JetBrains Mono',Consolas,monospace;font-size:12.5px;white-space:pre-wrap;word-break:break-word}
</style></head><body>
"""
_HTML_TAIL = "</body></html>"


def _ns(tag: str, uri: str) -> str:
    return "{%s}%s" % (uri, tag)


def conv_docx(data: bytes) -> str:
    import io
    zf = zipfile.ZipFile(io.BytesIO(data))
    xml_data = zf.read("word/document.xml")
    root = ElementTree.fromstring(xml_data)
    body = root.find(_ns("body", NS_DOC))
    out = ["<h2>Word 文档</h2>"]
    count = 0

    def render_table(tbl):
        rows = []
        for tr in tbl.iter(_ns("tr", NS_DOC)):
            cells = []
            for tc in tr.findall(_ns("tc", NS_DOC)):
                cell_txt = "".join(
                    html.escape(t.text or "")
                    for t in tc.iter(_ns("t", NS_DOC))
                )
                cells.append(cell_txt)
            rows.append("<tr>" + "".join("<td>%s</td>" % c for c in cells) + "</tr>")
        return "<table>" + "".join(rows) + "</table>"

    for el in body:
        if count >= MAX_PARAS:
            out.append("<p><i>…内容过长，已截断</i></p>")
            break
        if el.tag == _ns("p", NS_DOC):
            p_text = "".join(html.escape(t.text or "") for t in el.iter(_ns("t", NS_DOC))).strip()
            if p_text:
                out.append("<p>" + p_text + "</p>")
                count += 1
        elif el.tag == _ns("tbl", NS_DOC):
            out.append(render_table(el))
            count += 1
    return _HTML_HEAD + "\n".join(out) + _HTML_TAIL


def conv_xlsx(data: bytes) -> str:
    import io
    zf = zipfile.ZipFile(io.BytesIO(data))
    # 共享字符串
    shared = []
    try:
        root = ElementTree.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in root.findall(_ns("si", NS_SHEET)):
            parts = []
            for t in si.iter(_ns("t", NS_SHEET)):
                parts.append(t.text or "")
            shared.append("".join(parts))
    except (KeyError, Exception):
        pass
    # 找第一个工作表
    sheet_path = None
    try:
        wb = ElementTree.fromstring(zf.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        first_sheet = wb.find(_ns("sheets", NS_SHEET))
        rid = None
        if first_sheet is not None:
            s = first_sheet.find(_ns("sheet", NS_SHEET))
            if s is not None:
                rid = s.get("{%s}id" % "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
        if rid:
            for rel in rels:
                if rel.get("Id") == rid:
                    target = rel.get("Target", "worksheets/sheet1.xml")
                    if not target.startswith("xl/"):
                        target = "xl/" + target.lstrip("/")
                    sheet_path = target
                    break
    except Exception:
        pass
    if not sheet_path:
        sheet_path = "xl/worksheets/sheet1.xml"
    try:
        root = ElementTree.fromstring(zf.read(sheet_path))
    except Exception as e:
        return _HTML_HEAD + "<p><b>无法解析工作表：</b>%s</p>" % html.escape(str(e)) + _HTML_TAIL

    rows_html = []
    cell_count = 0
    for row in root.iter(_ns("row", NS_SHEET)):
        cells = []
        for c in row.iter(_ns("c", NS_SHEET)):
            cell_count += 1
            if cell_count > MAX_CELLS:
                break
            v = c.find(_ns("v", NS_SHEET))
            ctype = c.get("t")
            if ctype == "inlineStr":
                val = "".join(
                    (x.text or "") for x in c.iter(_ns("t", NS_SHEET))
                )
            elif v is not None:
                val = v.text or ""
                if ctype == "s":
                    try:
                        val = shared[int(val)] if int(val) < len(shared) else val
                    except (ValueError, IndexError):
                        pass
            else:
                val = ""
            cells.append(html.escape(str(val)))
        if cells:
            rows_html.append("<tr>" + "".join("<td>%s</td>" % c for c in cells) + "</tr>")
        if cell_count > MAX_CELLS:
            rows_html.append("<tr><td colspan='99'><i>…表格过大，已截断</i></td></tr>")
            break
    return _HTML_HEAD + "<h2>Excel 表格</h2><table>" + "".join(rows_html) + "</table>" + _HTML_TAIL


def conv_pptx(data: bytes) -> str:
    import io
    zf = zipfile.ZipFile(io.BytesIO(data))
    slide_names = sorted(
        (n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
        key=lambda n: int(re.search(r"(\d+)", n.split("/")[-1]).group(1)),
    )
    out = ["<h2>PPT 演示文稿</h2>"]
    for idx, name in enumerate(slide_names[:200], 1):
        try:
            root = ElementTree.fromstring(zf.read(name))
        except Exception:
            continue
        texts = []
        # 段落级文本（保持顺序）：文本在 a:p（drawingml 命名空间）内
        for p in root.iter(_ns("p", NS_DRAW)):
            parts = []
            for t in p.iter(_ns("t", NS_DRAW)):
                parts.append(t.text or "")
            line = "".join(parts).strip()
            if line:
                texts.append(line)
        # 标题优先展示
        title = ""
        for sp in root.iter(_ns("sp", NS_PRES)):
            nv = sp.find(_ns("nvSpPr", NS_PRES))
            if nv is not None:
                ph = nv.find(_ns("nvPr", NS_PRES) + "/" + _ns("ph", NS_PRES))
                if ph is not None and ph.get("type") in ("title", "ctrTitle"):
                    title = "".join(t.text or "" for t in sp.iter(_ns("t", NS_DRAW)))
                    break
        body_html = "".join(
            "<p>%s</p>" % html.escape(line) if line else ""
            for line in texts
        )
        ttl = html.escape(title) if title else "第 %d 页" % idx
        out.append(
            '<div class="slide"><div class="slide-title">%s</div>%s</div>'
            % (ttl, body_html)
        )
    return _HTML_HEAD + "\n".join(out) + _HTML_TAIL


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: preview_conv.py <file>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    try:
        size = os.path.getsize(path)
        if size > 100 * 1024 * 1024:
            print("文件过大（>100MB）", file=sys.stderr)
            return 3
        with open(path, "rb") as f:
            data = f.read()
        ext = os.path.splitext(path)[1].lower()
        if ext == ".docx":
            out = conv_docx(data)
        elif ext == ".xlsx":
            out = conv_xlsx(data)
        elif ext == ".pptx":
            out = conv_pptx(data)
        else:
            print("不支持的格式: %s" % ext, file=sys.stderr)
            return 2
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.stdout.buffer.flush()
        return 0
    except zipfile.BadZipFile as e:
        print("BadZipFile: %s" % e, file=sys.stderr)
        return 1
    except Exception as e:
        print("Error: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
