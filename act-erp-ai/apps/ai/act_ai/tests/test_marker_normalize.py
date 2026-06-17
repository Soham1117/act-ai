from act_ai.ingestion.marker_normalize import normalize


def test_normalize_builds_nodes_chunks_tables():
    payload = {
        "json": {
            "block_type": "Document",
            "children": [
                {
                    "block_type": "Page",
                    "page": 1,
                    "children": [
                        {"block_type": "SectionHeader", "text": "Specs", "heading_level": 1, "page": 1},
                        {"block_type": "Text", "text": "Torque is 10 Nm.", "page": 1, "bbox": [0, 0, 1, 1]},
                        {
                            "block_type": "Table",
                            "page": 1,
                            "html": "<table><tr><th>part</th><th>qty</th></tr><tr><td>A</td><td>2</td></tr></table>",
                            "text": "part qty A 2",
                        },
                    ],
                }
            ],
        }
    }
    nd = normalize(payload)
    assert len(nd.nodes) == 1
    assert nd.nodes[0].heading_text == "Specs"
    # text chunk + table-text chunk
    assert any("Torque" in c.content for c in nd.chunks)
    # chunk linked to the section node
    assert nd.chunks[0].node_index == 0
    assert len(nd.tables) == 1
    assert nd.tables[0].rows[0]["part"] == "A"
    assert len(nd.images) == 1  # the table also registers an image region
