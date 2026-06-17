"""Evidence registry — citation core.

Every retrieval tool registers evidence items; the registry assigns short ids
(E1, E2, …) the model cites as [E#]. It resolves a citation back to its source
(chunk → page → bbox for the PDF highlight, or a structured row) and backs
post-generation citation verification. Evidence spans two kinds: `chunk` (text)
and `row` (structured record).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EvidenceItem:
    eid: str
    source_kind: str  # 'chunk' | 'row'
    source_id: str
    document_id: str
    page: int | None = None
    bbox: list | None = None
    polygon: list | None = None
    breadcrumb: str | None = None
    text: str = ""

    def to_payload(self) -> dict:
        return {
            "eid": self.eid,
            "source_kind": self.source_kind,
            "source_id": self.source_id,
            "document_id": self.document_id,
            "page": self.page,
            "bbox": self.bbox,
            "polygon": self.polygon,
            "breadcrumb": self.breadcrumb,
        }


class EvidenceRegistry:
    """Per-run registry. Dedupes by (kind, source_id) so the same source surfaced
    by two tools keeps one stable eid."""

    def __init__(self) -> None:
        self._by_key: dict[tuple[str, str], EvidenceItem] = {}
        self._order: list[str] = []
        self._counter = 0

    def _register(self, item_key: tuple[str, str], make: "callable") -> EvidenceItem:
        existing = self._by_key.get(item_key)
        if existing is not None:
            return existing
        self._counter += 1
        item = make(f"E{self._counter}")
        self._by_key[item_key] = item
        self._order.append(item.eid)
        return item

    def register_chunk(
        self,
        *,
        chunk_id: str,
        document_id: str,
        page: int | None,
        bbox: list | None,
        polygon: list | None,
        breadcrumb: str | None,
        text: str,
    ) -> EvidenceItem:
        return self._register(
            ("chunk", chunk_id),
            lambda eid: EvidenceItem(
                eid=eid, source_kind="chunk", source_id=chunk_id, document_id=document_id,
                page=page, bbox=bbox, polygon=polygon, breadcrumb=breadcrumb, text=text,
            ),
        )

    def register_row(self, *, row_id: str, document_id: str, text: str, breadcrumb: str | None = None) -> EvidenceItem:
        return self._register(
            ("row", row_id),
            lambda eid: EvidenceItem(
                eid=eid, source_kind="row", source_id=row_id, document_id=document_id,
                text=text, breadcrumb=breadcrumb,
            ),
        )

    def get(self, eid: str) -> EvidenceItem | None:
        for item in self._by_key.values():
            if item.eid == eid:
                return item
        return None

    def all(self) -> list[EvidenceItem]:
        index = {item.eid: item for item in self._by_key.values()}
        return [index[eid] for eid in self._order]

    def citation_map(self) -> dict[str, dict]:
        return {item.eid: item.to_payload() for item in self.all()}


@dataclass
class RunContext:
    """Passed to every tool. Scope (allowed_doc_ids) is enforced in SQL + RLS,
    never trusted to the model."""

    user_id: str
    allowed_doc_ids: list[str]
    registry: EvidenceRegistry = field(default_factory=EvidenceRegistry)

    def doc_slugs(self) -> dict[str, str]:
        return {f"doc-{i}": d for i, d in enumerate(self.allowed_doc_ids)}

    def slug_for(self, document_id: str) -> str:
        for slug, d in self.doc_slugs().items():
            if d == document_id:
                return slug
        return "doc-?"

    def resolve_slug(self, slug: str) -> str | None:
        return self.doc_slugs().get(slug)
