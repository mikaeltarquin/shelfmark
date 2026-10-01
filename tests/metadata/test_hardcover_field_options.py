from shelfmark.metadata_providers.hardcover import (
    TITLE_SUGGESTION_FIELDS,
    TITLE_SUGGESTION_WEIGHTS,
    HardcoverProvider,
)


class TestHardcoverFieldOptions:
    def test_search_fields_enable_typeahead_for_author_title_and_series(self):
        provider = HardcoverProvider(api_key="test-token")
        fields_by_key = {field.key: field for field in provider.search_fields}

        assert fields_by_key["author"].suggestions_endpoint == (
            "/api/metadata/field-options?provider=hardcover&field=author"
        )
        assert fields_by_key["title"].suggestions_endpoint == (
            "/api/metadata/field-options?provider=hardcover&field=title"
        )
        assert fields_by_key["series"].suggestions_endpoint == (
            "/api/metadata/field-options?provider=hardcover&field=series"
        )

    def test_get_search_field_options_returns_author_suggestions(self, monkeypatch):
        provider = HardcoverProvider(api_key="test-token")
        captured: dict[str, object] = {}

        monkeypatch.setattr(
            provider,
            "_execute_query",
            lambda query, variables: (
                captured.update({"query": query, "variables": variables})
                or {
                    "search": {
                        "results": {
                            "hits": [
                                {"document": {"id": 1, "name": "Brandon Sanderson"}},
                                {"document": {"id": 1, "name": "Brandon Sanderson"}},
                                {"document": {"id": 2, "name": "Brian Sanderson"}},
                            ],
                            "found": 3,
                        }
                    }
                }
            ),
        )

        options = provider.get_search_field_options("author", query="sand")

        assert options == [
            {"value": "id:1", "label": "Brandon Sanderson", "kind": "author"},
            {"value": "id:2", "label": "Brian Sanderson", "kind": "author"},
        ]
        assert captured["variables"] == {
            "query": "sand",
            "queryType": "Author",
            "limit": 7,
            "page": 1,
            "sort": "_text_match:desc,books_count:desc",
            "fields": "name,name_personal,alternate_names",
            "weights": "4,3,2",
        }

    def test_get_search_field_options_returns_filtered_title_suggestions(self, monkeypatch):
        provider = HardcoverProvider(api_key="test-token")
        captured: dict[str, object] = {}

        monkeypatch.setattr(
            "shelfmark.metadata_providers.hardcover.app_config.get",
            lambda key, default=None: {
                "HARDCOVER_EXCLUDE_COMPILATIONS": True,
                "HARDCOVER_EXCLUDE_UNRELEASED": True,
            }.get(key, default),
        )

        monkeypatch.setattr(
            provider,
            "_execute_query",
            lambda query, variables: (
                captured.update({"query": query, "variables": variables})
                or {
                    "search": {
                        "results": {
                            "hits": [
                                {
                                    "document": {
                                        "title": "Mistborn: The Final Empire",
                                        "compilation": False,
                                        "release_year": 2006,
                                    }
                                },
                                {
                                    "document": {
                                        "title": "Mistborn Trilogy",
                                        "compilation": True,
                                        "release_year": 2001,
                                    }
                                },
                                {
                                    "document": {
                                        "title": "Ghostbloods 1",
                                        "compilation": False,
                                        "release_year": 2028,
                                    }
                                },
                                {
                                    "document": {
                                        "title": "Mistborn: The Final Empire",
                                        "compilation": False,
                                        "release_year": 2006,
                                    }
                                },
                                {
                                    "document": {
                                        "title": "Mistborn: Secret History",
                                        "compilation": False,
                                        "release_year": 2016,
                                    }
                                },
                            ],
                            "found": 5,
                        }
                    }
                }
            ),
        )

        options = provider.get_search_field_options("title", query="mistborn")

        assert options == [
            {
                "value": "Mistborn: The Final Empire",
                "label": "Mistborn: The Final Empire",
                "kind": "book",
            },
            {
                "value": "Mistborn: Secret History",
                "label": "Mistborn: Secret History",
                "kind": "book",
            },
        ]
        assert captured["variables"] == {
            "query": "mistborn",
            "queryType": "Book",
            "limit": 7,
            "page": 1,
            "sort": "_text_match:desc,users_count:desc",
            # Hardcover rejects a Book search that narrows to fewer fields than its
            # preset expects, so the typeahead sends the full list and leans on weights.
            "fields": TITLE_SUGGESTION_FIELDS,
            "weights": TITLE_SUGGESTION_WEIGHTS,
        }

    def test_title_suggestions_name_the_author(self, monkeypatch):
        provider = HardcoverProvider(api_key="test-token")
        monkeypatch.setattr(
            provider,
            "_execute_query",
            lambda query, variables: {
                "search": {
                    "results": {
                        "hits": [
                            {
                                "document": {
                                    "title": "Words of Radiance",
                                    "author_names": ["Brandon Sanderson", "Kate Reading"],
                                }
                            },
                            {"document": {"title": "Words of Radiance: Part One"}},
                        ],
                        "found": 2,
                    }
                }
            },
        )

        assert provider.get_search_field_options("title", query="words of radiance") == [
            {
                "value": "Words of Radiance",
                "label": "Words of Radiance",
                "description": "by Brandon Sanderson",
                "kind": "book",
            },
            {
                "value": "Words of Radiance: Part One",
                "label": "Words of Radiance: Part One",
                "kind": "book",
            },
        ]

    def test_get_search_field_options_skips_short_text_queries(self):
        provider = HardcoverProvider(api_key="test-token")

        assert provider.get_search_field_options("author", query="a") == []
        assert provider.get_search_field_options("title", query="i") == []


def test_general_suggestions_list_books_then_series_then_authors(monkeypatch):
    provider = HardcoverProvider(api_key="test-token")
    books = [{"value": f"Book {i}", "label": f"Book {i}"} for i in range(7)]
    series = [{"value": f"id:{i}", "label": f"Series {i}"} for i in range(5)]
    authors = [{"value": f"id:{i}", "label": f"Author {i}"} for i in range(5)]
    monkeypatch.setattr(provider, "_search_title_options", lambda query: books)
    monkeypatch.setattr(provider, "_search_series_options", lambda query: series)
    monkeypatch.setattr(provider, "_search_author_options", lambda query: authors)

    options = provider.get_search_field_options("general", query="stormlight")

    assert [(o["kind"], o["label"]) for o in options] == [
        *(("book", f"Book {i}") for i in range(5)),
        *(("series", f"Series {i}") for i in range(3)),
        *(("author", f"Author {i}") for i in range(3)),
    ]
    assert provider.get_search_field_options("general", query="s") == []
