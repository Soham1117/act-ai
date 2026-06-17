"""Normalize a Datalab Marker JSON payload into our domain objects.

Marker's JSON is a block tree (Document → pages → blocks, each with block_type,
html/text, bbox, polygon, page). We flatten it into:
  - structure nodes (from SectionHeader blocks; depth from heading level)
  - chunks (Text/ListItem prose under the current heading, with page + bbox)
  - images (Figure/Picture/Table blocks for the visualizer)
  - tables (Table blocks parsed into rows for the relational store)

This is pragmatic and may need tuning against live Marker output; it is isolated
here so the rest of the pipeline is parser-agnostic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from act_ai.ingestion.structured import ParsedTable

_TAG_RE = re.compile(r"<[^>]+>")
_HEADING_TYPES = {"SectionHeader", "Title"}
_TEXT_TYPES = {"Text", "TextInlineMath", "ListItem", "ListGroup", "Code", "Equation"}
_FIGURE_TYPES = {"Figure", "Picture", "FigureGroup", "PictureGroup"}


def _strip_html(html: str | None) -> str:
    if not html:
        return ""
    return _TAG_RE.sub("", html).strip()


@dataclass
class NChunk:
    content: str
    page_number: int | None
    bbox: list | None
    node_index: int | None  # index into nodes list


@dataclass
class NNode:
    depth: int
    heading_text: str
    breadcrumb: str
    page_start: int | None


@dataclass
class NImage:
    page_number: int | None
    bbox: list | None
    caption: str | None
    figure_ref_norm: str | None


@dataclass
class NormalizedDoc:
    nodes: list[NNode] = field(default_factory=list)
    chunks: list[NChunk] = field(default_factory=list)
    images: list[NImage] = field(default_factory=list)
    tables: list[ParsedTable] = field(default_factory=list)


def _parse_table_html(html: str, name: str) -> ParsedTable | None:
    """Very small HTML table parser (rows/cells). Good enough for Marker tables."""
    rows_html = re.findall(r"<tr[^>]*>(.*?)</tr>", html or "", re.S | re.I)
    if not rows_html:
        return None
    grid: list[list[str]] = []
    for r in rows_html:
        cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S | re.I)
        grid.append([_strip_html(c) for c in cells])
    if not grid:
        return None
    header = grid[0]
    columns = [{"name": h or f"col{i}", "type": "string"} for i, h in enumerate(header)]
    rows: list[dict] = []
    row_texts: list[str] = []
    for r in grid[1:]:
        rec = {columns[i]["name"]: (r[i] if i < len(r) else None) for i in range(len(columns))}
        rows.append(rec)
        row_texts.append(" | ".join(f"{k}: {v}" for k, v in rec.items() if v))
    return ParsedTable(name=name, columns=columns, rows=rows, row_texts=row_texts)


def _walk(block: dict, doc: NormalizedDoc, breadcrumb: list[str], cur_node: int | None) -> int | None:
    btype = block.get("block_type") or block.get("type") or ""
    page = block.get("page") if isinstance(block.get("page"), int) else block.get("page_number")
    bbox = block.get("bbox") or block.get("polygon")
    html = block.get("html")
    text = block.get("text") or _strip_html(html)

    if btype in _HEADING_TYPES:
        heading = text.strip() or "Section"
        depth = int(block.get("heading_level") or len(breadcrumb) + 1)
        breadcrumb = breadcrumb[: max(0, depth - 1)] + [heading]
        doc.nodes.append(
            NNode(depth=depth, heading_text=heading, breadcrumb=" › ".join(breadcrumb), page_start=page)
        )
        cur_node = len(doc.nodes) - 1
    elif btype in _TEXT_TYPES:
        if text.strip():
            doc.chunks.append(NChunk(content=text.strip(), page_number=page, bbox=bbox, node_index=cur_node))
    elif btype == "Table":
        tbl = _parse_table_html(html or "", name=f"table_p{page}")
        if tbl:
            doc.tables.append(tbl)
        # also keep a chunk so the table text is searchable
        if text.strip():
            doc.chunks.append(NChunk(content=text.strip(), page_number=page, bbox=bbox, node_index=cur_node))
        doc.images.append(NImage(page_number=page, bbox=bbox, caption=None, figure_ref_norm=None))
    elif btype in _FIGURE_TYPES:
        doc.images.append(NImage(page_number=page, bbox=bbox, caption=text.strip() or None, figure_ref_norm=None))

    for child in block.get("children") or []:
        if isinstance(child, dict):
            cur_node = _walk(child, doc, breadcrumb, cur_node)
    return cur_node


def normalize(payload: dict) -> NormalizedDoc:
    doc = NormalizedDoc()
    root = payload.get("json") or payload.get("blocks") or payload
    # Root may be a dict (Document block) or a list of page blocks.
    blocks = root.get("children") if isinstance(root, dict) else root
    if isinstance(blocks, dict):
        blocks = [blocks]
    for block in blocks or []:
        if isinstance(block, dict):
            _walk(block, doc, [], None)
    return doc
