from shelfmark.metadata_providers import get_provider_capabilities


class TestMetadataProviderCapabilities:
    def test_hardcover_exposes_view_series_capability(self):
        assert get_provider_capabilities("hardcover") == [
            {
                "key": "view_series",
                "field_key": "series",
                "sort": "series_order",
            },
            {
                "key": "general_suggestions",
                "suggestions_endpoint": (
                    "/api/metadata/field-options?provider=hardcover&field=general"
                ),
            },
        ]

    def test_providers_without_capabilities_return_empty_list(self):
        assert get_provider_capabilities("openlibrary") == []
