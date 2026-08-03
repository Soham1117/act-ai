"""CSV/XLSX parsing → relational record tables (BOMs, tool records, sheets).

These formats are already structured, so they bypass Marker entirely.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO

import pandas as pd


@dataclass
class ParsedTable:
    name: str
    columns: list[dict]  # [{name, type}]
    rows: list[dict]  # list of {col: value}
    row_texts: list[str] = field(default_factory=list)  # serialized rows for embedding


def _row_to_text(row: dict) -> str:
    return " | ".join(f"{k}: {v}" for k, v in row.items() if v not in (None, ""))


def _frame_to_table(name: str, df: pd.DataFrame) -> ParsedTable:
    df = df.where(pd.notna(df), None)  # NaN -> None for JSON
    columns = [{"name": str(c), "type": str(df[c].dtype)} for c in df.columns]
    rows: list[dict] = []
    row_texts: list[str] = []
    for rec in df.to_dict(orient="records"):
        clean = {str(k): (v if not isinstance(v, float) else (None if pd.isna(v) else v)) for k, v in rec.items()}
        rows.append(clean)
        row_texts.append(_row_to_text(clean))
    return ParsedTable(name=name, columns=columns, rows=rows, row_texts=row_texts)


def parse_csv(data: bytes, name: str = "table") -> list[ParsedTable]:
    df = pd.read_csv(BytesIO(data))
    return [_frame_to_table(name, df)]


def parse_xlsx(data: bytes) -> list[ParsedTable]:
    sheets = pd.read_excel(BytesIO(data), sheet_name=None)  # dict[name -> df]
    return [_frame_to_table(str(sheet), df) for sheet, df in sheets.items() if not df.empty]


def parse_structured(file_kind: str, data: bytes, source_name: str) -> list[ParsedTable]:
    if file_kind == "CSV":
        return parse_csv(data, name=source_name)
    if file_kind == "XLSX":
        return parse_xlsx(data)
    raise ValueError(f"not a structured file kind: {file_kind}")
