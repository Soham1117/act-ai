from act_ai.ingestion.structured import parse_csv, parse_structured


def test_parse_csv_rows_and_columns():
    data = b"part_no,qty\nBOLT-001,40\nNUT-002,40\n"
    tables = parse_csv(data, name="bom")
    assert len(tables) == 1
    t = tables[0]
    assert [c["name"] for c in t.columns] == ["part_no", "qty"]
    assert len(t.rows) == 2
    assert t.rows[0]["part_no"] == "BOLT-001"
    # row_texts feed embeddings
    assert "part_no: BOLT-001" in t.row_texts[0]


def test_parse_structured_rejects_non_structured():
    try:
        parse_structured("PDF", b"%PDF", "x.pdf")
    except ValueError:
        return
    raise AssertionError("expected ValueError for PDF")
